#!/usr/bin/env node
// County validation harness. Runs a set of test parcels through the deployed AcresX API the
// same way the browser does and records a status per data layer.
//
//   node scripts/validate-county.mjs --county kootenai [--base-url URL] [--out DIR]
//   node scripts/validate-county.mjs --county kootenai --discover [--count 12] [--seed N]
//
// Node 22, no dependencies. See validation/README.md.
//
// SAFETY: this script only makes read-only lookups. The deployed Worker shares the live D1
// database (MLS_DB) with production, so the script must never trigger a write:
//   - /api/reso-listings is called WITHOUT `sync` (sync:true pulls MLS pages and writes D1 rows).
//   - GET /api/property-tax-test is never called (it is a fixed self-test, not a parcel lookup).
//   - /api/listing-evidence is not called: it spends paid web-search quota (SERPER/Google) on
//     every request, and the scheduled run would burn it daily.
// assertReadOnly() enforces this for every request the script sends.

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://acresx.cole-groshens.workers.dev';
export const DEFAULT_TIMEOUT_MS = 30000;
const USER_AGENT = 'AcresX-county-validation/1 (+GitHub Actions)';

// Layers in report order. `route` is the /api path the browser uses for that layer.
export const LAYERS = [
  { key: 'parcel', label: 'Parcel', route: '/api/parcel-search' },
  { key: 'wells', label: 'Wells', route: '/api/well-search' },
  { key: 'existingWell', label: 'Existing well', route: '/api/existing-well' },
  { key: 'soil', label: 'Soil', route: '/api/land-analysis' },
  { key: 'terrain', label: 'Terrain', route: '/api/land-analysis' },
  { key: 'slope', label: 'Slope grid', route: '/api/slope-grid' },
  { key: 'flood', label: 'Flood', route: '/api/hazards' },
  { key: 'wetlands', label: 'Wetlands', route: '/api/hazards' },
  { key: 'utility', label: 'Utility', route: '/api/utility-territory' },
  { key: 'power', label: 'Power', route: '/api/power-intelligence' },
  { key: 'zoning', label: 'Zoning', route: '/api/zoning-permits' },
  { key: 'zoningRules', label: 'Zoning rules', route: '/api/zoning-rules' },
  { key: 'assessment', label: 'Assessment', route: '/api/property-assessment' },
  { key: 'listing', label: 'Listing', route: '/api/reso-listings' }
];

// Every route this script may POST to. All are read-only lookups.
export const READ_ONLY_ROUTES = new Set([
  '/api/parcel-search', '/api/well-search', '/api/existing-well', '/api/land-analysis',
  '/api/slope-grid', '/api/hazards', '/api/utility-territory', '/api/power-intelligence',
  '/api/zoning-permits', '/api/zoning-rules', '/api/property-assessment', '/api/reso-listings'
]);

// /api/reso-listings accepts sync options (sync, cursor, incremental, ...) that write to the live
// MLS database. Only these lookup keys may be sent; anything else is refused.
export const RESO_LOOKUP_KEYS = new Set(['parcelId', 'address', 'lat', 'lon']);

// The browser only asks for zoning rules in these counties (public/zoning-potential.js:51).
const ZONING_RULES_COUNTIES = /^(spokane|stevens|yellowstone|kootenai)$/i;

export function assertReadOnly(route, body = {}) {
  if (!READ_ONLY_ROUTES.has(route)) throw new Error(`Refusing to call ${route}: not on the read-only allowlist.`);
  if (route === '/api/reso-listings') {
    const extra = Object.keys(body || {}).filter(k => !RESO_LOOKUP_KEYS.has(k));
    if (extra.length) throw new Error(`Refusing to call /api/reso-listings with ${extra.join(', ')}: only ${[...RESO_LOOKUP_KEYS].join(', ')} are allowed (sync options write to the live MLS database).`);
  }
}

const sleep = ms => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());
const round = (n, d = 1) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 10 ** d) / 10 ** d : null);
const text = v => String(v ?? '').trim();
const finite = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// POST JSON to the AcresX API. Never throws: failures come back as { error }.
export async function postJson(baseUrl, route, body, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  assertReadOnly(route, body);
  const started = Date.now();
  const result = { route, httpStatus: null, ok: false, data: null, error: null, ms: 0 };
  try {
    const response = await fetchImpl(new URL(route, baseUrl).href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.httpStatus = response.status;
    result.ok = response.ok;
    const raw = await response.text();
    try { result.data = JSON.parse(raw); }
    catch { result.error = `invalid JSON (HTTP ${response.status}): ${raw.slice(0, 80).replace(/\s+/g, ' ')}`; }
  } catch (error) {
    result.error = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? `timeout after ${Math.round(timeoutMs / 1000)}s`
      : `request failed: ${error?.message || error}`;
  }
  result.ms = Date.now() - started;
  return result;
}

// Shared first pass: transport, HTTP and top-level `error` failures are layer errors.
export function classifyResponse(res) {
  if (!res) return { status: 'error', detail: 'no response' };
  if (res.error) return { status: 'error', detail: res.error };
  const data = res.data;
  const message = data && typeof data === 'object' ? text(data.error) : '';
  if (!res.ok) return { status: 'error', detail: `HTTP ${res.httpStatus}${message ? `: ${message}` : ''}` };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 'error', detail: 'response was not a JSON object' };
  if (message) return { status: 'error', detail: message };
  return null;
}

