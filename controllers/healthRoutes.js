const express = require("express");
const router = express.Router();

const db = require("../config/connection");
const { pingRedis } = require("../utils/redis");

router.get("/", async (req, res) => {
  try {
    const mongoUp = db.readyState === 1; // 1 = connected
    const redisUp = await pingRedis();
    res.json({ ok: mongoUp && redisUp, mongo: mongoUp, redis: redisUp });
  } catch {
    res.json({ ok: false, mongo: false, redis: false });
  }
});

module.exports = router;
