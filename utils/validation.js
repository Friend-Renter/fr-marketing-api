const crypto = require("crypto");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (Array.isArray(xff)) return xff[0];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "";
}

function normalizeStr(v, max) {
  const s = typeof v === "string" ? v.trim() : "";
  return max ? (s.length > max ? s.slice(0, max) : s) : s;
}

function validateLead(body) {
  const errors = [];
  const data = {};

  data.type = normalizeStr(body.type, 16);
  if (!["host", "renter"].includes(data.type)) errors.push("invalid type");

  data.firstName = normalizeStr(body.firstName, 80);
  if (!data.firstName) errors.push("firstName required");

  data.lastName = normalizeStr(body.lastName, 80);

  data.email = normalizeStr(body.email, 120);
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("invalid email");

  data.phone = normalizeStr(body.phone, 32);
  data.citySlug = normalizeStr(body.citySlug, 64);
  data.message = normalizeStr(body.message, 1000);

  data.consentMarketing = !!body.consentMarketing;
  if (!data.consentMarketing) errors.push("consentMarketing required");

  data.captchaToken = normalizeStr(body.captchaToken, 2000);
  if (!data.captchaToken) errors.push("captchaToken required");

  // honeypot (accept either field name)
  data.honeypot = normalizeStr(body.honeypot || body.website, 200);

  return { errors, data };
}

function hmacEmail(email, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(email || "").toLowerCase())
    .digest("hex");
}

module.exports = { getClientIp, normalizeStr, validateLead, hmacEmail };
