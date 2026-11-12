import { upstreamJson } from '../shared/upstream.js';
import { openValueCache, readCachedJson, writeCachedJson } from '../shared/edge-cache.js';

// Public Overpass instances, checked 2026-11-12:
// - overpass-api.de: the main instance.
// - overpass.private.coffee: "free and unlimited", commercial use allowed; its terms ask users to
//   limit simultaneous requests and to give notice above 10 requests/s or 10 concurrent requests
//   (we send at most one per parcel lookup). overpass.kumi.systems now serves the same
//   Private.coffee instance, so it adds no redundancy and is not listed separately.
// - overpass.openstreetmap.fr answers 403 "only available to white-listed usages": not usable.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

// Successful Overpass answers are cached per ~1 km grid cell (0.01 degree) for 30 days: power
// lines rarely move, and repeat lookups in the same area were the main source of 429s. The query
// is centred on the cell and its radius covers SEARCH_RADIUS_M from any point in the cell, so a
// cached cell answers every parcel inside it. Answers Overpass marks as incomplete (a `remark`
// about a timeout or error) are used but not cached.
export const OSM_POWER_CACHE_PREFIX = 'https://acresx.internal/cache/osm-power/v1/';
export const OSM_POWER_CACHE_TTL_SECONDS = 30 * 86400;
export const OSM_CELL_DEG = 0.01;
const SEARCH_RADIUS_M = 5000;
const CELL_MARGIN_M = 800; // half the diagonal of a 0.01 degree cell is under 800 m at these latitudes

export function osmCell(lat, lon) {
  const cellLat = Math.floor(lat / OSM_CELL_DEG), cellLon = Math.floor(lon / OSM_CELL_DEG);
  return { key: `${cellLat}:${cellLon}`, lat: Number(((cellLat + 0.5) * OSM_CELL_DEG).toFixed(4)), lon: Number(((cellLon + 0.5) * OSM_CELL_DEG).toFixed(4)) };
}

// Only the fields the distance and confidence code reads.
function slimElement(e) {
  const tags = e.tags ? { power: e.tags.power, location: e.tags.location, operator: e.tags.operator, voltage: e.tags.voltage } : undefined;
  const out = { type: e.type, id: e.id, tags };
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) { out.lat = e.lat; out.lon = e.lon; }
  if (Array.isArray(e.geometry)) out.geometry = e.geometry.map(p => ({ lat: p.lat, lon: p.lon }));
  if (e.center) out.center = { lat: e.center.lat, lon: e.center.lon };
  return out;
}
const incomplete = data => /timed out|error|out of memory/i.test(String(data?.remark || ''));

function toRadians(value) {
  return value * Math.PI / 180;
}

function distanceFeet(a, b) {
  const earthRadiusFt = 20902231;
  const p1 = toRadians(a.lat);
  const p2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusFt * Math.asin(Math.min(1, Math.sqrt(h)));
}

function geometryPoints(geometry) {
  const points = [];
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push({ lon: Number(value[0]), lat: Number(value[1]) });
      return;
    }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points.filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function minDistanceToParcel(point, geometry, center) {
  const boundaryPoints = geometryPoints(geometry);
  const candidates = boundaryPoints.length ? boundaryPoints : [center];
  return Math.min(...candidates.map(p => distanceFeet(point, p)));
}

function featureType(element) {
  const tags = element.tags || {};
  if (tags.power === 'pole') return 'pole';
  if (tags.power === 'minor_line') return 'minor_line';
  if (tags.power === 'cable') return 'cable';
  if (tags.power === 'transformer') return 'transformer';
  return tags.power || 'power_feature';
}

function infrastructureClass(element) {
  const tags = element.tags || {};
  if (tags.power === 'pole' || tags.power === 'minor_line') return 'overhead_distribution';
  if (tags.power === 'cable' && String(tags.location || '').toLowerCase().includes('underground')) return 'underground_distribution';
  if (tags.power === 'cable') return 'distribution_cable';
  if (tags.power === 'transformer') return 'transformer';
  return 'unknown';
}

