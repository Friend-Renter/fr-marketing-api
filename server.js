const express = require("express");
const path = require("path");
const db = require("./config/connection");
require("dotenv").config();
const routes = require("./controllers");
const cors = require("cors");

const PORT = process.env.PORT || 3001;
const app = express();

require("dotenv").config();

// trust proxy so req.ip reflects real client IP behind Heroku/NGINX
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

// ALLOW your site origins (dev + prod)
const allowList = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // allow same-origin / curl (no Origin) and explicit allowList
    const ok = !origin || allowList.includes(origin);
    cb(ok ? null : new Error("Not allowed by CORS"), ok);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
};

// 1) Apply CORS to all requests
app.use(cors(corsOptions));

// 2) Explicitly handle preflights WITHOUT "*" (use regex)
app.options(/.*/, cors(corsOptions));

// Increase payload size limits
app.use(express.json({ limit: "50mb" })); // Adjust the limit as needed
app.use(express.urlencoded({ limit: "50mb", extended: true })); // Adjust the limit as needed


// Mount API
console.log("mounting API routes at /v1");
app.use("/v1", routes);

// 404 for unknown API routes
app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});


process.on("SIGINT", async () => {
  console.log("Closing server...");
  await db.close();
  process.exit(0);
});

// Connect to database and start server
db.once("open", () => {
  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}!`);
  });
});