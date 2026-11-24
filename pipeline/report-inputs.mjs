// R4 (docs/explore-index.md section 8): the browser's request builders, REPLICATED here.
//
// ============================================================================================
// THIS FILE IS A COPY OF BROWSER CODE. These pieces exist only inside the page today (inline in
// public/index.html or wired to the DOM), so the batch cannot load them with node:vm. Each
// function names its source; test/index-report-inputs.test.js runs the index.html originals in a
// vm next to these copies and fails when they drift. The plan is to move them into one shared
// public/report-inputs.js (R4) and delete this copy; until then, change both together.
// ============================================================================================
//
// What it builds: the `last` object the dashboard assembles for one parcel (progressive-loading.js
// sections plus the follow-ups that feed the score), with every request body exactly as the page
// sends it. `api(path, body)` performs one in-process Worker call (pipeline/assemble.mjs) and
// resolves { ok, status, data } like the page's fetch + response.json().
import * as turf from '@turf/turf';
import { loadWellTerrain } from './browser-scripts.mjs';

// ---- public/index.html

export const WELL_URL_SERVICE = 'wells'; // arcQuery(WELL_URL, ...) -> /api/arcgis { service: 'wells' }

// index.html findParcel / getParcelIdentity etc. read the parcel the same way.
const props = parcel => parcel?.properties || {};
export const centroid = parcel => turf.centroid(parcel).geometry.coordinates;
const addressOf = p => [p.SITUS_ADDRESS, p.SITUS_CITY_NM, p.SITUS_ZIP_NR].filter(Boolean).join(', ');

// index.html zoningPoint (line 124): centroid when inside, else the nearest inside grid point.
export function zoningPoint(parcel) {
  const c = turf.centroid(parcel).geometry.coordinates;
  try {
    if (typeof turf.booleanPointInPolygon !== 'function' || typeof turf.bbox !== 'function' || turf.booleanPointInPolygon(c, parcel)) return c;
    const [x0, y0, x1, y1] = turf.bbox(parcel);
    let best = null, bd = Infinity;
    for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
      const q = [x0 + (x1 - x0) * i / 24, y0 + (y1 - y0) * j / 24];
      if (turf.booleanPointInPolygon(q, parcel)) { const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2; if (d < bd) { bd = d; best = q; } }
    }
    return best || c;
  } catch (_) { return c; }
}

// index.html arcQuery: throws on a non-OK answer or an `error` body.
async function arcQuery(api, service, params) {
  const r = await api('/api/arcgis', { service, params });
  const j = r.data;
  if (j == null) throw new Error(`Data service returned ${r.status}`);
  if (!r.ok || j.error) throw new Error(j.error || `Data service returned ${r.status}`);
  return j;
}

