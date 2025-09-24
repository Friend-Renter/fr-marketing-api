// /controllers/leadRoutes.js
const express = require("express");
const Lead = require("../models/Lead");
const { incrWithTTL, tryIdempotency } = require("../utils/redis");
const { verifyRecaptcha } = require("../utils/recaptcha");
const {
  getClientIp,
  validateLeadStep1,
  validateLeadEnrich,
  hmacEmail,
  hashIp,
} = require("../utils/validation");
const { computeScores } = require("../utils/score");
const crypto = require("crypto");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

const router = express.Router();
router.use(express.json({ limit: "32kb" }));

router.post("/", async (req, res) => {
  try {
    const {
      REDIS_NAMESPACE = "fr:dev",
      RECAPTCHA_SECRET,
      RATE_LIMIT_SECRET,
      RL_IP_10M = "5",
      RL_IP_1D = "50",
      RL_EMAIL_1D = "5",
      IDEM_TTL_SECONDS = "600",
    } = process.env;

    if (!RECAPTCHA_SECRET)
      return res.status(500).json({ message: "server_misconfigured" });
    const EMAIL_HASH_SECRET = RATE_LIMIT_SECRET || RECAPTCHA_SECRET;

    // We'll validate first to access email/role, then enforce idempotency.
    // Parse + validate
    const ip = getClientIp(req);
    const ua = req.headers["user-agent"] || "";
    const ref = req.headers["referer"] || req.headers["referrer"] || "";
    const { errors, data } = validateLeadStep1(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0] });

    // Idempotency (required). Use header if present; otherwise derive from stable fields.
    const headerKey = req.header("x-idempotency-key");
    const intentHash = sha256Hex(
      JSON.stringify({
        step: "post_quick",
        email: (data.email || "").toLowerCase(),
        roles: data.roles,
        cityOrZip: data.zip5 || data.city || data.cityRaw || "",
      })
    );
    const idemKey = `${REDIS_NAMESPACE}:mkt:idem:${headerKey || intentHash}`;
    const okIdem = await tryIdempotency(
      idemKey,
      Number(process.env.IDEM_TTL_SECONDS || "600")
    );
    if (!okIdem) return res.status(201).json({ status: "duplicate" });

    // Honeypot — soft accept
    if (data.honeypot)
      return res.status(201).json({ id: null, status: "received" });

    // Rate limits (IP + email)
    const ip10mKey = `${REDIS_NAMESPACE}:mkt:rl:ip:${ip}:10m`;
    const ip1dKey = `${REDIS_NAMESPACE}:mkt:rl:ip:${ip}:1d`;
    const email1dKey = `${REDIS_NAMESPACE}:mkt:rl:email:${hmacEmail(
      data.email,
      EMAIL_HASH_SECRET
    )}:1d`;
    const [ip10m, ip1d, email1d] = await Promise.all([
      incrWithTTL(ip10mKey, 600),
      incrWithTTL(ip1dKey, 86400),
      incrWithTTL(email1dKey, 86400),
    ]);
    if (
      ip10m > Number(RL_IP_10M) ||
      ip1d > Number(RL_IP_1D) ||
      email1d > Number(RL_EMAIL_1D)
    ) {
      return res.status(429).json({ message: "rate_limited" });
    }

    // reCAPTCHA
    const ok = await verifyRecaptcha(data.captchaToken, ip);
    if (!ok) return res.status(401).json({ message: "captcha_failed" });

    // Upsert by email
    const ipHashed = hashIp(ip, EMAIL_HASH_SECRET);
    const now = new Date();

    const update = {
      $setOnInsert: {
        email: data.email.toLowerCase(),
        createdAt: now,
      },
      $set: {
        firstName: data.firstName,
        lastName: data.lastName || undefined,
        phone: data.phone || undefined,
        // location normalization
        cityRaw: data.cityRaw || undefined,
        zipRaw: data.zipRaw || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        zip5: data.zip5 || undefined,
        citySlug: data.citySlug || undefined,
        consentMarketing: !!data.consentMarketing,
        consentedAt: now,
        "meta.ipHash": ipHashed,
        "meta.userAgent": ua,
        "meta.referrer": data.referrer || ref || undefined,
        "meta.utms.source": data.utms.source || undefined,
        "meta.utms.medium": data.utms.medium || undefined,
        "meta.utms.campaign": data.utms.campaign || undefined,
        "meta.utms.term": data.utms.term || undefined,
        "meta.utms.content": data.utms.content || undefined,
        updatedAt: now,
      },
      $addToSet: { roles: { $each: data.roles } },
    };

    // Stage flags for any roles provided
    if (data.roles.includes("host")) update.$set.stageHost = "quick";
    if (data.roles.includes("renter")) update.$set.stageRenter = "quick";

    // Maintain legacy 'type' if single role
    if (data.roles.length === 1) update.$set.type = data.roles[0];

    const doc = await Lead.findOneAndUpdate(
      { email: data.email.toLowerCase() },
      update,
      { new: true, upsert: true }
    );

    // Compute score(s)
    const { scoreHostOut, scoreRenterOut, version } = computeScores(doc);
    if (
      doc.scoreHost !== scoreHostOut ||
      doc.scoreRenter !== scoreRenterOut ||
      doc.scoreVersion !== version
    ) {
      doc.scoreHost = scoreHostOut;
      doc.scoreRenter = scoreRenterOut;
      doc.scoreVersion = version;
      doc.scoreUpdatedAt = new Date();
      await doc.save();
    }

    return res.status(201).json({
      id: doc._id,
      roles: doc.roles,
      stageHost: doc.stageHost,
      stageRenter: doc.stageRenter,
      scoreHost: doc.scoreHost,
      scoreRenter: doc.scoreRenter,
      scoreVersion: doc.scoreVersion,
      status: "received",
    });
  } catch (err) {
    console.error("leads POST error", err);
    return res.status(500).json({ message: "server_error" });
  }
});

