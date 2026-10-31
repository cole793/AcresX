// Kootenai County parcel lookup for /api/parcel-search (state ID, county Kootenai).
//
// Source: Kootenai County GIS NewServices/Ownership_Display MapServer layer 0 ("Parcel Polygon",
// native SR 2243, maxRecordCount 1000). It is the county's own parcel layer: the PIN/PID here are
// the assessor's, and Acres is the assessor acreage. The statewide Idaho layer has no Kootenai
// rows (checked 2026-10-27) and rate-limits; IDWR's compilation has Kootenai outlines but only
// PIN/COUNTY/OWNER attributes. src/states/idaho/parcels.js calls this first for Kootenai and
// falls back to those services when this layer errors or has no match.
//
// The layer also has the owner's name (`Name`). KC_PARCEL_SEARCH_FIELDS lists only non-personal
// fields, and mapKootenaiParcel() copies named fields only, so owner data cannot reach the
// response even if the server sent it.

import { arcgisJson, cachedJson } from '../shared/upstream.js';

export const KC_PARCEL_LAYER = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0';
export const KC_PARCEL_SOURCE = 'Kootenai County GIS (Ownership_Display parcel layer)';
// Never add Name here: it is the owner's name.
export const KC_PARCEL_SEARCH_FIELDS = 'PIN,PID,Acres,Loc_Addr,Loc_City';
// One 8 s attempt (body included), no retry. If it times out (or another outage a browser might
// get past), /api/parcel-search answers at once with a browser fallback hint; on an ArcGIS error
// the statewide and IDWR layers are the retry. Answers that found rows are cached 7 days (Cache
// API); empty answers and errors are not.
export const KC_PARCEL_TIMEOUT_MS = 8000;
const TIMEOUT_MS = KC_PARCEL_TIMEOUT_MS;
// Only the KC_PARCEL_SEARCH_FIELDS attributes and the outline are kept (before caching and before
// use), so owner fields the server might send anyway are never stored. Bump the version in the
// prefix whenever KC_PARCEL_SEARCH_FIELDS changes, so no entry in the old shape survives.
export const KC_PARCEL_CACHE_PREFIX = 'https://acresx.internal/cache/kootenai-parcels/v3/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

function sql(value) { return String(value ?? '').replaceAll("'", "''"); }
function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function str(value) { return String(value ?? '').trim(); }
function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }

// PIN is the 12-character parcel number (47N03W052200); PID is the dashed form (47N03W-05-2200).
// Searching either column with the typed value, upper-cased, covers both spellings.
export function kootenaiParcelWhere(parcelId) {
  const id = sql(str(parcelId).toUpperCase());
  return `PIN='${id}' OR PID='${id}'`;
}

// --- Esri JSON polygon -> GeoJSON ------------------------------------------------------------
// Esri rings: outer rings clockwise, holes counter-clockwise, all in one flat list, parts in any
// order. GeoJSON (RFC 7946): each polygon is [outer CCW, ...holes CW]. Each hole goes to the
// smallest outer ring that contains it; a "hole" inside no outer ring is kept as its own polygon.

