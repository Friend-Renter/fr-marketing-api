// /models/Lead.js
const { Schema, model } = require("mongoose");

const GeoPointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  { _id: false }
);

const HostVehicleSchema = new Schema(
  {
    year: String,
    make: String,
    model: String,
    bodyType: {
      type: String,
      enum: ["Sedan", "SUV", "Truck", "Van", "EV", "Other"],
    },
    seats: Number,
    transmission: { type: String, enum: ["Auto", "Manual"] },
    mileageBand: {
      type: String,
      enum: ["<50k", "50–100k", "100–150k", "150k+"],
    },
    availability: { type: String, enum: ["Weekdays", "Weekends", "Both"] },
    readiness: {
      type: String,
      enum: ["Ready now", "In 1–3 mo", "Just exploring"],
    },
    condition: {
      type: String,
      enum: ["Excellent", "Good", "Fair"],
      default: "Good",
    },
  },
  { _id: false }
);

const HostDetailsSchema = new Schema(
  {
    locations: [{ city: String, state: String, zip5: String }],
    vehicles: [HostVehicleSchema],
    insuranceStatus: {
      type: String,
      enum: ["personal", "commercial", "unsure"],
      default: "unsure",
    },
    handoff: {
      type: String,
      enum: ["in_person", "lockbox", "both"],
      default: "both",
    },
    pricingExpectation: String,
    fleetSize: {
      type: String,
      enum: ["1", "2_3", "4_9", "10_plus"],
      default: "1",
    },
    notes: String,
  },
  { _id: false }
);

const RenterDetailsSchema = new Schema(
  {
    pickup: { city: String, state: String, zip5: String },
    dates: {
      earliestStart: String, // ISO date yyyy-mm-dd
      latestStart: String, // ISO date yyyy-mm-dd
      typicalDurationBand: {
        type: String,
        enum: ["1-3", "4-7", "8+"],
        default: "1-3",
      },
    },
    prefs: {
      bodyType: String, // "Sedan"|"SUV"|...|"No preference"
      seats: Number,
      transmission: String, // "Auto"|"Manual"|"No preference"
      extras: [String],
    },
    budgetBand: {
      type: String,
      enum: ["<50", "50_80", "80_120", "120_plus"],
      default: "50_80",
    },
    ageBand: {
      type: String,
      enum: ["u21", "21_24", "25_plus"],
      default: "25_plus",
    },
    notes: String,
  },
  { _id: false }
);

const leadSchema = new Schema(
  {
    // Primary identity
    email: {
      type: String,
      required: true,
      maxlength: 120,
      index: true,
      lowercase: true,
    },
    firstName: { type: String, required: true, maxlength: 80 },
    lastName: { type: String, maxlength: 80 },
    phone: { type: String, maxlength: 32 },

    // Roles (can be one or both). For legacy compat we keep "type" too.
    roles: {
      type: [String],
      enum: ["host", "renter"],
      default: ["renter"],
      index: true,
    },
    type: { type: String, enum: ["host", "renter"] }, // optional legacy mirror when roles.length === 1

    // Location normalization
    cityRaw: { type: String, maxlength: 120 },
    zipRaw: { type: String, maxlength: 16 },
    city: { type: String, maxlength: 120 },
    state: { type: String, maxlength: 2 },
    zip5: { type: String, maxlength: 5 },
    citySlug: { type: String, maxlength: 64 },
    geo: { type: GeoPointSchema, index: "2dsphere", default: undefined },

    // Consent / privacy
    consentMarketing: { type: Boolean, default: true },
    consentedAt: { type: Date },
    consentTextHash: { type: String },

    // Telemetry
    meta: {
      ipHash: String,
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

    // Stages & scores
    stageHost: {
      type: String,
      enum: ["quick", "enriched", "n/a"],
      default: "n/a",
    },
    stageRenter: {
      type: String,
      enum: ["quick", "enriched", "n/a"],
      default: "n/a",
    },
    scoreHost: { type: Number, default: 0 },
    scoreRenter: { type: Number, default: 0 },
    scoreVersion: { type: String },
    scoreUpdatedAt: { type: Date },

    // Details
    hostDetails: HostDetailsSchema,
    renterDetails: RenterDetailsSchema,

    // Legacy / misc
    message: { type: String, maxlength: 1000 },
    duplicate: { type: Boolean, default: false },
    status: { type: String, default: "new" },
  },
  { timestamps: true }
);

// Helpful indexes
leadSchema.index({ email: 1, createdAt: -1 });
leadSchema.index({ roles: 1, createdAt: -1 });
leadSchema.index({ scoreHost: -1 });
leadSchema.index({ scoreRenter: -1 });

const Lead = model("Lead", leadSchema);
module.exports = Lead;
