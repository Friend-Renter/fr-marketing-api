const express = require("express");
const router = express.Router();
const leadRoutes = require("./leadRoutes");
const healthRoutes = require("./healthRoutes");
router.use("/leads", leadRoutes);
router.use("/health", healthRoutes);

module.exports = router;
