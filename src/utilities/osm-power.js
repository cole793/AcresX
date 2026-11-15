import { upstreamJson } from '../shared/upstream.js';
import { openValueCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';
import { parcelMeasurer } from '../shared/line-distance.js';
import { isFallbackEligible } from '../shared/fallback.js';

// Public Overpass instances, checked 2026-11-12:
// - overpass-api.de: the main instance.
// - overpass.private.coffee: "free and unlimited", commercial use allowed; its terms ask users to
//   limit simultaneous requests and to give notice above 10 requests/s or 10 concurrent requests
//   (we send at most one per parcel lookup). overpass.kumi.systems now serves the same
//   Private.coffee instance, so it adds no redundancy and is not listed separately.
// - overpass.openstreetmap.fr answers 403 "only available to white-listed usages": not usable.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
// Sent to the Overpass hosts only, as Private.coffee's terms ask ("Use a meaningful User-Agent
// header ... your project name and a means to contact you"). Owner decision 2026-11-13: exactly
// this string, no email address.
export const OVERPASS_USER_AGENT = 'AcresX (https://acresx.info)';

// Successful Overpass answers are cached per ~1 km grid cell (0.01 degree) for 30 days: power
// lines rarely move, and repeat lookups in the same area were the main source of 429s. The query
// is centred on the cell and its radii cover the search radii from any point in the cell, so a
// cached cell answers every parcel inside it. Answers Overpass marks as incomplete (a `remark`
// about a timeout or error) are used but not cached.
//
// v2 (2026-11-15): on production every tested parcel answered "distance not verified": Overpass
// gave nothing inside the 9 s budget ("Overpass timed out after 8.7s" from the second endpoint,
// after the first failed). The v1 query asked for every power pole within 5.8 km and only measured
// to vertices; v2 asks for power LINES (line, minor_line, cable) within 3.8 km and
// poles/transformers within 1.4 km only, a much smaller answer, and measures to line segments
// (src/shared/line-distance.js). power=line is classified by its voltage tag (<= 35 kV
// distribution, above that transmission, no tag "unknown"). Each answer lists the endpoints tried
// (`attempts`), and when Overpass still fails the user's browser asks it instead (kind 'osm-power',
// public/browser-fallback.js).
export const OSM_POWER_CACHE_PREFIX = 'https://acresx.internal/cache/osm-power/v2/';
export const OSM_POWER_CACHE_TTL_SECONDS = 30 * 86400;
export const OSM_CELL_DEG = 0.01;
export const LINE_RADIUS_M = 3000;
export const POLE_RADIUS_M = 600;
const CELL_MARGIN_M = 800; // half the diagonal of a 0.01 degree cell is under 800 m at these latitudes
const MAX_BYTES = 4_000_000;
const FT_PER_M = 3.28084;

export function osmCell(lat, lon) {
  const cellLat = Math.floor(lat / OSM_CELL_DEG), cellLon = Math.floor(lon / OSM_CELL_DEG);
  return { key: `${cellLat}:${cellLon}`, lat: Number(((cellLat + 0.5) * OSM_CELL_DEG).toFixed(4)), lon: Number(((cellLon + 0.5) * OSM_CELL_DEG).toFixed(4)) };
}

// The Overpass query for a cell. The browser fallback (public/browser-fallback.js, kind
// 'osm-power') sends the same query.
export function overpassPowerQuery(cell, serverTimeoutS = 8) {
  const lines = LINE_RADIUS_M + CELL_MARGIN_M, poles = POLE_RADIUS_M + CELL_MARGIN_M;
  return `[out:json][timeout:${serverTimeoutS}];(way["power"~"^(line|minor_line|cable)$"](around:${lines},${cell.lat},${cell.lon});node["power"~"^(pole|transformer)$"](around:${poles},${cell.lat},${cell.lon}););out tags geom qt;`;
}

// Only the fields the distance and confidence code reads.
export function slimElement(e) {
  const tags = e.tags ? { power: e.tags.power, location: e.tags.location, operator: e.tags.operator, voltage: e.tags.voltage } : undefined;
  const out = { type: e.type, id: e.id, tags };
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) { out.lat = e.lat; out.lon = e.lon; }
  if (Array.isArray(e.geometry)) out.geometry = e.geometry.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => ({ lat: p.lat, lon: p.lon }));
  return out;
}
const incomplete = data => /timed out|error|out of memory/i.test(String(data?.remark || ''));

