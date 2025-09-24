// /services/carquery.js
// Uses global fetch (Node 18+). If you're on Node <18, install undici or node-fetch.
const UA =
  process.env.VEHICLES_USER_AGENT ||
  "FriendRenter/1.0 (+contact: team@friendrenter.com)";

const BASE = "https://www.carqueryapi.com/api/0.3/";

function stripPotentialJsonp(txt) {
  // CarQuery can return JSON or JSONP depending on params/proxies.
  // If JSONP, it's like: carquery({...});
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    try {
      return JSON.parse(txt.slice(start, end + 1));
    } catch (_) {
      // fall through
    }
  }
  // Last attempt: try direct JSON parse
  return JSON.parse(txt);
}

async function carqueryFetch(params) {
  const url = new URL(BASE);
  // CarQuery expects all args in query string, including cmd
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  // fmt=json isn't documented everywhere, but helps force JSON in some setups.
  url.searchParams.set("fmt", "json");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "User-Agent": UA },
  });

  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`CarQuery ${params.cmd} failed: ${res.status}`);
    e.status = res.status;
    e.body = text?.slice(0, 200);
    throw e;
  }
  return stripPotentialJsonp(text);
}

function titleCaseSmart(s) {
  if (!s) return s;
  const raw = s.trim();

  // Keep common acronyms / all-caps (BMW, GMC, VW)
  if (/^[A-Z0-9\-]+$/.test(raw) && raw.length <= 5) return raw;
  // Otherwise title-case chunks split by space-/+
  return raw
    .split(/(\s+|\/|-|\+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk; // keep spacing
      if (chunk === "/" || chunk === "-" || chunk === "+") return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
    })
    .join("");
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

module.exports = {
  async getYears() {
    // https://www.carqueryapi.com/api/0.3/?cmd=getYears
    const json = await carqueryFetch({ cmd: "getYears" });
    // Shape: { Years: { min_year: "1941", max_year: "2025" } }
    const y = json?.Years || json?.years;
    const now = new Date().getFullYear();
    const min = Number(y?.min_year || 1980);
    const max = Math.min(Number(y?.max_year || now), now);
    return { min, max };
  },

  async getMakes({ year }) {
    // https://www.carqueryapi.com/api/0.3/?cmd=getMakes&year=YYYY&sold_in_us=1
    const json = await carqueryFetch({
      cmd: "getMakes",
      year,
      sold_in_us: 1,
    });
    // Shape: { Makes: [{ make_display, make_is_common, make_country, ... }, ...] }
    const makesRaw = json?.Makes || json?.makes || [];
    const makes = makesRaw.map((m) => titleCaseSmart(m.make_display || m.make || m.make_name));
    return uniqSorted(makes);
  },

  async getModels({ year, make }) {
    // https://www.carqueryapi.com/api/0.3/?cmd=getModels&year=YYYY&make=Honda&sold_in_us=1
    const json = await carqueryFetch({
      cmd: "getModels",
      year,
      make,
      sold_in_us: 1,
    });
    // Shape: { Models: [{ model_name, model_make_id, ... }, ...] }
    const modelsRaw = json?.Models || json?.models || [];
    const models = modelsRaw.map((m) => titleCaseSmart(m.model_name || m.model));
    return uniqSorted(models);
  },

  async getTrims({ year, make, model }) {
    // https://www.carqueryapi.com/api/0.3/?cmd=getTrims&year=YYYY&make=Honda&model=Accord&sold_in_us=1&full_results=0
    const json = await carqueryFetch({
      cmd: "getTrims",
      year,
      make,
      model,
      sold_in_us: 1,
      full_results: 0,
    });
    // Shape: { Trims: [{ model_trim, model_name, model_make_id, ... }, ...] }
    const trimsRaw = json?.Trims || json?.trims || [];
    // Prefer concise 'model_trim'. If missing, fall back to model_name (rare).
    const trims = trimsRaw.map((t) => titleCaseSmart(t.model_trim || t.model_name || t.trim));
    return uniqSorted(trims);
  },

  titleCaseSmart,
};