// Turf 7 centroid: mean of all vertices, skipping each ring's closing vertex (what the browser
// uses for lat/lon in public/state-selector.js:93 and public/index.html:117).
export function centroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return { lon: Number(geometry.coordinates[0]), lat: Number(geometry.coordinates[1]) };
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let sx = 0, sy = 0, n = 0;
  for (const polygon of polygons) for (const ring of polygon || []) {
    if (!Array.isArray(ring)) continue;
    const last = ring.length - 1;
    ring.forEach((p, i) => {
      if (i === last && last > 0 && p[0] === ring[0][0] && p[1] === ring[0][1]) return;
      if (Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) { sx += p[0]; sy += p[1]; n++; }
    });
  }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

function milesBetween(a, b) {
  const r = 3958.8, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const ok = (detail, values = {}) => ({ status: 'ok', detail, values });
const unavailable = (detail, values = {}) => ({ status: 'unavailable', detail, values });
const fail = (detail, values = {}) => ({ status: 'error', detail, values });

// Per-layer interpretation of a response that passed classifyResponse().
export const interpret = {
  parcel(data) {
    const f = data.parcel;
    if (!f?.geometry) return fail('response had no parcel geometry');
    const p = f.properties || {};
    const c = centroid(f.geometry);
    if (!c) return fail('parcel geometry has no usable coordinates');
    const values = {
      parcelId: text(p.ORIG_PARCEL_ID || p.PARCEL_ID_NR) || null,
      acres: round(p.ACRES, 2),
      address: [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', ') || null,
      lat: round(c.lat, 6), lon: round(c.lon, 6)
    };
    return ok(`parcel ${values.parcelId || '?'}${values.acres != null ? `, ${values.acres} ac` : ''}`, values);
  },
  wells(data, ctx = {}) {
    if (data.available === false) return unavailable(text(data.label || data.status) || 'well search not available');
    const wells = Array.isArray(data.wells) ? data.wells : [];
    if (!wells.length) return unavailable('no well records found near parcel', { wellCount: 0 });
    // The browser sorts by distance to the parcel boundary; centroid distance is close enough here.
    const withDistance = wells.map(w => {
      const c = w?.geometry?.type === 'Point' ? { lon: Number(w.geometry.coordinates[0]), lat: Number(w.geometry.coordinates[1]) } : null;
      return { w, mi: c && ctx.center ? milesBetween(ctx.center, c) : Infinity };
    }).sort((a, b) => a.mi - b.mi).slice(0, 5);
    const depths = withDistance.map(x => finite(x.w.properties?.CompletedDepth)).filter(d => d != null && d > 0);
    return ok(`${wells.length} well record(s), ${depths.length} of nearest 5 report depth`, {
      wellCount: wells.length,
      nearestDepthsCount: depths.length,
      nearestMi: Number.isFinite(withDistance[0]?.mi) ? round(withDistance[0].mi, 2) : null,
      medianDepthFt: depths.length ? [...depths].sort((a, b) => a - b)[Math.floor(depths.length / 2)] : null
    });
  },
  existingWell(data) {
    if (data.available === false) return unavailable(text(data.label || data.status) || 'existing-well screening not available', { status: data.status || null });
    return ok(text(data.label) || 'screened', { status: data.status || null, confidence: data.confidence || null, score: finite(data.score) });
  },
  soil(data) {
    const soil = data.soil || {};
    if (soil.available) return ok(`${soil.feasibility || 'unclassified'} (${soil.mapUnit || 'map unit n/a'})`, {
      feasibility: soil.feasibility || null, mapUnit: soil.mapUnit || null, hydrologicGroup: soil.hydrologicGroup || null,
      drainage: soil.drainage || null, soilSlopePct: round(soil.soilSlopePct)
    });
    if (soil.error) return fail(text(soil.error));
    return unavailable(text(soil.note || soil.label) || 'no soil data at parcel center');
  },
  terrain(data) {
    const t = data.terrain || {};
    if (t.available) return ok(`avg grade ${round(t.gradePct)}%, max ${round(t.maxGradePct)}%`, {
      gradePct: round(t.gradePct), maxGradePct: round(t.maxGradePct), reliefFt: round(t.reliefFt, 0), sampleCount: finite(t.sampleCount)
    });
    if (t.error) return fail(text(t.error));
    return unavailable('no terrain data');
  },
  slope(data) {
    if (!data.available) return unavailable(text(data.note) || 'slope grid not available');
    const cells = Array.isArray(data.cells) ? data.cells : [];
    const grades = cells.map(c => finite(c.gradePct)).filter(g => g != null);
    const avg = grades.length ? grades.reduce((s, g) => s + g, 0) / grades.length : null;
    return ok(`${cells.length} cells, avg ${round(avg)}%`, {
      cellCount: cells.length, avgSlopePct: round(avg), maxSlopePct: grades.length ? round(Math.max(...grades)) : null, partial: Boolean(data.partial)
    });
  },
  flood(data) {
    if (!data.available) return unavailable('flood screening not available');
    const zones = Array.isArray(data.zones) ? data.zones : [];
    const provider = text(data.source?.provider) || null;
    // coverage 'high-and-moderate-risk-only': answer came from the Esri fallback, which holds only
    // high/moderate-risk areas. emptyResult: that source found nothing (src/services/flood.js).
    const coverage = text(data.source?.coverage) || null;
    const limited = coverage === 'high-and-moderate-risk-only';
    const emptyResult = data.source?.emptyResult === true ? true : null;
    const via = provider ? ` (via ${provider}${limited ? ', high/moderate-risk zones only' : ''})` : '';
    const summary = data.high ? `high-risk zone (${zones.join(', ')})` : zones.length ? `zones ${zones.join(', ')}`
      : limited ? 'no high/moderate-risk zone mapped' : 'no mapped FEMA zone';
    return ok(`${summary}${via}`, {
      high: Boolean(data.high), intersects: Boolean(data.intersects), zones, provider, coverage, emptyResult
    });
  },
  wetlands(data) {
    if (!data.available) return unavailable('wetland screening not available');
    return ok(data.intersects ? `${data.count} NWI feature(s)` : 'no NWI wetlands', {
      intersects: Boolean(data.intersects), count: finite(data.count) ?? 0, coveragePct: round(data.coveragePct)
    });
  },
  utility(data) {
    const providers = Array.isArray(data.providers) ? data.providers.filter(Boolean) : [];
    if (providers.length) return ok(providers.join('; '), { providers });
    if (data.available === false) return unavailable('utility territory not available', { providers });
    return unavailable(text(data.note) || 'no mapped electric provider', { providers });
  },
  power(data) {
    if (!data.available) return unavailable(text(data.status) || 'power intelligence not available', { provider: data.provider || null });
    const d = data.distribution || {};
    const ft = finite(d.estimatedDistanceFt);
    return ok(`${data.provider || 'provider unknown'}${ft != null ? `, ~${Math.round(ft)} ft to mapped power` : ''}`, {
      provider: data.provider || null, distanceFt: ft != null ? Math.round(ft) : null, confidence: d.confidence || null, distributionStatus: d.status || null
    });
  },
  zoning(data) {
    const z = data.zoning || {};
    const values = {
      code: z.code || null, jurisdiction: data.jurisdiction || data.permitJurisdiction?.name || null,
      countyStatus: data.countyStatus || null, zoningStatus: z.status || null,
      allowedBuildings: data.allowedBuildings?.status || null, permitHistoryStatus: data.permitHistoryStatus || null
    };
    if (!data.available || !z.code) return unavailable(text(z.label || z.note) || 'no zoning result', values);
    return ok(`${z.code} (${values.jurisdiction || 'jurisdiction n/a'})`, values);
  },
  zoningRules(data) {
    if (!data.available) return unavailable(text(data.status) || 'zoning rules not available', { status: data.status || null });
    const uses = Array.isArray(data.uses) ? data.uses : [];
    return ok(`${data.code || data.zoneCode || '?'}: ${data.family || 'rules'} (${uses.length} uses)`, {
      code: data.code || data.zoneCode || null, family: data.family || null, useCount: uses.length
    });
  },
  assessment(data) {
    const record = (Array.isArray(data.statewideRecords) && data.statewideRecords[0]) || (Array.isArray(data.records) && data.records[0]) || null;
    if (!data.available || !record) return unavailable('no assessment record found');
    const pick = keys => { for (const k of keys) { const v = finite(record[k]); if (v != null) return v; } return null; };
    const total = pick(['VAL_TOTAL', 'TotalValue', 'total_value']);
    const land = pick(['VAL_LAND', 'TotalLandValue', 'land_value']);
    // "Tax present" = the record carries a tax amount (not just a tax year).
    const taxPresent = Object.entries(record).some(([k, v]) => /tax/i.test(k) && !/year|_yr|id$|code|area|dist/i.test(k) && finite(v) > 0);
    return ok(`assessed ${total != null ? `$${total.toLocaleString('en-US')}` : 'n/a'}${taxPresent ? ', tax amount present' : ', no tax amount'}`, {
      assessedValue: total, landValue: land, improvementValue: pick(['VAL_IMPVTS', 'TotalBuildingValue']), taxPresent, source: data.statewideSource || data.source || null
    });
  },
  listing(data) {
    if (data.configured === false) return unavailable('listing source not configured');
    if (!data.available) return unavailable(text(data.status) || 'listing lookup not available');
    const values = { matchCount: finite(data.matchCount) ?? 0, confidence: data.matchConfidence || null, listingStatus: data.best?.status || null };
    if (!data.best) return unavailable('no listing match in connected dataset (not evidence the parcel is unlisted)', values);
    return ok(`${data.best.status || 'listing'} match, ${data.matchConfidence || '?'} confidence`, values);
  }
};

export function interpretLayer(key, res, ctx) {
  const pre = classifyResponse(res);
  const base = { route: res?.route || null, httpStatus: res?.httpStatus ?? null, ms: res?.ms ?? null };
  if (pre) return { ...base, ...pre, values: {} };
  try { return { ...base, ...interpret[key](res.data, ctx) }; }
  catch (error) { return { ...base, status: 'error', detail: `could not read response: ${error.message}`, values: {} }; }
}

const notRequested = detail => ({ status: 'unavailable', detail: `not requested: ${detail}`, values: {}, route: null, httpStatus: null, ms: null });
const skipped = detail => ({ status: 'skipped', detail, values: {}, route: null, httpStatus: null, ms: null });

// Reproduces the browser's request sequence for one parcel (Idaho/Montana path; see README).
export async function validateParcel(entry, { state, county, baseUrl, fetchImpl, timeoutMs, requestDelayMs = 250 } = {}) {
  const opts = { fetchImpl, timeoutMs };
  const call = async (route, body) => { const res = await postJson(baseUrl, route, body, opts); await sleep(requestDelayMs); return res; };
  const layers = {};
  const parcelId = text(entry.parcelId);

  // 1. Parcel (public/state-selector.js:83).
  const parcelRes = await call('/api/parcel-search', { state, county, parcelId });
  layers.parcel = interpretLayer('parcel', parcelRes);
  if (layers.parcel.status !== 'ok') {
    for (const { key } of LAYERS) if (key !== 'parcel') layers[key] = skipped('parcel lookup failed');
    return { parcelId, label: entry.label || '', why: entry.why || '', layers };
  }

  const parcel = parcelRes.data.parcel;
  const p = parcel.properties || {};
  const geometry = parcel.geometry;
  const center = centroid(geometry);
  const { lat, lon } = center;
  const parcelCounty = p._countyDisplay || p.COUNTY_NM || '';
  const resolvedId = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '';
  const address = [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', ');
  const ctx = { center };

  // 2. The browser runs these in parallel after the parcel loads (public/index.html:201).
  //    We run them one at a time to be gentle on county servers.
  layers.wells = interpretLayer('wells', await call('/api/well-search', { state, county, lat, lon }), ctx);
  const utilityRes = await call('/api/utility-territory', { state, county, lat, lon });
  layers.utility = interpretLayer('utility', utilityRes);
  const floodRes = await call('/api/hazards', { kind: 'flood', geometry });
  layers.flood = interpretLayer('flood', floodRes);
  layers.wetlands = interpretLayer('wetlands', await call('/api/hazards', { kind: 'wetlands', geometry }));
  const zoningRes = await call('/api/zoning-permits', { county: parcelCounty, parcelId: resolvedId, address, lat, lon, geometry, dataLink: p.DATA_LINK || '' });
  layers.zoning = interpretLayer('zoning', zoningRes);
  const landRes = await call('/api/land-analysis', { geometry });
  layers.soil = interpretLayer('soil', landRes);
  layers.terrain = interpretLayer('terrain', landRes);

  // 3. Follow-up lookups the frontend modules make after the summary renders.
  // public/existing-well.js:146 skips the call without a parcel number or geometry.
  const wellParcelId = resolvedId || p.PARCEL_ID || '';
  layers.existingWell = !wellParcelId || !geometry
    ? notRequested(`parcel has no ${!wellParcelId ? 'parcel number' : 'geometry'} (the browser skips this call too)`)
    : interpretLayer('existingWell', await call('/api/existing-well', { state, county: parcelCounty || county, parcelId: wellParcelId, address, geometry }));
  // property-assessment.js sends the parcel number exactly as the user typed it.
  layers.assessment = interpretLayer('assessment', await call('/api/property-assessment', { state, county, parcelId }));

  // Listing context: lookup only. Never add `sync` here (see the header comment).
  layers.listing = interpretLayer('listing', await call('/api/reso-listings', { parcelId: resolvedId || parcelId || undefined, address: address || undefined }));

  const providers = layers.utility.status === 'ok' ? layers.utility.values.providers : [];
  layers.power = providers.length
    ? interpretLayer('power', await call('/api/power-intelligence', { parcelId: resolvedId, address, lon, lat, geometry, providers }))
    : notRequested('no utility provider identified (the browser skips this call too)');

  const zoningData = classifyResponse(zoningRes) ? null : zoningRes.data;
  const zoneCode = zoningData?.zoning?.code;
  const rulesCounty = String(zoningData?.county || parcelCounty || '').replace(/\s+County$/i, '').trim();
  if (!zoneCode) layers.zoningRules = notRequested('no zoning code returned (the browser skips this call too)');
  else if (!ZONING_RULES_COUNTIES.test(rulesCounty)) layers.zoningRules = notRequested(`the browser has no zoning rules for ${rulesCounty || 'this county'}`);
  else layers.zoningRules = interpretLayer('zoningRules', await call('/api/zoning-rules', {
    county: zoningData.county || parcelCounty, zoneCode, zoneName: zoningData.zoning.name || '',
    jurisdiction: zoningData.jurisdiction || zoningData.permitJurisdiction?.name || '',
    uga: Boolean(zoningData.urbanGrowthArea?.intersects),
    developmentAgreement: zoningData.zoning.developmentAgreement || zoningData.comprehensivePlan?.developmentAgreement || ''
  }));

  // Slope grid loads when the user turns on the slope map (public/slope-map.js:108).
  layers.slope = interpretLayer('slope', await call('/api/slope-grid', { geometry }));

  return { parcelId, label: entry.label || '', why: entry.why || '', layers };
}

// --- expected values -------------------------------------------------------------------------

function sameValue(expected, actual) {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(actual)) return actual.some(item => sameValue(expected, item));
  if (typeof expected === 'object') {
    const n = finite(actual);
    if (n == null) return false;
    return (expected.min === undefined || n >= expected.min) && (expected.max === undefined || n <= expected.max);
  }
  if (typeof expected === 'boolean') return actual === expected;
  if (typeof expected === 'number') return finite(actual) === expected;
  return text(expected).toUpperCase() === text(actual).toUpperCase();
}