// ---- Classification and distance (copied in public/browser-fallback.js; change both together)

// Highest voltage in a tag like "115000;13200", in volts, or null.
function maxVoltage(value) {
  const volts = String(value ?? '').split(/[;,]/).map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v > 0);
  return volts.length ? Math.max(...volts) : null;
}

// { type, lineType: 'distribution' | 'transmission' | 'unknown', infrastructureClass }
export function classifyPowerElement(tags = {}) {
  const power = String(tags.power || '');
  const kv = maxVoltage(tags.voltage);
  const underground = String(tags.location || '').toLowerCase().includes('underground');
  if (power === 'pole') return { type: 'pole', lineType: 'distribution', infrastructureClass: 'overhead_distribution' };
  if (power === 'transformer') return { type: 'transformer', lineType: 'distribution', infrastructureClass: 'transformer' };
  if (power === 'minor_line') return { type: 'minor_line', lineType: 'distribution', infrastructureClass: 'overhead_distribution' };
  if (power === 'cable') {
    if (kv && kv > 35000) return { type: 'cable', lineType: 'transmission', infrastructureClass: 'transmission_cable' };
    return { type: 'cable', lineType: 'distribution', infrastructureClass: underground ? 'underground_distribution' : 'distribution_cable' };
  }
  if (power === 'line') {
    if (kv && kv <= 35000) return { type: 'line', lineType: 'distribution', infrastructureClass: 'overhead_distribution' };
    if (kv) return { type: 'line', lineType: 'transmission', infrastructureClass: 'transmission_line' };
    return { type: 'line', lineType: 'unknown', infrastructureClass: 'mapped_power_line' };
  }
  return { type: power || 'power_feature', lineType: 'unknown', infrastructureClass: 'unknown' };
}

function elementPath(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [[element.lon, element.lat]];
  if (Array.isArray(element.geometry)) return element.geometry.map(p => [Number(p.lon), Number(p.lat)]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) return [[element.center.lon, element.center.lat]];
  return [];
}

function confidenceFor({ nearest, poles, lines, transformers, providerKnown }) {
  let score = providerKnown ? 10 : 0;
  if (nearest && nearest.distanceFt <= 300) score += 40;
  else if (nearest && nearest.distanceFt <= 800) score += 30;
  else if (nearest && nearest.distanceFt <= 1500) score += 20;
  else if (nearest) score += 10;
  if (poles >= 2) score += 20;
  else if (poles === 1) score += 10;
  if (lines >= 1) score += 20;
  if (transformers >= 1) score += 10;

  const confidence = score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low';
  return { score: Math.min(score, 100), confidence };
}

