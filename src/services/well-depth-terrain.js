// Terrain-aware nearby well depth (POST /api/well-depth-terrain).
//
// Why (broker feedback, Yellowstone 03092732390050000 near Billings, 2026-11-17): the report said
// "Shallow wells nearby — about 53 ft median depth", but "You'd be lucky at 800 feet here ... the
// only wells down there are in drainages." The closest five wells were shallow alluvial wells in
// the Blue Creek drainage, 70-300 ft below the upland parcel. Depth to water depends on where the
// well sits in the landscape, so a well far below the homesite says little about it.
//
// What this does, for one homesite point (an interior point of the parcel, sent by the browser):
//   1. Candidate wells from the state's official records (WA Ecology, IDWR, MBMG GWIC) within
//      WELL_TERRAIN.radiiMiles[0], expanding up to the cap when too few wells sit at a similar
//      elevation. Residential-comparable records only (the same nonresidential list as
//      public/screening-inputs.js), no abandoned or dry holes.
//   2. Ground elevation: the record's own land-surface altitude when it has one (GWIC
//      altitude_ft_amsl), else the USGS 3DEP surface at the well point (src/services/
//      point-elevations.js: AWS Terrain Tiles, then 3DEP getSamples). A GWIC well located only
//      to the centre of its section (TRS-SEC, TRS-TWN) has no usable point, so it has no
//      elevation unless the record gives one. The homesite elevation comes from the same sampler.
//   3. estimateWellDepth() below: wells within +/-similarFt of the homesite are the comparable
//      ones; wells more than drainageFt lower are drainage wells, reported separately; every
//      other well counts only through its elevation-adjusted depth. Static water level, where
//      recorded, gives the water-level elevation (surface - static level) and so a rough depth to
//      water at the homesite (homesite elevation - water-level elevation).
// Upstream calls go through the shared client with the caller's remaining budget; any failure
// (wells or elevation) answers { available: false, status } and the browser keeps the plain
// nearest-wells median, labelled low confidence (public/screening-inputs.js). Screening only.
import { json } from '../shared/http.js';
import { withoutPersonalFields, WELL_RECORD_PERSONAL_FIELD } from '../shared/personal-fields.js';
import { cachedJson } from '../shared/upstream.js';
import { findMontanaWellCandidates } from '../states/montana/wells.js';
import { findIdahoWellCandidates } from '../states/idaho/wells.js';
import { findWashingtonWellCandidates } from '../states/washington/wells.js';
import { pointElevationsFt } from './point-elevations.js';

export const WELL_TERRAIN = Object.freeze({
  similarFt: 50,        // comparable: within +/- 50 ft of the homesite
  drainageFt: 100,      // drainage well: more than 100 ft below the homesite
  minComparable: 3,     // fewer comparable wells: low confidence, keep searching
  useComparable: 8,     // the nearest comparable wells the estimate uses
  useOthers: 8,         // low confidence: the nearest other wells (elevation-adjusted) it adds
  nearestForDrainage: 10, // "mostly in a drainage": over half of the nearest 10 with an elevation
  deepFt: 500,          // deep well evidence at similar or higher ground (widens the high end)
  deepMin: 2,           // deep wells needed to raise the high end when comparable wells exist (owner, 2026-11-18)
  radiiMiles: [2, 4, 6], // search radius steps; 6 mi is the cap
  sampleBatch: 40,      // wells sampled per step, nearest first
  maxSampled: 120,
  budgetMs: 10000,      // the browser waits up to ~12.5 s inside its 15 s wells section
  cacheSeconds: 7 * 24 * 3600
});
export const WELL_TERRAIN_CACHE_PREFIX = 'well-depth-terrain-v1';

// Same list as public/screening-inputs.js (NONRESIDENTIAL): irrigation, monitoring, municipal ...
const NONRESIDENTIAL = /\b(irrigat|agricultur|industrial|monitor|observation|injection|dewater|geothermal|environmental|remediation|municipal)\w*/i;
const INACTIVE = /\b(abandon|dry|decommission|plugged)\w*/i;
// GWIC geomethod values that place the well only at the centre of a section or township.
const COARSE_LOCATION = /^(TRS-SEC|TRS-TWN)$/i;

