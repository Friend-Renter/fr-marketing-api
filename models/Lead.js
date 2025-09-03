// /models/Lead.js
const { Schema, model } = require("mongoose");

const leadSchema = new Schema(
  {
    type: { type: String, enum: ["host", "renter"], required: true },
    firstName: { type: String, required: true, maxlength: 80 },
    lastName: { type: String, maxlength: 80 },
    email: { type: String, required: true, maxlength: 120, index: true },
    phone: { type: String, maxlength: 32 },
    citySlug: { type: String, maxlength: 64 },
    message: { type: String, maxlength: 1000 },
    consentMarketing: { type: Boolean, required: true },

    meta: {
      ip: String,
      userAgent: String,
      referrer: String,
      utms: {
        source: String,
        medium: String,
        campaign: String,
        term: String,
        content: String,
      },
    },

    duplicate: { type: Boolean, default: false },
    status: { type: String, default: "new" },
  },
  { timestamps: true } // adds createdAt/updatedAt
);

// fast dedupe lookups during the last few minutes
leadSchema.index({ email: 1, type: 1, createdAt: -1 });

const Lead = model("Lead", leadSchema);
module.exports = Lead;
