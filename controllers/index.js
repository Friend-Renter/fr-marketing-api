const express = require("express");
const router = express.Router();
const leadRoutes = require("./leadRoutes");


console.log("registering /v1/leads");
router.use("/v1/leads", leadRoutes);

module.exports = router;
