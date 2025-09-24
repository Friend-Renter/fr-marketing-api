// /services/vehicleCache.js
const { getRedis } = require("../utils/redis");

const NS = process.env.REDIS_NAMESPACE || "fr:dev";
const KEYS = {
  YEARS: `${NS}:veh:years`,
  MAKES: (y) => `${NS}:veh:makes:${y}`,
  MODELS: (y, m) => `${NS}:veh:models:${y}:${(m || "").toLowerCase()}`,
  TRIMS: (y, m, mo) =>
    `${NS}:veh:trims:${y}:${(m || "").toLowerCase()}:${(mo || "").toLowerCase()}`,
};

// TTLs (seconds)
const TTL = {
  YEARS: 60 * 60 * 24 * 30, // 30 days
  LISTS: 60 * 60 * 24 * 7,  // 7 days
};

async function getCachedJSON(key) {
  const r = getRedis();
  const val = await r.get(key);
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch (_) {
    return null;
  }
}

async function setCachedJSON(key, value, ttlSeconds) {
  const r = getRedis();
  await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

module.exports = { KEYS, TTL, getCachedJSON, setCachedJSON };
