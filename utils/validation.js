// /utils/validation.js
const crypto = require("crypto");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (Array.isArray(xff)) return xff[0];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "";
}

function normalizeStr(v, max) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!max) return s;
  return s.length > max ? s.slice(0, max) : s;
}

function titleCaseSmart(s) {
  if (!s) return s;
  if (/^[A-Z0-9\-]+$/.test(s) && s.length <= 5) return s;
  return s
    .split(/(\s+|\/|-|\+)/)
    .map((c) =>
      /^\s+$/.test(c) || ["-", "/", "+"].includes(c)
        ? c
        : c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
    )
    .join("");
}

function hashIp(ip, secret) {
  if (!ip) return "";
  const salt = secret || "ip_salt_default";
  return crypto.createHmac("sha256", salt).update(String(ip)).digest("hex");
}

function hmacEmail(email, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(email || "").toLowerCase())
    .digest("hex");
}

function normalizeCityOrZip(input) {
  const s = normalizeStr(input, 120);
  if (!s) return { cityRaw: "", zipRaw: "", city: "", state: "", zip5: "" };

  const zip = s.match(/^\d{5}$/) ? s : "";
  if (zip) {
    return { cityRaw: "", zipRaw: zip, city: "", state: "", zip5: zip };
  }

  // Try "City, ST"
  const m = s.match(/^\s*([^,]+)\s*,\s*([A-Za-z]{2})\s*$/);
  if (m) {
    return {
      cityRaw: s,
      zipRaw: "",
      city: normalizeStr(m[1], 120),
      state: m[2].toUpperCase(),
      zip5: "",
    };
  }

  // Fallback: treat as freeform city
  return { cityRaw: s, zipRaw: "", city: "", state: "", zip5: "" };
}

// ---------- Validators ----------

function validateLeadStep1(body) {
  const errors = [];
  const data = {};

  // role OR legacy type
  const role = normalizeStr(body.role, 16);
  const legacyType = normalizeStr(body.type, 16);
  const roleIn = role || legacyType || "host"; // landing default host
  const roles = roleIn === "both" ? ["host", "renter"] : [roleIn];

  if (!roles.every((r) => ["host", "renter"].includes(r)))
    errors.push("invalid role");
  data.roles = roles;

  data.firstName = normalizeStr(body.firstName, 80);
  if (!data.firstName) errors.push("firstName required");

  data.lastName = normalizeStr(body.lastName, 80);
  data.email = normalizeStr(body.email, 120)?.toLowerCase();
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    errors.push("invalid email");

  data.phone = normalizeStr(body.phone, 32);

  // cityOrZip (new) or citySlug (legacy)
  const cz = normalizeStr(body.cityOrZip, 120);
  const norm = normalizeCityOrZip(cz);
  data.cityRaw = norm.cityRaw;
  data.zipRaw = norm.zipRaw;
  data.city = norm.city;
  data.state = norm.state;
  data.zip5 = norm.zip5;
  data.citySlug = normalizeStr(body.citySlug, 64);

  // consent
  const consent =
    typeof body.consent === "boolean" ? body.consent : !!body.consentMarketing;
  if (!consent) errors.push("consent required");
  data.consentMarketing = !!consent;

  data.captchaToken = normalizeStr(body.captchaToken, 2000);
  if (!data.captchaToken) errors.push("captchaToken required");

  // telemetry (allow from body too)
  data.referrer = normalizeStr(body.referrer, 512);
  data.utms = {
    source: normalizeStr(body.utmSource, 120),
    medium: normalizeStr(body.utmMedium, 120),
    campaign: normalizeStr(body.utmCampaign, 120),
    term: normalizeStr(body.utmTerm, 120),
    content: normalizeStr(body.utmContent, 120),
  };

  // honeypot
  data.honeypot = normalizeStr(body.honeypot || body.website, 200);

  return { errors, data };
}

