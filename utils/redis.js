// /utils/redis.js
const Redis = require("ioredis");

let client;
function getRedis() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("Missing REDIS_URL");
    if (!/^redis(s)?:\/\//i.test(url)) {
      throw new Error(
        `REDIS_URL must start with redis:// or rediss:// (got "${url.slice(0, 16)}...")`
      );
    }

    // Upstash works with plain rediss://. No extra TLS options needed usually.
    client = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  }
  return client;
}

async function pingRedis() {
  try { return (await getRedis().ping()) === "PONG"; } catch { return false; }
}

async function incrWithTTL(key, ttlSeconds) {
  const r = getRedis();
  const v = await r.incr(key);
  if (v === 1) await r.expire(key, ttlSeconds);
  return v;
}

module.exports = { getRedis, pingRedis, incrWithTTL };