const finite = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round10 = v => (v == null ? null : Math.round(v / 10) * 10);
export function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function quantile(values, q) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export function milesBetween(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const FINDERS = { MT: findMontanaWellCandidates, ID: findIdahoWellCandidates, WA: findWashingtonWellCandidates };
const SOURCES = {
  MT: 'Montana Bureau of Mines and Geology — Ground Water Information Center (GWIC)',
  ID: 'Idaho Department of Water Resources Well Database',
  WA: 'Washington State Department of Ecology well reports'
};

// A state record (feature) -> the candidate the estimate reads, or null when it cannot be used.
export function candidateOf(feature, home) {
  const p = feature?.properties || {};
  const [lon, lat] = (feature?.geometry?.coordinates || []).map(Number);
  const depthFt = finite(p.CompletedDepth);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || depthFt == null || depthFt <= 0) return null;
  const typeText = [p.WellProjectType, p.WellSubType, p.ProjectName, p.WellUse].filter(Boolean).join(' ');
  const statusText = [p.Status, p.WellProjectType].filter(Boolean).join(' ');
  const locationMethod = String(p.LocationMethod || '');
  return {
    id: String(p.ID ?? p.GWICId ?? p.WellID ?? `${lon},${lat}`),
    lat, lon,
    distanceMi: milesBetween(home, { lat, lon }),
    depthFt,
    // 0 is how a missing GWIC static level arrives (Number(null)); treat it as not recorded.
    staticFt: finite(p.StaticWaterLvl) || null,
    recordElevationFt: finite(p.LandSurfaceElevFt),
    locationMethod,
    coarseLocation: COARSE_LOCATION.test(locationMethod),
    residential: !NONRESIDENTIAL.test(typeText),
    inactive: INACTIVE.test(statusText),
    type: typeText
  };
}

// The estimate. parcelElevationFt: the homesite's ground elevation. wells: candidates nearest
// first, each with elevationFt (null when unknown). Returns null when no well has an elevation.
//   moderate: at least minComparable comparable wells, and the nearest wells are not mostly
//             drainage wells. Depth = their median; range = their 25th-75th percentile.
//   low:      otherwise. The comparable depths plus the elevation-adjusted depths of the nearest
//             other wells (depth + homesite elevation - well elevation: the same water-bearing
//             zone reached from the homesite; a well above the homesite counts at no less than
//             half its depth). Depth = their median (the low end); the high end is at least 1.5x
//             their 75th percentile and 2x the median.
// Deep wells (deepFt+ and at least 2x the median) at similar or higher ground (owner decisions,
// 2026-11-18):
//   - with comparable wells: at least deepMin (2) of them, no farther away than the wells used,
//     raise the high end to their median depth. A single one does not move the range; it is
//     reported (deepWells.single) and the card and report say "One nearby well on higher ground
//     went to 1,365 ft; deeper wells are possible."
//   - with no comparable well at all: even a single one anywhere in the search radius sets the
//     top of the range (deepWells.raisedHigh), and the note names it (depth, distance, height,
//     flowing artesian, approximate location) with "ask a local driller".
// planningDepthFt (the cost model's well line) is the high end; scoreDepthFt (the score's water
// factor and the card grade) is the median when confidence is moderate, the high end when low.
export function estimateWellDepth({ parcelElevationFt, wells }, cfg = WELL_TERRAIN) {
  const Ep = finite(parcelElevationFt);
  if (Ep == null) return null;
  const known = [];
  let unknownElevation = 0;
  for (const w of wells || []) {
    const elev = finite(w.elevationFt);
    if (elev == null) { unknownElevation++; continue; }
    const dz = elev - Ep;
    const group = Math.abs(dz) <= cfg.similarFt ? 'similar' : dz < -cfg.drainageFt ? 'drainage' : dz < 0 ? 'lower' : 'higher';
    const adjusted = group === 'similar' ? w.depthFt : group === 'higher' ? Math.max(w.depthFt - dz, w.depthFt / 2) : w.depthFt - dz;
    const waterLevelElevFt = w.staticFt != null ? elev - w.staticFt : null;
    known.push({ ...w, elevationFt: elev, dzFt: dz, group, adjustedDepthFt: adjusted, waterLevelElevFt, waterDepthAtHomesiteFt: waterLevelElevFt != null ? Math.max(0, Ep - waterLevelElevFt) : null });
  }
  if (!known.length) return null;

  const comparable = known.filter(w => w.group === 'similar').slice(0, cfg.useComparable);
  const nearest = known.slice(0, cfg.nearestForDrainage);
  const drainage = nearest.filter(w => w.group === 'drainage');
  const higher = nearest.filter(w => w.group === 'higher');
  const mostlyDrainage = nearest.length >= 3 && drainage.length * 2 > nearest.length;
  const moderate = comparable.length >= cfg.minComparable && !mostlyDrainage;

  let used, depth, low, high;
  if (moderate) {
    used = comparable;
    const d = comparable.map(w => w.depthFt);
    depth = median(d); low = quantile(d, 0.25); high = quantile(d, 0.75);
  } else {
    const others = known.filter(w => w.group !== 'similar').slice(0, cfg.useOthers);
    used = [...comparable, ...others];
    const pool = [...comparable.map(w => w.depthFt), ...others.map(w => w.adjustedDepthFt)];
    depth = median(pool);
    low = depth;
    high = Math.max(quantile(pool, 0.75) * 1.5, depth * 2);
  }
  // Deep wells at similar or higher ground, within the distance of the wells used.
  const noComparable = comparable.length === 0;
  const reach = noComparable ? Infinity : Math.max(...used.map(w => w.distanceMi));
  const deep = known.filter(w => w.distanceMi <= reach && w.depthFt >= Math.max(cfg.deepFt, 2 * depth) && w.dzFt >= -cfg.similarFt);
  const deepMedian = median(deep.map(w => w.depthFt));
  const raisedByDeep = deepMedian != null && deep.length >= (noComparable ? 1 : cfg.deepMin) && deepMedian > high;
  if (raisedByDeep) high = deepMedian;

  const waterDepths = used.map(w => w.waterDepthAtHomesiteFt).filter(v => v != null);
  const r = v => round10(v);
  const out = {
    confidence: moderate ? 'moderate' : 'low',
    depthFt: r(depth), lowFt: r(Math.min(low, depth)), highFt: r(Math.max(high, depth)),
    comparableCount: comparable.length,
    comparableMaxMi: comparable.length ? Math.round(Math.max(...comparable.map(w => w.distanceMi)) * 100) / 100 : null,
    usedCount: used.length,
    wellsWithElevation: known.length,
    unknownElevation,
    parcelElevationFt: Math.round(Ep),
    waterLevelDepthFt: r(median(waterDepths)),
    waterLevelWells: waterDepths.length,
    drainage: { count: drainage.length, of: nearest.length, medianDropFt: r(median(drainage.map(w => -w.dzFt))), mostly: mostlyDrainage },
    higher: { count: higher.length, of: nearest.length, medianRiseFt: r(median(higher.map(w => w.dzFt))) },
    deepWells: {
      count: deep.length, medianFt: r(deepMedian), raisedHigh: raisedByDeep,
      single: deep.length === 1 ? {
        id: deep[0].id, depthFt: Math.round(deep[0].depthFt), dzFt: Math.round(deep[0].dzFt), distanceMi: Math.round(deep[0].distanceMi * 100) / 100,
        flowing: deep[0].staticFt != null && deep[0].staticFt < 0, approximateLocation: Boolean(deep[0].coarseLocation)
      } : null
    }
  };
  out.planningDepthFt = out.highFt;
  out.scoreDepthFt = moderate ? out.depthFt : out.highFt;
  out.wells = known.slice(0, 15).map(w => ({
    id: w.id, distanceMi: Math.round(w.distanceMi * 100) / 100, depthFt: w.depthFt, staticFt: w.staticFt,
    elevationFt: Math.round(w.elevationFt), elevationSource: w.elevationSource || null, dzFt: Math.round(w.dzFt), group: w.group,
    adjustedDepthFt: Math.round(w.adjustedDepthFt), used: used.includes(w)
  }));
  return out;
}