// expected: { "zoning": "ok", "zoning.code": "AG", "flood.high": false, "terrain.gradePct": {"max": 15} }
export function compareExpected(expected, layers) {
  const mismatches = [];
  for (const [key, want] of Object.entries(expected || {})) {
    const [layerKey, field] = key.split('.', 2);
    const layer = layers[layerKey];
    const actual = !layer ? undefined : field ? layer.values?.[field] : layer.status;
    if (!layer || !sameValue(want, actual)) mismatches.push({ key, layer: layerKey, expected: want, actual: actual ?? null });
  }
  return mismatches;
}

export function applyExpected(result, expected) {
  const mismatches = compareExpected(expected, result.layers);
  for (const m of mismatches) if (result.layers[m.layer]) (result.layers[m.layer].mismatches ||= []).push(m);
  result.mismatches = mismatches;
  return result;
}

export function cellStatus(layer) {
  if (!layer) return 'n/a';
  return layer.mismatches?.length ? 'mismatch' : layer.status;
}

export function summarize(results) {
  const counts = { ok: 0, unavailable: 0, error: 0, mismatch: 0, skipped: 0 };
  let failed = 0;
  for (const r of results) {
    let bad = false;
    for (const { key } of LAYERS) {
      const s = cellStatus(r.layers[key]);
      if (s in counts) counts[s]++;
      if (s === 'error' || s === 'mismatch') bad = true;
    }
    if (bad) failed++;
  }
  return { parcels: results.length, failed, layerCounts: counts };
}