// index.html findWells (line 112), Washington: Ecology well logs in a widening envelope.
export async function findWellsWA(parcel, api) {
  try {
    const [lon, lat] = turf.centroid(parcel).geometry.coordinates;
    let miles = 2, features = [];
    while (miles <= 64 && features.length < 5) {
      const latPad = miles / 69, lonPad = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
      const env = { xmin: lon - lonPad, ymin: lat - latPad, xmax: lon + lonPad, ymax: lat + latPad, spatialReference: { wkid: 4326 } };
      const d = await arcQuery(api, WELL_URL_SERVICE, { f: 'geojson', where: "WellProjectType <> 'Decommission'", geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326', returnGeometry: 'true', outFields: 'ID,WellTagNr,ProjectName,FileName,CompletedDepth,WorkCompletionDate,WellProjectType,WellSubType,StaticWaterLvl,FlowRateGPM', resultRecordCount: '2000' });
      features = (d.features || []).filter(f => f?.geometry?.type === 'Point' && Number.isFinite(Number(f.geometry.coordinates?.[0])) && Number.isFinite(Number(f.geometry.coordinates?.[1])) && Number.isFinite(Number(f.properties?.CompletedDepth)) && Number(f.properties.CompletedDepth) > 0);
      miles *= 2;
    }
    const boundary = turf.polygonToLine(parcel);
    features.forEach(f => {
      f.properties._distance = turf.pointToLineDistance(f, boundary, { units: 'miles' });
      f.properties._insideParcelBoundary = turf.booleanPointInPolygon(f, parcel);
      f.properties._wellOwnershipStatus = f.properties._insideParcelBoundary ? 'Mapped well point intersects parcel; ownership and active status unverified' : 'Nearby well; not evidence of a well on this parcel';
    });
    return features.sort((a, b) => a.properties._distance - b.properties._distance).slice(0, 5);
  } catch (e) {
    const failed = []; failed.lookupFailed = true; failed.error = e?.message || String(e);
    return failed;
  }
}

// index.html WHOLESALE_POWER, retailProviders, rankedProviders (lines 115-118).
export const WHOLESALE_POWER = /\b(?:bonneville|western area|southwestern|southeastern) power administration\b|^(?:bpa|wapa)\b/i;
export function retailProviders(names) { return [...new Set((Array.isArray(names) ? names : []).map(n => String(n ?? '').trim()).filter(n => n && !WHOLESALE_POWER.test(n)))]; }
export function rankedProviders(d) {
  const list = retailProviders(d?.providers), pr = d?.primary && d.primary.name === list[0] ? d.primary : {};
  if (list.length) { list.primary = list[0]; list.alsoListed = list.slice(1); list.basis = pr.basis || ''; list.resolved = list.length === 1 || pr.resolved === true; list.note = pr.note || ''; }
  return list;
}

// index.html findUtility (line 119). state/county: the page's state and county selects.
export async function findUtility(parcel, api, where) {
  const [lon, lat] = turf.centroid(parcel).geometry.coordinates, p = props(parcel);
  const state = where.state || p._stateCode || 'WA';
  const county = where.county || String(p._countyDisplay || p.COUNTY_NM || '').replace(/ County$/i, '').trim();
  try {
    const r = await api('/api/utility-territory', { state, county, lat, lon });
    const d = r.data;
    if (d == null) throw new Error(`Utility territory service returned ${r.status}`);
    if (!r.ok || !d || d.available === false || d.error) throw new Error(d?.error || `Utility territory service returned ${r.status}`);
    return rankedProviders(d);
  } catch (e) {
    const failed = []; failed.lookupFailed = true; failed.error = e?.message || String(e);
    return failed;
  }
}

// index.html hazardQuery / findFlood / findWetlands (lines 120, 126-127).
async function hazardQuery(kind, parcel, api) {
  const r = await api('/api/hazards', { kind, geometry: parcel.geometry });
  const j = r.data;
  if (j == null) throw new Error(`Hazard service returned ${r.status}`);
  if (!r.ok || j.error) throw new Error(j.error || `Hazard service returned ${r.status}`);
  return j;
}
export async function findFlood(parcel, api) { try { return await hazardQuery('flood', parcel, api); } catch (e) { return { available: false, intersects: false, high: false, zones: [], error: e.message }; } }
export async function findWetlands(parcel, api) { try { return await hazardQuery('wetlands', parcel, api); } catch (e) { return { available: false, intersects: false, count: 0, types: [], error: e.message }; } }

// index.html findZoningPermits (line 125).
export async function findZoningPermits(parcel, api) {
  const p = props(parcel), [lon, lat] = zoningPoint(parcel), id = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '';
  const address = addressOf(p);
  try {
    const r = await api('/api/zoning-permits', { county: p._countyDisplay || p.COUNTY_NM || '', parcelId: id, address, lat, lon, geometry: parcel.geometry, dataLink: p.DATA_LINK || '' });
    const d = r.data;
    if (d == null) throw new Error('Zoning lookup failed');
    if (!r.ok) throw new Error(d.error || 'Zoning lookup failed');
    return d;
  } catch (e) { return { available: false, error: e.message, zoning: { status: 'unavailable' }, permits: [] }; }
}

// index.html findLandAnalysis (line 128). The page then grades septic on it
// (screening-inputs.js apply); the score core re-grades from the same inputs, so no copy is needed.
export async function findLandAnalysis(parcel, api) {
  try {
    const r = await api('/api/land-analysis', { geometry: parcel.geometry });
    const j = r.data;
    if (j == null) throw new Error(`Land analysis returned ${r.status}`);
    if (!r.ok || j.error) throw new Error(j.error || `Land analysis returned ${r.status}`);
    return j;
  } catch (e) { return { available: false, error: e.message, soil: { available: false }, terrain: { available: false } }; }
}

// ---- public/well-terrain.js (the wrapper around findWells; homesite() itself is loaded from the
// browser file with node:vm, not copied)

export const WELL_TERRAIN_WAIT_MS = 12500;
const stateOf = parcel => String(props(parcel)._stateCode || 'WA').toUpperCase();

export async function wellTerrain(parcel, api) {
  const point = loadWellTerrain().homesite(parcel);
  if (!point) return { available: false, status: 'no_point' };
  const [lon, lat] = point;
  const r = await api('/api/well-depth-terrain', { state: stateOf(parcel), lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
  const data = r.data;
  return data && typeof data === 'object' ? data : { available: false, status: 'failed' };
}

// well-terrain.js `wrapped`: the terrain request runs beside the wells lookup and is waited for
// until WAIT_MS after the start; a failed wells lookup gets no terrain answer.
export async function findWellsWithTerrain(parcel, api, { findWells = findWellsWA, waitMs = WELL_TERRAIN_WAIT_MS } = {}) {
  const started = Date.now();
  const pending = wellTerrain(parcel, api).catch(error => ({ available: false, status: 'failed', error: error?.message || String(error) }));
  const wells = await findWells(parcel, api);
  if (!Array.isArray(wells) || wells.lookupFailed) return wells;
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ available: false, status: 'timeout' }), Math.max(0, waitMs - (Date.now() - started))); });
  const answer = await Promise.race([pending, timeout]);
  clearTimeout(timer);
  wells.terrain = answer;
  return wells;
}

