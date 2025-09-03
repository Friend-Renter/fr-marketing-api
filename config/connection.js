// /config/connection.js
const mongoose = require("mongoose");

const uri =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fr-marketing";

// helpful default
mongoose.set("strictQuery", true);

mongoose
  .connect(uri, {
    autoIndex: true,   // build indexes from schemas
    maxPoolSize: 10,   // reasonable pool size
  })
  .then(() => {
    const where = uri.includes("mongodb+srv") ? "Atlas" : uri;
    console.log(`[mongo] connected → ${where}`);
  })
  .catch((err) => {
    console.error("[mongo] initial connection error:", err);
  });

const db = mongoose.connection;

db.on("error", (err) => console.error("[mongo] error:", err));
db.on("disconnected", () => console.warn("[mongo] disconnected"));

// graceful shutdown
process.on("SIGINT", async () => {
  try {
    await db.close();
    console.log("[mongo] connection closed on app termination");
    process.exit(0);
  } catch (e) {
    console.error("[mongo] error during shutdown:", e);
    process.exit(1);
  }
});

module.exports = db;
