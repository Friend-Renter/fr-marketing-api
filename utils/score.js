// /utils/score.js

function scoreHost(lead) {
  let total = 0;
  const reasons = [];

  const city = (
    lead.city ||
    lead.hostDetails?.locations?.[0]?.city ||
    ""
  ).toLowerCase();
  const inTarget = city.includes("lincoln") || city.includes("omaha");
  if (inTarget) {
    total += 2;
    reasons.push({ code: "city_target", points: 2 });
  }

  const vehicles = lead.hostDetails?.vehicles || [];
  const seats5 = vehicles.some((v) => Number(v.seats || 0) >= 5);
  if (seats5) {
    total += 1;
    reasons.push({ code: "seats_5_plus", points: 1 });
  }

  const suvVan = vehicles.some((v) => ["SUV", "Van"].includes(v.bodyType));
  if (suvVan) {
    total += 1;
    reasons.push({ code: "bodytype_family", points: 1 });
  }

  const readinessNow = vehicles.some((v) => v.readiness === "Ready now");
  if (readinessNow) {
    total += 2;
    reasons.push({ code: "ready_now", points: 2 });
  }

  // condition bonus
  const hasExcellent = vehicles.some((v) => v.condition === "Excellent");
  if (hasExcellent) {
    total += 1;
    reasons.push({ code: "condition_excellent", points: 1 });
  }

  const handoff = lead.hostDetails?.handoff || "both";
  if (handoff === "lockbox" || handoff === "both") {
    total += 1;
    reasons.push({ code: "handoff_easy", points: 1 });
  }

  const fleet = lead.hostDetails?.fleetSize || "1";
  if (["2_3", "4_9", "10_plus"].includes(fleet)) {
    total += 1;
    reasons.push({ code: "fleet_multi", points: 1 });
  }

  return { total, reasons, version: "1.1" };
}

function scoreRenter(lead) {
  let total = 0;
  const reasons = [];

  // Dates in next 30 days?
  const today = new Date();
  const in30 = new Date(today.getTime() + 30 * 86400000);
  const es = lead.renterDetails?.dates?.earliestStart;
  const ls = lead.renterDetails?.dates?.latestStart;
  if (es && ls) {
    const esd = new Date(es + "T00:00:00");
    const lsd = new Date(ls + "T23:59:59");
    const overlaps = lsd >= today && esd <= in30;
    if (overlaps) {
      total += 2;
      reasons.push({ code: "date_soon", points: 2 });
    }
  }

  const budget = lead.renterDetails?.budgetBand || "50_80";
  if (["80_120", "120_plus"].includes(budget)) {
    total += 2;
    reasons.push({ code: "budget_high", points: 2 });
  }

  const seats = Number(lead.renterDetails?.prefs?.seats || 0);
  const bodyType = lead.renterDetails?.prefs?.bodyType || "";
  if (seats >= 5 || bodyType === "SUV") {
    total += 1;
    reasons.push({ code: "family_pref", points: 1 });
  }

  const dur = lead.renterDetails?.dates?.typicalDurationBand || "1-3";
  if (["4-7", "8+"].includes(dur)) {
    total += 1;
    reasons.push({ code: "duration_longer", points: 1 });
  }

  return { total, reasons, version: "1.0" };
}

function computeScores(lead) {
  let scoreHostOut = 0;
  let scoreRenterOut = 0;
  let reasonsHost = undefined;
  let reasonsRenter = undefined;
  const versions = [];

  if ((lead.roles || []).includes("host")) {
    const s = scoreHost(lead);
    scoreHostOut = s.total;
    reasonsHost = s.reasons;
    if (s.version) versions.push(s.version);
  }
  if ((lead.roles || []).includes("renter")) {
    const s = scoreRenter(lead);
    scoreRenterOut = s.total;
    reasonsRenter = s.reasons;
    if (s.version) versions.push(s.version);
  }

  // Use the highest version among sub-scores; fallback to 1.0
  const version = versions.sort().slice(-1)[0] || "1.0";
  return { scoreHostOut, scoreRenterOut, reasonsHost, reasonsRenter, version };
}

module.exports = { computeScores };