// ---- public/public-utilities.js findPublicUtilities (line 212)

export async function findPublicUtilities(parcel, api) {
  const p = props(parcel);
  let point = null;
  try { point = zoningPoint(parcel); } catch (_) { try { point = centroid(parcel); } catch (_) { point = null; } }
  const unavailable = why => ({ available: false, error: why, water: { status: 'unavailable', basis: why }, sewer: { status: 'unavailable', basis: why } });
  if (!point) return unavailable('Parcel location unavailable');
  try {
    const r = await api('/api/public-utilities', { state: String(p._stateCode || 'WA').toUpperCase(), county: p._countyDisplay || p.COUNTY_NM || '', lat: point[1], lon: point[0], geometry: parcel.geometry });
    const data = r.data;
    if (data == null) throw new Error(`Public utilities returned ${r.status}`);
    if (!r.ok || data.error) throw new Error(data.error || `Public utilities returned ${r.status}`);
    return data;
  } catch (error) { return unavailable(error?.message || 'Public water/sewer lookup failed'); }
}

// ---- public/progressive-loading.js SECTIONS (time limits and what a failure leaves behind).
// The listing section (evidence) is not run: it never feeds the score (CLAUDE.md "Rules").

export const SECTIONS = Object.freeze({
  wells: { ms: 15000, fallback: why => { const f = []; f.lookupFailed = true; if (why === 'timeout') f.timedOut = true; return f; } },
  utility: { ms: 15000, fallback: () => [] },
  flood: { ms: 20000, fallback: why => ({ available: false, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
  wetlands: { ms: 20000, fallback: why => ({ available: false, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
  zoningPermits: { ms: 20000, fallback: why => ({ available: false, permits: [], zoning: { status: 'unavailable' }, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }) },
  land: { ms: 20000, fallback: why => ({ available: false, error: why === 'timeout' ? 'Timed out' : 'Land analysis unavailable', soil: { available: false }, terrain: { available: false } }) },
  publicUtilities: { ms: 15000, fallback: why => { const f = { status: 'unavailable', basis: why === 'timeout' ? 'Public water/sewer lookup timed out' : 'Public water/sewer lookup failed' }; return { available: false, water: f, sewer: { ...f }, ...(why === 'timeout' ? { error: 'Timed out', timedOut: true } : {}) }; } }
});

// The find function per section (index.html, as wrapped by state-selector.js and well-terrain.js;
// Washington uses index.html's wells lookup).
export const SECTION_FINDERS = Object.freeze({
  wells: (parcel, api) => findWellsWithTerrain(parcel, api),
  utility: (parcel, api, where) => findUtility(parcel, api, where),
  flood: (parcel, api) => findFlood(parcel, api),
  wetlands: (parcel, api) => findWetlands(parcel, api),
  zoningPermits: (parcel, api) => findZoningPermits(parcel, api),
  land: (parcel, api) => findLandAnalysis(parcel, api),
  publicUtilities: (parcel, api) => findPublicUtilities(parcel, api)
});

// Follow-up time limits: ui-polish.js POWER_TIMEOUT_MS, buildable-area.js REQUEST_MS,
// progressive-loading.js FOLLOWUP_TIMEOUT_MS (cost context). zoning-potential.js sets none.
export const FOLLOWUP_MS = Object.freeze({ powerIntelligence: 20000, buildableArea: 35000, costContext: 15000, zoningDevelopmentPotential: 30000 });

// ---- public/zoning-potential.js currentZoningIdentity + loadPotential's county gates.
// Returns the /api/zoning-rules body, or null when the page sends no request.
export function zoningRulesIdentity(last) {
  const zp = last?.zoningPermits || {};
  const z = zp.zoning || {};
  if (!z.code) return null;
  const county = zp.county || last?.parcel?.properties?._countyDisplay || last?.parcel?.properties?.COUNTY_NM || '';
  const identity = {
    county,
    zoneCode: z.code,
    zoneName: z.name || '',
    jurisdiction: zp.jurisdiction || zp.permitJurisdiction?.name || '',
    jurisdictionType: z.jurisdictionType || '',
    rules: z.rules || '', rulesNote: z.rulesNote || '', rulesUrl: z.rulesUrl || '', rulesUrlLabel: z.rulesUrlLabel || '',
    district: /^gallatin\b/i.test(String(county)) ? (z.district || zp.source?.attributes?.DISTRICT_N || '') : '',
    uga: Boolean(zp.urbanGrowthArea?.intersects),
    developmentAgreement: z.developmentAgreement || zp.comprehensivePlan?.developmentAgreement || ''
  };
  const c = String(identity.county).replace(/\s+County$/i, '').trim();
  if (!/^(spokane|stevens|yellowstone|kootenai|gallatin)$/i.test(c)) return null;
  if (/^spokane$/i.test(c) && ((identity.jurisdictionType && identity.jurisdictionType !== 'county') || (identity.jurisdiction && !/^spokane county$/i.test(identity.jurisdiction))) && identity.rules !== 'mapped') return null;
  if (/^stevens$/i.test(c) && ((identity.jurisdictionType && identity.jurisdictionType !== 'county') || (identity.jurisdiction && !/^stevens county\b/i.test(identity.jurisdiction)))) return null;
  if (/^gallatin$/i.test(c) && identity.jurisdiction && !/^gallatin county$/i.test(identity.jurisdiction)) return null;
  return identity;
}

// zoning-potential.js loadPotential: the answer, or { available: false, error } on a failure.
export async function findZoningRules(identity, api) {
  try {
    const r = await api('/api/zoning-rules', identity);
    const data = r.data;
    if (data == null) throw new Error(`Zoning rules returned ${r.status}`);
    if (!r.ok) throw new Error(data.error || `Zoning rules returned ${r.status}`);
    return data;
  } catch (error) { return { available: false, error: error.message }; }
}

// ---- public/ui-polish.js getParcelIdentity + loadPowerIntelligence (sent only when the utility
// list has a provider).
export function powerIdentity(last, where) {
  const parcel = last?.parcel;
  if (!parcel) return null;
  const p = props(parcel);
  const center = centroid(parcel);
  return {
    state: where.state || p._stateCode || 'WA',
    parcelId: p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '',
    address: addressOf(p),
    lon: center[0],
    lat: center[1],
    geometry: parcel.geometry || null,
    providers: Array.isArray(last.utility) ? last.utility : [],
    providerRanking: { basis: last.utility?.basis || '', resolved: last.utility?.resolved === true, note: last.utility?.note || '' }
  };
}
export async function findPowerIntelligence(identity, api) {
  try {
    const r = await api('/api/power-intelligence', identity);
    const data = r.data;
    if (data == null) throw new Error(`Power intelligence returned ${r.status}`);
    if (!r.ok) throw new Error(data.error || `Power intelligence returned ${r.status}`);
    return data;
  } catch (error) { return { available: false, error: error.message }; }
}

// ---- public/buildable-area.js where + claim + load (sent once flood, wetlands, zoning and
// soil/terrain have settled; the zoning setback goes with it when the rules answer has it).
export const BUILDABLE_WAITS_FOR = Object.freeze(['flood', 'wetlands', 'zoningPermits', 'land']);
export function buildableBody(last, where) {
  const p = props(last?.parcel);
  const zdp = last.zoningDevelopmentPotential || {};
  const code = last.zoningPermits?.zoning?.code || zdp.code || '';
  const w = {
    state: String(p._stateCode || where.state || '').toUpperCase(),
    county: String(p._countyDisplay || where.county || '').replace(/\s+County$/i, '').trim()
  };
  return { geometry: last.parcel.geometry, state: w.state, county: w.county, ...(zdp.available && zdp.setback ? { zoning: { code, setback: zdp.setback } } : {}) };
}
export async function findBuildableArea(body, api) {
  try {
    const r = await api('/api/buildable-area', body);
    const data = r.data;
    if (data == null) throw new Error(`Buildable area returned ${r.status}`);
    if (!r.ok) throw new Error(data?.error || `Buildable area returned ${r.status}`);
    return data;
  } catch (error) {
    return { status: 'unavailable', removed: [], layers: [], notes: [`Buildable area could not be measured (${error?.message || 'request failed'}).`], geometry: null };
  }
}

// ---- public/local-cost-model.js claimCostContext + loadCostContext (road access; the counties
// with local prices, Spokane among them).
export function costContextBody(last, where) {
  const p = props(last?.parcel);
  let point = null;
  try { point = zoningPoint(last.parcel); } catch (_) { try { point = centroid(last.parcel); } catch (_) { point = null; } }
  if (!point) return null;
  const state = String(p._stateCode || where.state || '').toUpperCase();
  const county = String(p._countyDisplay || where.county || '').replace(/\s+County$/i, '').trim();
  return { state, county, lat: point[1], lon: point[0] };
}
export async function findCostContext(body, api) {
  try {
    const r = await api('/api/cost-context', body);
    const data = r.data;
    if (data == null) throw new Error(`Cost context returned ${r.status}`);
    if (!r.ok) throw new Error(data?.error || `Cost context returned ${r.status}`);
    return data;
  } catch (error) {
    const down = { available: false, status: 'source_unavailable', error: error?.message || 'Cost context lookup failed' };
    return { roadAccess: down, watershed: { ...down } };
  }
}

// ---- Parcel search (public/state-selector.js findParcel, Spokane: /api/parcel-search first)
export async function findParcelSpokane(parcelId, api) {
  const r = await api('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: String(parcelId || '').trim() });
  const data = r.data;
  if (r.ok && data?.available && data.parcel?.geometry) return { parcel: data.parcel, answer: data };
  return { parcel: null, answer: data, error: data?.error || data?.note || `Parcel search returned ${r.status}` };
}