function validateLeadEnrich(body) {
  const errors = [];
  const data = {};

  // small helper for safe enum clamping
  const clampEnum = (val, allowed, fallback) => {
    const x = normalizeStr(val, 32);
    return allowed.includes(x) ? x : fallback;
  };

  data.captchaToken = normalizeStr(body.captchaToken, 2000);
  if (!data.captchaToken) errors.push("captchaToken required");
  data.honeypot = normalizeStr(body.honeypot || body.website, 200);

  const hd = body.hostDetails || null;
  const rd = body.renterDetails || null;

  if (!hd && !rd) errors.push("no details provided");

  if (hd) {
    const out = {};

    if (Array.isArray(hd.locations)) {
      out.locations = hd.locations
        .slice(0, 5)
        .map((l) => ({
          city: normalizeStr(l.city, 120),
          state: normalizeStr(l.state, 2).toUpperCase(),
          zip5: normalizeStr(l.zip5, 5),
        }))
        .filter((l) => l.city || l.zip5);
    }

    if (Array.isArray(hd.vehicles)) {
      out.vehicles = hd.vehicles.slice(0, 20).map((v) => {
        const year = normalizeStr(v.year, 8);
        const make = normalizeStr(v.make, 40);
        const model = normalizeStr(v.model, 60);
        const trim = normalizeStr(v.trim, 60); // optional

        // clamp condition to allowed set with fallback
        const condition = clampEnum(
          v.condition,
          ["Excellent", "Good", "Fair"],
          "Good"
        );

        const veh = {
          year,
          make,
          model,
          trim,
          bodyType: normalizeStr(v.bodyType, 16),
          seats: Number(v.seats || 0),
          transmission: normalizeStr(v.transmission, 10),
          mileageBand: normalizeStr(v.mileageBand, 16),
          availability: normalizeStr(v.availability, 16),
          readiness: normalizeStr(v.readiness, 20),
          condition,
        };

        // Normalized copies (for clean storage / downstream matching)
        if (veh.make) veh.makeNormalized = titleCaseSmart(veh.make);
        if (veh.model) veh.modelNormalized = titleCaseSmart(veh.model);
        if (veh.trim) veh.trimNormalized = titleCaseSmart(veh.trim);
        return veh;
      });

      // require year/make/model for each provided vehicle
      for (const v of out.vehicles) {
        if (!v.year || !v.make || !v.model) {
          errors.push("vehicle requires year/make/model");
          break;
        }
      }
    }

    out.insuranceStatus = normalizeStr(hd.insuranceStatus, 16) || "unsure";
    out.handoff = normalizeStr(hd.handoff, 16) || "both";
    out.pricingExpectation = normalizeStr(hd.pricingExpectation, 64);
    out.fleetSize = normalizeStr(hd.fleetSize, 16) || "1";
    out.notes = normalizeStr(hd.notes, 1000);

    data.hostDetails = out;
  }

  if (rd) {
    const out = {};

    if (rd.pickup) {
      out.pickup = {
        city: normalizeStr(rd.pickup.city, 120),
        state: normalizeStr(rd.pickup.state, 2).toUpperCase(),
        zip5: normalizeStr(rd.pickup.zip5, 5),
      };
    }

    if (rd.dates) {
      const earliest = normalizeStr(rd.dates.earliestStart, 10);
      const latest = normalizeStr(rd.dates.latestStart, 10);
      if (earliest && latest && earliest > latest) {
        errors.push("dates invalid: earliest > latest");
      }
      out.dates = {
        earliestStart: earliest,
        latestStart: latest,
        typicalDurationBand:
          normalizeStr(rd.dates.typicalDurationBand, 8) || "1-3",
      };
    }

    if (rd.prefs) {
      out.prefs = {
        bodyType: normalizeStr(rd.prefs.bodyType, 32) || "No preference",
        seats: Number(rd.prefs.seats || 0),
        transmission:
          normalizeStr(rd.prefs.transmission, 16) || "No preference",
        extras: Array.isArray(rd.prefs.extras)
          ? rd.prefs.extras.slice(0, 20).map((x) => normalizeStr(x, 32))
          : [],
      };
    }

    out.budgetBand = normalizeStr(rd.budgetBand, 16) || "50_80";
    out.ageBand = normalizeStr(rd.ageBand, 16) || "25_plus";
    out.notes = normalizeStr(rd.notes, 1000);

    data.renterDetails = out;
  }

  return { errors, data };
}

module.exports = {
  getClientIp,
  normalizeStr,
  normalizeCityOrZip,
  validateLeadStep1,
  validateLeadEnrich,
  hmacEmail,
  hashIp,
};