// Candidates + elevations + estimate for one homesite point. Never rejects.
export async function wellDepthTerrain({ state, lat, lon }, { budgetMs = WELL_TERRAIN.budgetMs, cfg = WELL_TERRAIN } = {}) {
  state = String(state || '').toUpperCase();
  lat = Number(lat); lon = Number(lon);
  if (!FINDERS[state]) return { available: false, status: 'not_supported', state };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'bad_request', error: 'lat and lon are required.' };
  const home = { lat, lon };
  const deadline = Date.now() + budgetMs;
  const remaining = () => deadline - Date.now();
  const base = { state, point: { lat, lon }, source: SOURCES[state], comparableWithinFt: cfg.similarFt, drainageBelowFt: cfg.drainageFt };

  const byId = new Map();
  let radiusIdx = -1, searchRadiusMiles = null, truncated = false;
  const query = async () => {
    radiusIdx++;
    const miles = cfg.radiiMiles[radiusIdx];
    // Leave about half the remaining time for the elevations.
    const left = remaining();
    const rows = await FINDERS[state]({ lat, lon, miles, timeoutMs: Math.max(1500, Math.min(8000, left * 0.45)), retryTimeoutMs: Math.max(1000, Math.min(5000, left * 0.2)) });
    if (rows.length >= 2000) truncated = true;
    searchRadiusMiles = miles;
    for (const row of rows) {
      const c = candidateOf(row, home);
      if (c && c.residential && !c.inactive && c.distanceMi <= miles && !byId.has(c.id)) byId.set(c.id, c);
    }
  };
  try { await query(); } catch (error) {
    return { ...base, available: false, status: 'wells_unavailable', error: error?.message || String(error) };
  }

  let parcelElevationFt = null, parcelElevationSource = null;
  const sampled = new Set();
  const elevationSources = new Set();
  const errors = {};
  let elevationTried = false;
  let elevationGaps = 0; // wells that needed a terrain elevation and got none
  const ordered = () => [...byId.values()].sort((a, b) => a.distanceMi - b.distanceMi);
  const comparableCount = () => parcelElevationFt == null ? 0
    : [...byId.values()].filter(c => sampled.has(c.id) && c.elevationFt != null && Math.abs(c.elevationFt - parcelElevationFt) <= cfg.similarFt).length;

  while (remaining() > 1500) {
    const batch = ordered().filter(c => !sampled.has(c.id)).slice(0, cfg.sampleBatch);
    if (!batch.length) {
      if (radiusIdx + 1 >= cfg.radiiMiles.length || remaining() < 4000) break;
      try { await query(); } catch (error) { errors.wells = error?.message || String(error); break; }
      continue;
    }
    const needs = batch.filter(c => c.recordElevationFt == null && !c.coarseLocation);
    const points = [...(parcelElevationFt == null ? [home] : []), ...needs.map(c => ({ lat: c.lat, lon: c.lon }))];
    let answer = { values: [], from: [], errors: {} };
    if (points.length) {
      elevationTried = true;
      answer = await pointElevationsFt(points, { budgetMs: Math.max(1000, Math.min(7000, remaining() - 500)) });
      Object.assign(errors, answer.errors);
    }
    let k = 0;
    if (parcelElevationFt == null) {
      parcelElevationFt = answer.values[0] ?? null;
      parcelElevationSource = answer.from[0] ?? null;
      k = 1;
      if (parcelElevationFt == null) break;
    }
    const sampledAt = new Map(needs.map((c, i) => [c.id, i + k]));
    for (const c of batch) {
      sampled.add(c.id);
      if (c.recordElevationFt != null) { c.elevationFt = c.recordElevationFt; c.elevationSource = 'record'; }
      else if (sampledAt.has(c.id)) {
        const i = sampledAt.get(c.id);
        c.elevationFt = answer.values[i] ?? null;
        c.elevationSource = answer.from[i] ?? null;
        if (c.elevationFt == null) elevationGaps++;
        if (c.elevationSource) elevationSources.add(c.elevationSource);
      } else c.elevationFt = null;
    }
    if (comparableCount() >= cfg.minComparable || sampled.size >= cfg.maxSampled) break;
  }

  if (parcelElevationFt == null) {
    return { ...base, available: false, status: 'elevation_unavailable', candidates: byId.size, searchRadiusMiles, error: Object.values(errors)[0] || (elevationTried ? 'Homesite elevation unavailable' : 'No time left for elevations') };
  }
  if (parcelElevationSource) elevationSources.add(parcelElevationSource);
  const wells = ordered().filter(c => sampled.has(c.id));
  const estimate = estimateWellDepth({ parcelElevationFt, wells }, cfg);
  if (!estimate) {
    return { ...base, available: false, status: wells.length ? 'well_elevations_unavailable' : 'no_wells', candidates: byId.size, searchRadiusMiles, parcelElevationFt: Math.round(parcelElevationFt) };
  }
  return {
    ...base,
    available: true, status: 'estimated',
    parcelElevationFt: Math.round(parcelElevationFt), parcelElevationSource,
    elevationSources: [...elevationSources],
    searchRadiusMiles, truncated,
    candidates: byId.size, sampled: sampled.size, elevationGaps,
    estimate,
    ...(Object.keys(errors).length ? { errors } : {})
  };
}