// --- markdown --------------------------------------------------------------------------------

const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function formatValue(v) {
  if (Array.isArray(v)) return v.join('; ') || '(none)';
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Field names listed in the markdown probe line; the discovered JSON has them all.
export const MAX_FIELD_NAMES_SHOWN = 40;

// One row per ArcGIS request discovery made. Full query URLs are in <county>-discovered.json.
export function diagnosticsMarkdown(diagnostics) {
  const lines = ['## Discovery diagnostics', ''];
  const failed = diagnostics.filter(x => !x.ok).length;
  lines.push(`Requests: ${diagnostics.length}, failed: ${failed}. Features is the feature count, or the row count for count queries. Full URLs are in the discovered JSON.`, '');
  const probe = diagnostics.find(x => x.step === 'probe layer metadata');
  if (probe) {
    lines.push(`- Layer probe: HTTP ${probe.httpStatus ?? '-'}, content-type ${probe.contentType || '(none)'}, fields checked: ${(probe.fieldsChecked || []).join(', ') || '(none)'}, missing: ${(probe.missingFields || []).join(', ') || 'none'}`);
    if (Array.isArray(probe.fieldNames)) {
      const shown = probe.fieldNames.slice(0, MAX_FIELD_NAMES_SHOWN).join(', ');
      const more = probe.fieldNames.length - MAX_FIELD_NAMES_SHOWN;
      lines.push(`- Layer fields (${probe.fieldNames.length}): ${shown || '(none)'}${more > 0 ? `, ... (+${more} more, full list in the discovered JSON)` : ''}`);
    }
    for (const note of probe.notes || []) lines.push(`- Field check: ${note}`);
    lines.push('');
  }
  lines.push('| Step | HTTP | Features | ms | Error |', '|---|---|---|---|---|');
  for (const x of diagnostics) lines.push(`| ${cell(x.step)} | ${x.httpStatus ?? '-'} | ${x.featureCount ?? '-'} | ${x.ms ?? '-'} | ${cell(x.error || '')} |`);
  lines.push('');
  return lines;
}

export function buildMarkdown(report) {
  const { county, state, baseUrl, startedAt, results, summary } = report;
  const lines = [];
  lines.push(`# County validation: ${county}, ${state}`, '');
  lines.push(`- Base URL: ${baseUrl}`);
  lines.push(`- Run: ${startedAt}${report.discovered ? ' (discovered sample)' : ''}`);
  lines.push(`- Parcels: ${summary.parcels}, with an error or mismatch: ${summary.failed}`);
  lines.push(`- Layer results: ${Object.entries(summary.layerCounts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  if (Array.isArray(report.discoveryDiagnostics)) lines.push(...diagnosticsMarkdown(report.discoveryDiagnostics));
  if (!results.length) {
    lines.push('No parcels to validate. Add parcels to the county file or run with `--discover`.');
    return lines.join('\n') + '\n';
  }
  lines.push(`| Parcel | ${LAYERS.map(l => l.label).join(' | ')} |`);
  lines.push(`|---|${LAYERS.map(() => '---').join('|')}|`);
  for (const r of results) lines.push(`| ${cell(r.parcelId)} | ${LAYERS.map(l => cell(cellStatus(r.layers[l.key]))).join(' | ')} |`);
  lines.push('', '## Parcel details', '');
  for (const r of results) {
    lines.push(`### ${cell(r.parcelId)}${r.label ? ` (${cell(r.label)})` : ''}`, '');
    if (r.why) lines.push(`Why: ${r.why}`, '');
    for (const { key, label } of LAYERS) {
      const layer = r.layers[key];
      if (!layer) continue;
      const values = Object.entries(layer.values || {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${formatValue(v)}`).join(', ');
      lines.push(`- **${label}**: ${cellStatus(layer)}. ${cell(layer.detail)}${values ? ` [${cell(values)}]` : ''}`);
      for (const m of layer.mismatches || []) lines.push(`  - mismatch \`${m.key}\`: expected ${formatValue(m.expected)}, got ${formatValue(m.actual)}`);
    }
    lines.push('');
  }
  lines.push('Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.');
  return lines.join('\n') + '\n';
}

// --- discovery (queries the county's public ArcGIS parcel layer directly) ---------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sqlString = v => `'${String(v).replaceAll("'", "''")}'`;
const normCity = v => text(v).toUpperCase().replace(/[^A-Z]/g, '');

function cityVariants(cities) {
  const out = new Set();
  for (const c of cities || []) { const u = text(c).toUpperCase(); out.add(u); out.add(u.replace(/'/g, '')); out.add(u.replace(/'/g, ' ')); }
  return [...out].filter(Boolean);
}

// One stratum per acreage band x (named city / other locality). Without an acres field there is
// one "any acreage" band; without a city field, one "any locality" place.
export function buildDiscoveryStrata(d) {
  const cityList = cityVariants(d.cities).map(sqlString).join(',');
  const places = d.cityField
    ? [['city-named locality', `UPPER(${d.cityField}) IN (${cityList})`], ['other/blank locality', `(${d.cityField} IS NULL OR UPPER(${d.cityField}) NOT IN (${cityList}))`]]
    : [['any locality', null]];
  const bands = d.acresField ? d.acreBands || [] : [{ label: 'any acreage' }];
  const strata = [];
  for (const band of bands) {
    const acres = [band.min != null ? `${d.acresField} >= ${Number(band.min)}` : null, band.max != null ? `${d.acresField} < ${Number(band.max)}` : null].filter(Boolean).join(' AND ');
    for (const [placeLabel, placeWhere] of places) {
      strata.push({ id: `${band.label} | ${placeLabel}`, band: band.label, place: placeLabel, where: [d.where, acres, placeWhere].filter(Boolean).map(w => `(${w})`).join(' AND ') });
    }
  }
  return strata;
}

export function arcgisQueryUrl(layerUrl, params = {}) {
  const url = new URL(`${layerUrl.replace(/\/$/, '')}/query`);
  url.searchParams.set('f', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.href;
}

const snippet = (body, max = 200) => String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// "TypeError: fetch failed (cause: ENOTFOUND getaddrinfo ENOTFOUND host)" and similar.
export function describeNetworkError(error) {
  const base = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
  const cause = error?.cause;
  if (!cause) return base;
  const causeText = [cause.code, cause.message].filter(Boolean).join(' ') || String(cause);
  return `${base} (cause: ${causeText})`;
}

export function describeArcgisError(err) {
  const details = (Array.isArray(err?.details) ? err.details : err?.details ? [err.details] : []).map(String).filter(Boolean);
  return `ArcGIS error${err?.code != null ? ` ${err.code}` : ''}: ${err?.message || 'request failed'}${details.length ? ` (details: ${details.join('; ')})` : ''}`;
}

const tagged = (message, fields) => Object.assign(new Error(message), fields);

// GET an ArcGIS REST URL with f=json. Returns { data, httpStatus, contentType }. Errors carry
// httpStatus/contentType when a response arrived, and say what came back (status, content type,
// start of the body, ArcGIS error code/details, or the network error cause).
export async function arcgisGet(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw tagged(`network error: ${describeNetworkError(error)}`, { httpStatus: null, contentType: null });
  }
  const httpStatus = response.status;
  const contentType = response.headers?.get?.('content-type') || '';
  let body;
  try { body = await response.text(); }
  catch (error) { throw tagged(`HTTP ${httpStatus}, body read failed: ${describeNetworkError(error)}`, { httpStatus, contentType }); }
  const what = `HTTP ${httpStatus}, content-type ${contentType || '(none)'}, body: ${snippet(body) || '(empty)'}`;
  if (!response.ok) {
    let arcgis = null;
    try { arcgis = JSON.parse(body)?.error || null; } catch { /* not JSON */ }
    throw tagged(arcgis ? `ArcGIS returned HTTP ${httpStatus}: ${describeArcgisError(arcgis)}` : `ArcGIS returned ${what}`, { httpStatus, contentType });
  }
  let data;
  try { data = JSON.parse(body); }
  catch { throw tagged(`ArcGIS returned non-JSON (${what})`, { httpStatus, contentType }); }
  if (data?.error) throw tagged(describeArcgisError(data.error), { httpStatus, contentType });
  return { data, httpStatus, contentType };
}

// Caps on discovery query size, so a county config can't ask a county server for huge pages.
export const MAX_PER_QUERY = 200;
export const MAX_DISTINCT_ZONES = 200;

function toCandidate(d, attrs, stratum) {
  return {
    parcelId: text(attrs[d.idField]),
    acres: d.acresField ? finite(attrs[d.acresField]) : null,
    zoning: d.zoningField ? text(attrs[d.zoningField]) || null : null,
    city: d.cityField ? text(attrs[d.cityField]) || null : null,
    address: d.addressField ? text(attrs[d.addressField]) || null : null,
    stratum: stratum?.id || null, band: stratum?.band || null, place: stratum?.place || null
  };
}

// Greedy pick: each step takes the candidate that adds the most variety (new stratum, new
// zoning value, new locality), ties broken by the seeded random order. With zoning: false (no
// zoning field configured) variety comes from stratum and locality only.
export function pickVaried(candidates, count, seed = 1, { zoning: useZoning = true } = {}) {
  const rand = mulberry32(seed);
  const pool = candidates.filter(c => c.parcelId).map(c => ({ c, r: rand() }));
  const seen = { stratum: new Map(), zoning: new Map(), city: new Map(), id: new Set() };
  const picked = [];
  while (picked.length < count) {
    let best = null, bestScore = -Infinity;
    for (const item of pool) {
      const { c } = item;
      if (seen.id.has(c.parcelId)) continue;
      const score = (seen.stratum.get(c.stratum) ? -seen.stratum.get(c.stratum) : 4) + (!useZoning || seen.zoning.get(c.zoning || '') ? 0 : 2) + (seen.city.get(normCity(c.city)) ? 0 : 1) + item.r * 0.5;
      if (score > bestScore) { best = item; bestScore = score; }
    }
    if (!best) break;
    const c = best.c;
    const reasons = [];
    if (c.stratum && !seen.stratum.get(c.stratum)) reasons.push(`covers stratum "${c.stratum}"`);
    if (useZoning && !seen.zoning.get(c.zoning || '')) reasons.push(`first parcel with ZONING ${c.zoning || '(blank)'}`);
    if (!seen.city.get(normCity(c.city))) reasons.push(`first in locality ${c.city || '(blank)'}`);
    seen.id.add(c.parcelId);
    seen.stratum.set(c.stratum, (seen.stratum.get(c.stratum) || 0) + 1);
    seen.zoning.set(c.zoning || '', (seen.zoning.get(c.zoning || '') || 0) + 1);
    seen.city.set(normCity(c.city), (seen.city.get(normCity(c.city)) || 0) + 1);
    picked.push({
      parcelId: c.parcelId,
      label: `${c.city || 'no locality'}, ${c.acres != null ? `${round(c.acres, 2)} ac` : 'acres n/a'}${useZoning ? `, ZONING ${c.zoning || 'blank'}` : ''}`,
      why: `Discovered sample: ${reasons.length ? reasons.join('; ') : 'fills remaining sample slots'}. Locality is the parcel's situs city field, not proof it is inside city limits.`,
      expected: {},
      countyAttributes: { acres: c.acres, zoning: c.zoning, city: c.city, address: c.address, stratum: c.stratum }
    });
  }
  return picked;
}

// Checks that the layer answers from here and that the configured field names exist on it.
export async function probeLayer(d, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(d.layerUrl.replace(/\/$/, ''));
  url.searchParams.set('f', 'json');
  const configured = ['idField', 'acresField', 'zoningField', 'cityField', 'addressField'].map(k => d[k]).filter(Boolean);
  const entry = { step: 'probe layer metadata', url: url.href, ok: false, httpStatus: null, contentType: null, error: null, featureCount: null, ms: 0, fieldsChecked: configured, missingFields: [], fieldNames: null };
  const started = performance.now();
  try {
    const { data, httpStatus, contentType } = await arcgisGet(url.href, { fetchImpl, timeoutMs });
    Object.assign(entry, { httpStatus, contentType });
    const names = Array.isArray(data?.fields) ? data.fields.map(f => text(f?.name)).filter(Boolean) : null;
    entry.fieldNames = names;
    if (!names) {
      entry.missingFields = configured;
      entry.error = 'layer metadata has no fields list';
    } else {
      const lower = new Map(names.map(n => [n.toLowerCase(), n]));
      entry.missingFields = configured.filter(f => !names.includes(f)).map(f => lower.has(f.toLowerCase()) ? `${f} (layer has ${lower.get(f.toLowerCase())})` : f);
      entry.ok = !entry.missingFields.length;
      if (!entry.ok) entry.error = `missing fields: ${entry.missingFields.join(', ')}`;
    }
  } catch (error) {
    Object.assign(entry, { httpStatus: error.httpStatus ?? null, contentType: error.contentType ?? null, error: error.message });
  }
  entry.ms = Math.round(performance.now() - started);
  return entry;
}

const DISCOVER_FIELD_KEYS = ['idField', 'acresField', 'zoningField', 'cityField', 'addressField'];

// Keeps only configured fields the layer has (fieldNames from probeLayer), so one missing field
// doesn't fail every query. A wrong-case name uses the layer's spelling. Returns the config to
// use, notes for the diagnostics, and an abort reason when idField is missing. Without a fields
// list (the probe failed) the config is used as is.
export function resolveDiscoverFields(d, fieldNames) {
  const resolved = { ...d }, notes = [];
  if (!Array.isArray(fieldNames)) return { discover: resolved, notes, abort: null };
  const lower = new Map(fieldNames.map(n => [n.toLowerCase(), n]));
  for (const key of DISCOVER_FIELD_KEYS) {
    const name = d[key];
    if (!name || fieldNames.includes(name)) continue;
    const actual = lower.get(String(name).toLowerCase());
    if (actual) { resolved[key] = actual; notes.push(`${key} ${name} is ${actual} on the layer; using ${actual}`); continue; }
    if (key === 'idField') return { discover: resolved, notes, abort: `discovery stopped: idField ${name} is not on the layer, so no parcel ids can be sampled` };
    delete resolved[key];
    notes.push(`${key} ${name} is not on the layer; left out of this run's queries`);
  }
  return { discover: resolved, notes, abort: null };
}

// Returns { parcels, diagnostics }. diagnostics has one entry per ArcGIS request (the layer
// probe first), so a run that finds nothing still says why in the published results.
export async function discoverParcels(config, { count = 12, seed = 1, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {} } = {}) {
  const configured = config.discover;
  if (!configured?.layerUrl || !configured.idField) throw new Error(`No discover config (layerUrl, idField) for ${config.county}.`);
  const opts = { fetchImpl, timeoutMs };
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const perQuery = Math.min(MAX_PER_QUERY, Math.max(1, Math.floor(Number(configured.perQuery) || 50)));
  const delayMs = Number(configured.delayMs ?? 300);
  const candidates = [];
  const diagnostics = [];

  const probe = await probeLayer(configured, opts);
  diagnostics.push(probe);
  log(`discover: layer probe: HTTP ${probe.httpStatus ?? '-'}${probe.error ? `, ${probe.error}` : ', fields ok'}`);
  const { discover: d, notes, abort } = resolveDiscoverFields(configured, probe.fieldNames);
  if (notes.length || abort) probe.notes = abort ? [...notes, abort] : notes;
  for (const note of probe.notes || []) log(`discover: ${note}`);
  if (abort) { probe.aborted = true; return { parcels: [], diagnostics }; }
  const outFields = DISCOVER_FIELD_KEYS.map(k => d[k]).filter(Boolean).join(',');
  await sleep(delayMs);

  // One recorded ArcGIS query. It rethrows, so the discovery flow below is unchanged.
  const query = async (step, params) => {
    const url = arcgisQueryUrl(d.layerUrl, params);
    const entry = { step, url, ok: false, httpStatus: null, error: null, featureCount: null, ms: 0 };
    diagnostics.push(entry);
    const started = performance.now();
    try {
      const { data, httpStatus } = await arcgisGet(url, opts);
      entry.ok = true;
      entry.httpStatus = httpStatus;
      entry.featureCount = Array.isArray(data?.features) ? data.features.length : Number.isFinite(Number(data?.count)) ? Number(data.count) : null;
      return data;
    } catch (error) {
      entry.httpStatus = error.httpStatus ?? null;
      entry.error = error.message;
      throw error;
    } finally {
      entry.ms = Math.round(performance.now() - started);
    }
  };

  for (const stratum of buildDiscoveryStrata(d)) {
    try {
      let offset = 0;
      try {
        const counted = await query(`${stratum.id} (count)`, { where: stratum.where, returnCountOnly: 'true' });
        const total = Number(counted.count) || 0;
        if (!total) { log(`discover: ${stratum.id}: 0 parcels`); await sleep(delayMs); continue; }
        offset = Math.floor(rand() * Math.max(0, total - perQuery));
        log(`discover: ${stratum.id}: ${total} parcels, sampling from offset ${offset}`);
      } catch (error) { log(`discover: ${stratum.id}: count failed (${error.message}); sampling from the start`); }
      await sleep(delayMs);
      const params = { where: stratum.where, outFields, returnGeometry: 'false', resultRecordCount: perQuery };
      let data;
      try { data = await query(`${stratum.id} (sample${offset ? `, offset ${offset}` : ''})`, offset ? { ...params, resultOffset: offset } : params); }
      catch (error) { if (!offset) throw error; data = await query(`${stratum.id} (sample, retry without offset)`, params); }
      for (const f of data.features || []) candidates.push(toCandidate(d, f.attributes || {}, stratum));
    } catch (error) { log(`discover: ${stratum.id}: query failed (${error.message})`); }
    await sleep(delayMs);
  }

  // Zoning values the strata missed: one small query each, so rarer zones get a chance.
  if (d.zoningField) {
    try {
      const distinct = await query('distinct-zoning', { where: d.where || '1=1', outFields: d.zoningField, returnDistinctValues: 'true', returnGeometry: 'false', resultRecordCount: MAX_DISTINCT_ZONES });
      const zones = [...new Set((distinct.features || []).map(f => text(f.attributes?.[d.zoningField])).filter(Boolean))];
      const have = new Set(candidates.map(c => c.zoning));
      const missing = zones.filter(z => !have.has(z)).slice(0, count);
      log(`discover: ${zones.length} distinct ZONING values, ${missing.length} not yet sampled`);
      for (const zone of missing) {
        try {
          const data = await query(`zoning ${zone}`, { where: [d.where, `${d.zoningField} = ${sqlString(zone)}`].filter(Boolean).map(w => `(${w})`).join(' AND '), outFields, returnGeometry: 'false', resultRecordCount: 5 });
          for (const f of data.features || []) candidates.push(toCandidate(d, f.attributes || {}, { id: `zoning ${zone}`, band: null, place: null }));
        } catch (error) { log(`discover: zoning ${zone}: query failed (${error.message})`); }
        await sleep(delayMs);
      }
    } catch (error) { log(`discover: distinct ZONING query failed (${error.message})`); }
  }

  log(`discover: ${candidates.length} candidates`);
  return { parcels: pickVaried(candidates, count, seed, { zoning: Boolean(d.zoningField) }), diagnostics };
}

// --- run -------------------------------------------------------------------------------------

export async function validateCounty(config, { parcels = config.parcels || [], baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, delayMs = 1500, requestDelayMs = 250, log = () => {} } = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const [i, entry] of parcels.entries()) {
    if (i > 0) await sleep(delayMs);
    log(`validate: ${entry.parcelId} (${i + 1}/${parcels.length})`);
    let result;
    try {
      result = await validateParcel(entry, { state: config.state, county: config.county, baseUrl, fetchImpl, timeoutMs, requestDelayMs });
    } catch (error) {
      result = { parcelId: text(entry.parcelId), label: entry.label || '', why: entry.why || '', layers: { parcel: { status: 'error', detail: `harness error: ${error.message}`, values: {} } } };
    }
    applyExpected(result, entry.expected);
    results.push(result);
  }
  return { county: config.county, state: config.state, baseUrl, startedAt, finishedAt: new Date().toISOString(), results, summary: summarize(results) };
}

export function parseArgs(argv) {
  const args = { county: '', baseUrl: '', out: 'validation-results', discover: false, count: 12, seed: null, delayMs: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--county') args.county = next();
    else if (a === '--base-url') args.baseUrl = next();
    else if (a === '--out') args.out = next();
    else if (a === '--discover') args.discover = true;
    else if (a === '--count') args.count = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--delay') args.delayMs = Number(next());
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^[a-z0-9-]+$/.test(args.county || '')) throw new Error('--county is required (lowercase file name in validation/counties/, e.g. kootenai).');
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error('--count must be a positive integer.');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = message => console.error(message);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(await readFile(path.join(root, 'validation', 'counties', `${args.county}.json`), 'utf8'));
  const baseUrl = args.baseUrl || process.env.ACRESX_BASE_URL || DEFAULT_BASE_URL;
  await mkdir(args.out, { recursive: true });

  let parcels = config.parcels || [];
  let seed = null;
  let diagnostics = null;
  if (args.discover) {
    seed = Number.isFinite(args.seed) && args.seed !== null ? args.seed : Date.now() % 2147483647;
    ({ parcels, diagnostics } = await discoverParcels(config, { count: args.count, seed, log }));
    const discovered = { county: config.county, state: config.state, seed, generatedAt: new Date().toISOString(), parcels, diagnostics };
    const json = JSON.stringify(discovered, null, 2);
    await writeFile(path.join(args.out, `${args.county}-discovered.json`), json + '\n');
    console.log(json);
  }

  const report = await validateCounty(config, { parcels, baseUrl, delayMs: args.delayMs, log });
  if (args.discover) { report.discovered = true; report.seed = seed; report.discoveryDiagnostics = diagnostics; }
  const markdown = buildMarkdown(report);
  await writeFile(path.join(args.out, `${args.county}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(args.out, `${args.county}.md`), markdown);
  console.log(markdown);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `failed=${report.summary.failed}\n`);
  log(`failed parcels: ${report.summary.failed}/${report.summary.parcels}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
}