function closeRing(ring) {
  const pts = ring.map(p => [Number(p[0]), Number(p[1])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length && (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1])) pts.push([...pts[0]]);
  return pts;
}
// Shoelace sum; > 0 means counter-clockwise with x east, y north.
function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function esriPolygonToGeoJSON(esriGeometry) {
  const rings = (Array.isArray(esriGeometry?.rings) ? esriGeometry.rings : []).map(closeRing).filter(r => r.length >= 4);
  const outers = [], holes = [];
  for (const ring of rings) {
    const a = signedArea(ring);
    if (a === 0) continue;
    if (a < 0) outers.push({ ring: [...ring].reverse(), area: -a, holes: [] }); // CW -> CCW
    else holes.push(ring);
  }
  for (const hole of holes) {
    // A vertex of the hole may sit on the outer boundary; test a vertex and its edge midpoint.
    const probes = [hole[0], [(hole[0][0] + hole[1][0]) / 2, (hole[0][1] + hole[1][1]) / 2]];
    const owner = outers.filter(o => probes.some(p => pointInRing(p, o.ring))).sort((a, b) => a.area - b.area)[0];
    if (owner) owner.holes.push([...hole].reverse()); // CCW -> CW
    else outers.push({ ring: hole, area: signedArea(hole), holes: [] }); // already CCW
  }
  const polygons = outers.map(o => [o.ring, ...o.holes]);
  if (!polygons.length) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

// Duplicate rows (same outline stored twice) would double the mapped area, so exact-duplicate
// parts are kept once.
function mergeGeometries(geometries) {
  const polygons = [], seen = new Set();
  const add = polygon => { const key = JSON.stringify(polygon); if (!seen.has(key)) { seen.add(key); polygons.push(polygon); } };
  for (const g of geometries) {
    if (g?.type === 'Polygon') add(g.coordinates);
    else if (g?.type === 'MultiPolygon') g.coordinates.forEach(add);
  }
  if (!polygons.length) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

// --- Layer attributes -> the properties /api/parcel-search returns ---------------------------
// Same property names the statewide path fills (src/states/idaho/parcels.js normalizeFeature),
// because the frontend reads those: ORIG_PARCEL_ID, PARCEL_ID_NR, SITUS_*, COUNTY_NM,
// _countyDisplay, DATA_LINK, ACRES. The layer has no ZIP or assessor link, so those stay ''.
// Named fields only (no spread of attrs).
export function mapKootenaiParcel(attrs = {}, geometry = null) {
  const pin = str(attrs.PIN);
  return {
    type: 'Feature', geometry,
    properties: {
      PIN: pin, PID: str(attrs.PID), COUNTY: 'Kootenai',
      ORIG_PARCEL_ID: pin, PARCEL_ID_NR: pin, COUNTY_NM: 'Kootenai',
      _countyDisplay: 'Kootenai', _stateCode: 'ID', _stateDisplay: 'Idaho',
      SITUS_ADDRESS: str(attrs.Loc_Addr), SITUS_CITY_NM: str(attrs.Loc_City), SITUS_ZIP_NR: '',
      DATA_LINK: '', ACRES: num(attrs.Acres),
      _assessment: { categories: '' },
      _source: { name: KC_PARCEL_SOURCE, url: KC_PARCEL_LAYER }
    }
  };
}

async function fetchLayer(where) {
  const data = await arcgisJson(`${KC_PARCEL_LAYER}/query`, { where, outFields: KC_PARCEL_SEARCH_FIELDS, returnGeometry: 'true', outSR: '4326', resultRecordCount: '20' }, {
    timeoutMs: TIMEOUT_MS, retries: 0, label: 'kootenai-parcel-search', agency: 'Kootenai County parcel layer',
    arcgisMessage: message => `Kootenai County parcel layer: ${message || 'query failed'}`
  });
  return Array.isArray(data?.features) ? data.features.map(searchFieldsOnly) : [];
}
const SEARCH_FIELDS = KC_PARCEL_SEARCH_FIELDS.split(',');
function searchFieldsOnly(feature) {
  const attrs = feature?.attributes || {};
  const attributes = {};
  for (const key of SEARCH_FIELDS) if (key in attrs) attributes[key] = attrs[key];
  return { attributes, geometry: feature?.geometry ?? null };
}
function queryLayer(where) {
  return cachedJson(KC_PARCEL_CACHE_PREFIX, { where }, CACHE_TTL_SECONDS, () => fetchLayer(where), { isValid: features => Array.isArray(features) && features.length > 0 });
}

// Returns the parcel Feature, or null when the county layer has no such PIN/PID.
// Throws when the layer fails or when the identifier matches more than one parcel.
export async function findKootenaiCountyParcel(parcelInput) {
  const raw = str(parcelInput); const compact = normalize(raw);
  if (!compact) return null;
  const features = (await queryLayer(kootenaiParcelWhere(raw)))
    .filter(f => normalize(f.attributes?.PIN) === compact || normalize(f.attributes?.PID) === compact);
  if (!features.length) return null;
  // A parcel can be stored as several rows with the same PIN; merge them into one outline.
  const byPin = new Map();
  for (const f of features) {
    const key = normalize(f.attributes?.PIN);
    if (!byPin.has(key)) byPin.set(key, []);
    byPin.get(key).push(f);
  }
  if (byPin.size > 1) {
    const error = new Error('Multiple Idaho parcels match that identifier. Confirm the exact county parcel number.');
    error.ambiguous = true; // a real answer, not an outage: the caller must not fall back
    throw error;
  }
  const rows = [...byPin.values()][0];
  const geometry = mergeGeometries(rows.map(f => esriPolygonToGeoJSON(f.geometry)));
  if (!geometry) return null;
  return mapKootenaiParcel(rows[0].attributes, geometry);
}
