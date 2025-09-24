const express = require("express");
const router = express.Router();
const leadRoutes = require("./leadRoutes");
const healthRoutes = require("./healthRoutes");
const vehiclesRoutes = require("./vehiclesRoutes");
router.use("/leads", leadRoutes);
router.use("/health", healthRoutes);
router.use("/vehicles", vehiclesRoutes);

module.exports = router;
