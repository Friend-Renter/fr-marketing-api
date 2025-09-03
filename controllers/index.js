const express = require("express");
const router = express.Router();
const leadRoutes = require("./leadRoutes");
const healthRoutes = require("./healthRoutes");
router.use("/v1/leads", leadRoutes);
router.use("/v1/health", healthRoutes);

module.exports = router;
