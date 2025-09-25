// /utils/validation.js
const crypto = require("crypto");
const validator = require("validator");

// ---------- Util helpers ----------

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

// Safe int clamp helper
function toIntIfValid(n, { min = 0, max = 2147483647 } = {}) {
  const s = String(n ?? "");
  if (!validator.isInt(s, { min, max })) return null;
  return parseInt(s, 10);
}

// ---------- City/ZIP normalization ----------

function normalizeCityOrZip(input) {
  const s = normalizeStr(input, 120);
  if (!s) return { cityRaw: "", zipRaw: "", city: "", state: "", zip5: "" };

  // ZIP (accept ZIP or ZIP+4; store zip5)
  if (validator.isPostalCode(s, "US")) {
    const m = s.match(/\b\d{5}\b/);
    const zip5 = m ? m[0] : "";
    if (zip5) {
      return { cityRaw: "", zipRaw: s, city: "", state: "", zip5 };
    }
  }

  // Try "City, ST"
  const m = s.match(/^\s*([^,]+)\s*,\s*([A-Za-z]{2})\s*$/);
  if (m) {
    const state2 = m[2].toUpperCase();
    // light guard: ensure two letters (already enforced by regex)
    return {
      cityRaw: s,
      zipRaw: "",
      city: normalizeStr(m[1], 120),
      state: state2,
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
  if (!data.firstName || validator.isEmpty(data.firstName)) {
    errors.push("firstName required");
  }

  data.lastName = normalizeStr(body.lastName, 80);

  data.email = normalizeStr(body.email, 120)?.toLowerCase();
  if (!data.email || !validator.isEmail(data.email, { allow_display_name: false, ignore_max_length: true })) {
    errors.push("invalid email");
  }

  // phone: optional soft check (do not fail request)
  data.phone = normalizeStr(body.phone, 32);
  // if you ever want to hard-enforce US mobile, switch to pushing an error:
  // if (data.phone && !validator.isMobilePhone(data.phone, "en-US")) errors.push("invalid phone");

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

        // seats validation (optional field)
        const seatsInt = toIntIfValid(v.seats, { min: 0, max: 20 });
        const seats = seatsInt == null ? 0 : seatsInt;

        const veh = {
          year,
          make,
          model,
          trim,
          bodyType: normalizeStr(v.bodyType, 16),
          seats,
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

      // ISO 8601 strict (YYYY-MM-DD)
      if (earliest && !validator.isISO8601(earliest, { strict: true })) {
        errors.push("dates invalid: earliest format");
      }
      if (latest && !validator.isISO8601(latest, { strict: true })) {
        errors.push("dates invalid: latest format");
      }
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
      const seatsInt = toIntIfValid(rd.prefs.seats, { min: 0, max: 20 });
      out.prefs = {
        bodyType: normalizeStr(rd.prefs.bodyType, 32) || "No preference",
        seats: seatsInt == null ? 0 : seatsInt,
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
  titleCaseSmart,
};
