// /controllers/vehiclesRoutes.js
const express = require("express");
const { incrWithTTL } = require("../utils/redis");
const carquery = require("../services/carquery");
const {
  KEYS,
  TTL,
  getCachedJSON,
  setCachedJSON,
} = require("../services/vehicleCache");

const router = express.Router();

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (Array.isArray(xff)) return xff[0];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "";
}

function ok(res, data, cacheStatus = "miss") {
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min browser/CDN
  res.setHeader("x-cache", cacheStatus);
  return res.status(200).json(data);
}

function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

async function rateLimit(req, res, next) {
  try {
    const ip = getClientIp(req) || "unknown";
    const key = `${process.env.REDIS_NAMESPACE || "fr:dev"}:rl:veh:${
      req.path
    }:ip:${ip}:1m`;
    const v = await incrWithTTL(key, 60);
    // Very generous; these endpoints are lightweight + cached
    if (v > 60) return res.status(429).json({ error: "Too many requests" });
    next();
  } catch (e) {
    // If Redis not reachable, don't block the request.
    next();
  }
}

// GET /v1/vehicles/years -> { years: { min, max } }
router.get("/years", rateLimit, async (req, res) => {
  try {
    const key = KEYS.YEARS;
    const cached = await getCachedJSON(key);
    if (cached) return ok(res, { years: cached }, "hit");

    // Fetch fresh
    const years = await carquery.getYears();
    await setCachedJSON(key, years, TTL.YEARS);
    return ok(res, { years }, "miss");
  } catch (e) {
    console.error("years error", e.message);
    // Fallback: a sensible default window
    const now = new Date().getFullYear();
    return ok(res, { years: { min: 1980, max: now } }, "fallback");
  }
});

// GET /v1/vehicles/makes?year=YYYY
router.get("/makes", rateLimit, async (req, res) => {
  const year = String(req.query.year || "");
  if (!/^\d{4}$/.test(year)) return bad(res, "year (YYYY) required");
  try {
    const key = KEYS.MAKES(year);
    const cached = await getCachedJSON(key);
    if (cached) return ok(res, { makes: cached }, "hit");

    const makes = await carquery.getMakes({ year });
    await setCachedJSON(key, makes, TTL.LISTS);
    return ok(res, { makes }, "miss");
  } catch (e) {
    console.error("makes error", e.message);
    return ok(res, { makes: [] }, "fallback");
  }
});

// GET /v1/vehicles/models?year=YYYY&make=Honda
router.get("/models", rateLimit, async (req, res) => {
  const year = String(req.query.year || "");
  const make = String(req.query.make || "");
  if (!/^\d{4}$/.test(year)) return bad(res, "year (YYYY) required");
  if (!make) return bad(res, "make required");
  try {
    const key = KEYS.MODELS(year, make);
    const cached = await getCachedJSON(key);
    if (cached) return ok(res, { models: cached }, "hit");

    const models = await carquery.getModels({ year, make });
    await setCachedJSON(key, models, TTL.LISTS);
    return ok(res, { models }, "miss");
  } catch (e) {
    console.error("models error", e.message);
    return ok(res, { models: [] }, "fallback");
  }
});

// GET /v1/vehicles/trims?year=YYYY&make=Honda&model=Accord
router.get("/trims", rateLimit, async (req, res) => {
  const year = String(req.query.year || "");
  const make = String(req.query.make || "");
  const model = String(req.query.model || "");
  if (!/^\d{4}$/.test(year)) return bad(res, "year (YYYY) required");
  if (!make) return bad(res, "make required");
  if (!model) return bad(res, "model required");
  try {
    const key = KEYS.TRIMS(year, make, model);
    const cached = await getCachedJSON(key);
    if (cached) return ok(res, cached, "hit");

    const { trims, specByTrim } = await carquery.getTrims({
      year,
      make,
      model,
    });
    const payload =
      specByTrim && Object.keys(specByTrim).length
        ? { trims, specByTrim }
        : { trims };
    await setCachedJSON(key, payload, TTL.LISTS);
    return ok(res, payload, "miss");
  } catch (e) {
    console.error("trims error", e.message);
    return ok(res, { trims: [] }, "fallback");
  }
});

module.exports = router;