router.patch("/enrich", async (req, res) => {
  try {
    const {
      REDIS_NAMESPACE = "fr:dev",
      RECAPTCHA_SECRET,
      RATE_LIMIT_SECRET,
      RL_ENRICH_EMAIL_1D = "10",
      IDEM_TTL_SECONDS = "600",
    } = process.env;

    if (!RECAPTCHA_SECRET)
      return res.status(500).json({ message: "server_misconfigured" });
    const EMAIL_HASH_SECRET = RATE_LIMIT_SECRET || RECAPTCHA_SECRET;

    // Idempotency (required): key by email + step + shape of details (coarse hash to avoid exact PII)
    const headerKey = req.header("x-idempotency-key");

    const email = String(req.query.email || "")
      .toLowerCase()
      .trim();
    if (!email) return res.status(400).json({ message: "email required" });

    const ip = getClientIp(req);

    const { errors, data } = validateLeadEnrich(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0] });

    const coarse = {
      step: "patch_enrich",
      email,
      hasHost: !!data.hostDetails,
      hasRenter: !!data.renterDetails,
      // small shape hints so "Save" with same content coalesces:
      hostVehCount: data.hostDetails?.vehicles?.length || 0,
      hostFleet: data.hostDetails?.fleetSize || "",
      renterBudget: data.renterDetails?.budgetBand || "",
      renterDur: data.renterDetails?.dates?.typicalDurationBand || "",
    };
    const intentHash = sha256Hex(JSON.stringify(coarse));
    const idemKey = `${REDIS_NAMESPACE}:mkt:idem:${headerKey || intentHash}`;
    const okIdem = await tryIdempotency(
      idemKey,
      Number(process.env.IDEM_TTL_SECONDS || "600")
    );
    if (!okIdem) return res.status(200).json({ status: "duplicate" });

    // Honeypot — soft accept
    if (data.honeypot)
      return res.status(200).json({ id: null, status: "received" });

    // RL per email
    const email1dKey = `${REDIS_NAMESPACE}:mkt:rl:email:${hmacEmail(
      email,
      EMAIL_HASH_SECRET
    )}:1d`;
    const email1d = await incrWithTTL(email1dKey, 86400);
    if (email1d > Number(RL_ENRICH_EMAIL_1D))
      return res.status(429).json({ message: "rate_limited" });

    // reCAPTCHA
    const ok = await verifyRecaptcha(data.captchaToken, ip);
    if (!ok) return res.status(401).json({ message: "captcha_failed" });

    const doc = await Lead.findOne({ email });
    if (!doc) return res.status(404).json({ message: "lead_not_found" });

    // Merge details
    if (data.hostDetails) {
      doc.hostDetails = { ...(doc.hostDetails || {}), ...data.hostDetails };
      // ensure stage
      if ((doc.roles || []).includes("host") || data.hostDetails) {
        if (!doc.roles?.includes("host"))
          doc.roles = [...(doc.roles || []), "host"];
        doc.stageHost = "enriched";
        doc.type = doc.roles.length === 1 ? "host" : doc.type; // legacy
      }
    }
    if (data.renterDetails) {
      doc.renterDetails = {
        ...(doc.renterDetails || {}),
        ...data.renterDetails,
      };
      if ((doc.roles || []).includes("renter") || data.renterDetails) {
        if (!doc.roles?.includes("renter"))
          doc.roles = [...(doc.roles || []), "renter"];
        doc.stageRenter = "enriched";
        doc.type = doc.roles.length === 1 ? "renter" : doc.type; // legacy
      }
    }

    // Recompute scores
    const {
      scoreHostOut,
      scoreRenterOut,
      reasonsHost,
      reasonsRenter,
      version,
    } = computeScores(doc);
    doc.scoreHost = scoreHostOut;
    doc.scoreRenter = scoreRenterOut;
    doc.scoreVersion = version;
    doc.scoreUpdatedAt = new Date();
    await doc.save();

    return res.status(200).json({
      id: doc._id,
      stageHost: doc.stageHost,
      stageRenter: doc.stageRenter,
      scoreHost: doc.scoreHost,
      scoreRenter: doc.scoreRenter,
      reasonsHost,
      reasonsRenter,
      scoreVersion: doc.scoreVersion,
      status: "saved",
    });
  } catch (err) {
    console.error("leads PATCH error", err);
    return res.status(500).json({ message: "server_error" });
  }
});

module.exports = router;