// Cached only when every well that needed a terrain elevation got one (a source that failed while
// the other filled in is fine; errors are kept in the answer for the logs).
const goodAnswer = a => Boolean(a?.available && a.estimate && a.elevationGaps === 0);

export async function handleWellDepthTerrain(request) {
  let body;
  try { body = await request.json(); } catch { return json({ available: false, status: 'bad_request', error: 'JSON body required.' }, 400, 'no-store'); }
  const state = String(body?.state || '').toUpperCase().trim();
  const lat = Number(body?.lat), lon = Number(body?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ available: false, status: 'bad_request', error: 'lat and lon are required.' }, 400, 'no-store');
  if (!FINDERS[state]) return json({ available: false, status: 'not_supported', state }, 200, 'no-store');
  // ~11 m: one homesite point per parcel; the same parcel always sends the same point.
  const key = `${state}:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const answer = await cachedJson(WELL_TERRAIN_CACHE_PREFIX, key, WELL_TERRAIN.cacheSeconds, () => wellDepthTerrain({ state, lat, lon }), { isValid: goodAnswer });
  // The answer carries well ids, depths and elevations only; the strip is the last guard.
  return json(withoutPersonalFields(answer, WELL_RECORD_PERSONAL_FIELD), 200, goodAnswer(answer) ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
}