function elementPoints(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [{ lat: element.lat, lon: element.lon }];
  if (Array.isArray(element.geometry)) {
    return element.geometry
      .map(p => ({ lat: Number(p.lat), lon: Number(p.lon) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
  if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) {
    return [{ lat: element.center.lat, lon: element.center.lon }];
  }
  return [];
}

// Overpass time box. Was 18 s per endpoint, one after the other: 36 s worst case, past the
// browser's 15 s follow-up limit (public/progressive-loading.js FOLLOWUP_TIMEOUT_MS) and the
// validator's 30 s cap (scripts/validate-county.mjs DEFAULT_TIMEOUT_MS). On 2026-11-10 both
// endpoints reset or hung from a cloud session, and answered 429 to Cloudflare. Now the two
// endpoints share one deadline (default 8 s from the request): the first gets up to 5 s, the
// second whatever is left, and the query's own [timeout:] asks Overpass to stop at the same time.
export const OVERPASS_BUDGET_MS = 8000;
const FIRST_ENDPOINT_MS = 5000;
const MIN_ATTEMPT_MS = 750;

async function overpassQuery(query, { deadline = Date.now() + OVERPASS_BUDGET_MS, signal } = {}) {
  let lastError;
  for (const [index, endpoint] of OVERPASS_ENDPOINTS.entries()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS || signal?.aborted) break;
    const timeoutMs = index === 0 ? Math.min(FIRST_ENDPOINT_MS, left) : left;
    try {
      // One attempt per endpoint (the second endpoint is the retry).
      return await upstreamJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs, queueTimeoutMs: Math.min(timeoutMs, 2000), retries: 0, signal, label: 'overpass-power', agency: 'Overpass'
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || Object.assign(new Error('Overpass did not answer in time'), { kind: 'timeout' });
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

// The cell's Overpass elements: from the edge cache when present, else one query (cached when complete).
async function cellElements(cell, { deadline, signal, ctx }) {
  const slot = await openValueCache(OSM_POWER_CACHE_PREFIX, { cell: cell.key });
  const hit = await readCachedJson(slot);
  if (hit && Array.isArray(hit.elements)) return { elements: hit.elements, cached: true };
  const r = SEARCH_RADIUS_M + CELL_MARGIN_M;
  const serverTimeoutS = Math.max(1, Math.round((deadline - Date.now()) / 1000));
  const query = `[out:json][timeout:${serverTimeoutS}];(node["power"="pole"](around:${r},${cell.lat},${cell.lon});node["power"="transformer"](around:${r},${cell.lat},${cell.lon});way["power"="minor_line"](around:${r},${cell.lat},${cell.lon});way["power"="cable"](around:${r},${cell.lat},${cell.lon}););out tags geom center;`;
  const data = await overpassQuery(query, { deadline, signal });
  const elements = (data.elements || []).map(slimElement);
  if (!incomplete(data)) await writeCachedJson(slot, { elements, fetchedAt: new Date().toISOString() }, OSM_POWER_CACHE_TTL_SECONDS, ctx);
  return { elements, cached: false };
}

export async function getOsmPowerProximity({ lat, lon, geometry, provider, deadline = Date.now() + OVERPASS_BUDGET_MS, signal, ctx }) {
  const center = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    return { available: false, status: 'invalid_location', confidence: 'low' };
  }

  const radiusM = SEARCH_RADIUS_M;
  const cell = osmCell(center.lat, center.lon);

  try {
    const { elements, cached } = await cellElements(cell, { deadline, signal, ctx });
    // The cell query reaches a little past radiusM from this parcel; keep the original radius.
    const data = { elements: elements.filter(e => elementPoints(e).some(p => distanceFeet(center, p) <= radiusM * 3.28084)) };
    const features = (data.elements || []).map(element => {
      const points = elementPoints(element);
      if (!points.length) return null;
      const distanceFt = Math.min(...points.map(point => minDistanceToParcel(point, geometry, center)));
      return {
        osmType: element.type,
        osmId: element.id,
        type: featureType(element),
        infrastructureClass: infrastructureClass(element),
        distanceFt,
        operator: element.tags?.operator || '',
        voltage: element.tags?.voltage || '',
        location: element.tags?.location || '',
        source: 'OpenStreetMap'
      };
    }).filter(Boolean).sort((a, b) => a.distanceFt - b.distanceFt);

    const distributionFeatures = features.filter(f => ['pole','minor_line','cable','transformer'].includes(f.type));
    const nearest = distributionFeatures[0] || null;
    const poles = distributionFeatures.filter(f => f.type === 'pole').length;
    const lines = distributionFeatures.filter(f => f.type === 'minor_line' || f.type === 'cable').length;
    const transformers = distributionFeatures.filter(f => f.type === 'transformer').length;
    const confidence = confidenceFor({ nearest, poles, lines, transformers, providerKnown: Boolean(provider) });

    let status = 'no_mapped_distribution_found';
    let infrastructure = 'unknown';
    if (nearest) {
      status = 'mapped_distribution_found';
      infrastructure = nearest.infrastructureClass;
    }

    return {
      available: true,
      adapter: 'osm-power-v1',
      status,
      provider: provider || '',
      searchRadiusFt: Math.round(radiusM * 3.28084),
      nearest,
      estimatedDistanceFt: nearest ? Math.round(nearest.distanceFt) : null,
      infrastructure,
      confidence: confidence.confidence,
      confidenceScore: confidence.score,
      evidence: {
        mappedPoles: poles,
        mappedDistributionLines: lines,
        mappedTransformers: transformers,
        mappedFeatures: distributionFeatures.length
      },
      nearby: distributionFeatures.slice(0, 8),
      source: 'OpenStreetMap / Overpass API',
      cached,
      cacheCell: cell.key,
      sourceUrl: 'https://www.openstreetmap.org',
      note: nearest
        ? 'Distance is measured to nearby OpenStreetMap-mapped power infrastructure. OSM coverage is incomplete and is not utility-verified.'
        : 'No nearby distribution infrastructure was mapped in OpenStreetMap within the search radius. This does not mean power is unavailable.'
    };
  } catch (error) {
    return {
      available: false,
      adapter: 'osm-power-v1',
      status: error?.kind === 'timeout' || error?.kind === 'cancelled' ? 'timed_out' : 'source_unavailable',
      confidence: 'low',
      error: error?.message || 'OpenStreetMap power proximity unavailable.',
      note: 'Distance not verified: OpenStreetMap power data was unavailable. This does not mean power is unavailable.'
    };
  }
}