// Overpass elements -> the proximity answer (without the cache fields). Pure.
export function summarizeOsmPower(elements, { lat, lon, geometry = null, provider = '' } = {}) {
  const center = { lat: Number(lat), lon: Number(lon) };
  const lineRadiusFt = Math.round(LINE_RADIUS_M * FT_PER_M);
  const poleRadiusFt = Math.round(POLE_RADIUS_M * FT_PER_M);
  // Every element within its search radius counts as evidence (by the cheap lower bound, distance
  // to the parcel's bounding box). Exact distances are measured only where they can change what is
  // shown: the 8 nearest distribution features and the nearest other line. Measuring every line in
  // a town against every parcel edge took about a second of CPU.
  const measurer = parcelMeasurer({ lat: center.lat, lon: center.lon, geometry });
  const candidates = [];
  for (const element of measurer ? elements || [] : []) {
    const path = elementPath(element);
    if (!path.length) continue;
    const cls = classifyPowerElement(element.tags || {});
    const limit = cls.type === 'pole' || cls.type === 'transformer' ? poleRadiusFt : lineRadiusFt;
    const bound = measurer.bound(path);
    if (bound <= limit) candidates.push({ element, cls, path, limit, bound });
  }
  candidates.sort((a, b) => a.bound - b.bound || String(a.element.id).localeCompare(String(b.element.id)));
  const nearestDistribution = [];
  let otherBest = Infinity;
  const features = [];
  for (const c of candidates) {
    const distribution = c.cls.lineType === 'distribution';
    const needed = distribution ? nearestDistribution.length < 8 || c.bound < nearestDistribution[7] : c.bound < otherBest;
    let distanceFt = null;
    if (needed) {
      distanceFt = measurer.exact(c.path);
      if (distanceFt > c.limit) continue;
      if (distribution) { nearestDistribution.push(distanceFt); nearestDistribution.sort((a, b) => a - b); }
      else otherBest = Math.min(otherBest, distanceFt);
    }
    const element = c.element;
    features.push({
      osmType: element.type,
      osmId: element.id,
      type: c.cls.type,
      lineType: c.cls.lineType,
      infrastructureClass: c.cls.infrastructureClass,
      distanceFt: distanceFt == null ? null : Math.round(distanceFt),
      operator: element.tags?.operator || '',
      voltage: element.tags?.voltage || '',
      location: element.tags?.location || '',
      source: 'OpenStreetMap'
    });
  }
  // Measured features first, nearest first; the rest (counted only) after.
  const order = f => (f.distanceFt == null ? Infinity : f.distanceFt);
  features.sort((a, b) => order(a) - order(b) || String(a.osmId).localeCompare(String(b.osmId)));
  const measured = f => f.distanceFt != null;

  const distributionFeatures = features.filter(f => f.lineType === 'distribution');
  const nearest = distributionFeatures.find(measured) || null;
  const otherLines = features.filter(f => f.lineType !== 'distribution');
  const nearestOtherLine = otherLines.find(measured) || null;
  const poles = distributionFeatures.filter(f => f.type === 'pole').length;
  const lines = distributionFeatures.filter(f => f.type !== 'pole' && f.type !== 'transformer').length;
  const transformers = distributionFeatures.filter(f => f.type === 'transformer').length;
  const confidence = confidenceFor({ nearest, poles, lines, transformers, providerKnown: Boolean(provider) });

  return {
    available: true,
    adapter: 'osm-power-v2',
    status: nearest ? 'mapped_distribution_found' : 'no_mapped_distribution_found',
    provider: provider || '',
    searchRadiusFt: lineRadiusFt,
    poleSearchRadiusFt: poleRadiusFt,
    nearest,
    estimatedDistanceFt: nearest ? nearest.distanceFt : null,
    infrastructure: nearest ? nearest.infrastructureClass : 'unknown',
    lineType: nearest ? 'distribution' : (nearestOtherLine ? nearestOtherLine.lineType : 'unknown'),
    nearestOtherLine,
    confidence: confidence.confidence,
    confidenceScore: confidence.score,
    evidence: {
      mappedPoles: poles,
      mappedDistributionLines: lines,
      mappedTransformers: transformers,
      mappedFeatures: distributionFeatures.length,
      mappedTransmissionLines: otherLines.filter(f => f.lineType === 'transmission').length,
      mappedUnclassifiedLines: otherLines.filter(f => f.lineType === 'unknown').length
    },
    nearby: distributionFeatures.filter(measured).slice(0, 8),
    source: 'OpenStreetMap / Overpass API',
    sourceUrl: 'https://www.openstreetmap.org',
    note: nearest
      ? 'Distance is measured to nearby OpenStreetMap-mapped power infrastructure. OSM coverage is incomplete and is not utility-verified.'
      : 'No nearby distribution infrastructure was mapped in OpenStreetMap within the search radius. This does not mean power is unavailable.'
  };
}

// ---- Overpass requests

