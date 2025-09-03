// /controllers/leadRoutes.js
const express = require("express");
const Lead = require("../models/Lead");
const { incrWithTTL } = require("../utils/redis");
const { verifyRecaptcha } = require("../utils/recaptcha");
const { getClientIp, validateLead, hmacEmail } = require("../utils/validation");

const router = express.Router();

// body parser here is optional since you already use a global parser in server.js
router.use(express.json({ limit: "10kb" }));

router.post("/", async (req, res) => {
  try {
    const {
      REDIS_NAMESPACE = "fr:dev",
      RECAPTCHA_SECRET,
      RATE_LIMIT_SECRET,
    } = process.env;

    if (!RECAPTCHA_SECRET) {
      return res.status(500).json({ message: "server_misconfigured" });
    }

    const EMAIL_HASH_SECRET = RATE_LIMIT_SECRET || RECAPTCHA_SECRET;

    const ip = getClientIp(req);
    const ua = req.headers["user-agent"] || "";
    const ref = req.headers["referer"] || req.headers["referrer"] || "";

    // UTM parse (from referrer if present)
    let utms = {};
    try {
      if (ref) {
        const u = new URL(ref);
        utms = {
          source: u.searchParams.get("utm_source") || "",
          medium: u.searchParams.get("utm_medium") || "",
          campaign: u.searchParams.get("utm_campaign") || "",
          term: u.searchParams.get("utm_term") || "",
          content: u.searchParams.get("utm_content") || "",
        };
      }
    } catch {}

    // 1) Validate
    const { errors, data } = validateLead(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0] });

    // 2) Honeypot — SOFT ACCEPT (201, no insert)
    if (data.honeypot) {
      return res.status(201).json({ id: null, status: "received" });
    }

    // 3) Rate limits (IP + email)
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

    if (ip10m > 5 || ip1d > 50 || email1d > 3) {
      return res.status(429).json({ message: "rate_limited" });
    }

    // 4) reCAPTCHA verify
    const ok = await verifyRecaptcha(data.captchaToken, ip);
    if (!ok) return res.status(401).json({ message: "captcha_failed" });

    // 5) Dedup (5-minute window, email+type)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existing = await Lead.findOne({
      email: data.email,
      type: data.type,
      createdAt: { $gte: fiveMinAgo },
    }).select("_id");

    if (existing) {
      // SOFT ACCEPT (no re-insert)
      return res.status(201).json({ id: existing._id, status: "received" });
    }

    // 6) Insert
    const doc = await Lead.create({
      type: data.type,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      citySlug: data.citySlug,
      message: data.message,
      consentMarketing: !!data.consentMarketing,
      meta: { ip, userAgent: ua, referrer: ref, utms },
      duplicate: false,
      status: "new",
    });

    return res.status(201).json({ id: doc._id, status: "received" });
  } catch (err) {
    console.error("leads error", err);
    return res.status(500).json({ message: "server_error" });
  }
});

module.exports = router;