// Overpass time box. Was 18 s per endpoint, one after the other: 36 s worst case, past the
// browser's 15 s follow-up limit (public/progressive-loading.js FOLLOWUP_TIMEOUT_MS) and the
// validator's 30 s cap (scripts/validate-county.mjs DEFAULT_TIMEOUT_MS). On 2026-11-10 both
// endpoints reset or hung from a cloud session, and answered 429 to Cloudflare. Now the two
// endpoints share one deadline (default 8 s from the request): the first gets up to 5 s, the
// second whatever is left, and the query's own [timeout:] asks Overpass to stop at the same time.
export const OVERPASS_BUDGET_MS = 8000;
const FIRST_ENDPOINT_MS = 5000;
const MIN_ATTEMPT_MS = 750;

// attempts (out): one { host, ok, kind, status } per endpoint tried, for the answer's
// diagnostics (no URL, query or headers).
async function overpassQuery(query, { deadline = Date.now() + OVERPASS_BUDGET_MS, signal, attempts = [] } = {}) {
  let lastError;
  for (const [index, endpoint] of OVERPASS_ENDPOINTS.entries()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS || signal?.aborted) break;
    const timeoutMs = index === 0 ? Math.min(FIRST_ENDPOINT_MS, left) : left;
    const started = Date.now();
    const host = new URL(endpoint).hostname;
    try {
      // One attempt per endpoint (the second endpoint is the retry).
      const data = await upstreamJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': OVERPASS_USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs, queueTimeoutMs: Math.min(timeoutMs, 2000), retries: 0, signal, maxBytes: MAX_BYTES, label: 'overpass-power', agency: 'Overpass'
      });
      attempts.push({ host, ok: true });
      return data;
    } catch (error) {
      attempts.push({ host, ok: false, kind: error?.kind || 'error', status: error?.status ?? null, afterMs: Math.round((Date.now() - started) / 500) * 500 });
      lastError = error;
    }
  }
  throw lastError || Object.assign(new Error('Overpass did not answer in time'), { kind: 'timeout' });
}

// The cell's Overpass elements: from the edge cache when present, else one query (cached when complete).
async function cellElements(cell, { deadline, signal, ctx, attempts }) {
  const slot = await openValueCache(OSM_POWER_CACHE_PREFIX, { cell: cell.key });
  const hit = await readCachedJson(slot);
  if (hit && Array.isArray(hit.elements)) return { elements: hit.elements, cached: true };
  const serverTimeoutS = Math.max(1, Math.round((deadline - Date.now()) / 1000));
  const data = await overpassQuery(overpassPowerQuery(cell, serverTimeoutS), { deadline, signal, attempts });
  const elements = (data.elements || []).map(slimElement);
  if (!incomplete(data)) await writeCachedJson(slot, { elements, fetchedAt: new Date().toISOString() }, OSM_POWER_CACHE_TTL_SECONDS, ctx);
  return { elements, cached: false };
}

export async function getOsmPowerProximity({ lat, lon, geometry, provider, deadline = Date.now() + OVERPASS_BUDGET_MS, signal, ctx }) {
  const center = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    return { available: false, status: 'invalid_location', confidence: 'low' };
  }
  const cell = osmCell(center.lat, center.lon);
  const attempts = [];
  try {
    const { elements, cached } = await cellElements(cell, { deadline, signal, ctx, attempts });
    return { ...summarizeOsmPower(elements, { ...center, geometry, provider }), cached, cacheCell: cell.key, ...(attempts.length ? { attempts } : {}) };
  } catch (error) {
    return {
      available: false,
      adapter: 'osm-power-v2',
      status: error?.kind === 'timeout' || error?.kind === 'cancelled' ? 'timed_out' : 'source_unavailable',
      confidence: 'low',
      error: error?.message || 'OpenStreetMap power proximity unavailable.',
      // A failure the user's browser might get past (src/shared/fallback.js): network, timeout, 403/429/5xx.
      browserFallback: isFallbackEligible(error) || error?.kind === 'cancelled',
      ...(attempts.length ? { attempts } : {}),
      note: 'Distance not verified: OpenStreetMap power data was unavailable. This does not mean power is unavailable.'
    };
  }
}
