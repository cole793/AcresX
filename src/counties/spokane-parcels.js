// Spokane County parcel lookup for /api/parcel-search (state WA, county Spokane).
//
// Source: Spokane County GIS Assessor/Parcels/MapServer/0 ("Parcels", native SR 2926,
// maxRecordCount 2000). It is the assessor's own parcel layer: PID_NUM is the parcel number
// (35204.2729) and acreage is the assessor acreage. Its fields are OBJECTID, PID_NUM, PIDMAP,
// site_address, site_city, soil_id, acreage, site_zip, seg_status and the shape; it has no owner
// or mailing field. 214,711 rows, 214,707 distinct PID_NUMs (the repeats are placeholder ids
// such as UNKNOWN), checked 2026-11-10.
//
// Why: the browser found Spokane parcels on the WA statewide layer (Current_Parcels on
// services.arcgis.com, findParcel in public/index.html), which took 5-25 s and once timed out at
// 25 s. Measured 2026-11-10, 10 validation parcels each, exact-id query as findParcel sends it:
// statewide median 6.6 s (max 8.1 s), this layer median 0.36 s (max 0.59 s).
// public/state-selector.js asks /api/parcel-search first for Spokane and falls back to the
// statewide lookup in the browser when this answers available:false (no match, an id that cannot
// be a Spokane PID, or an error), so a failure here only costs the statewide lookup it replaced.
//
// Properties are mapped to the names the frontend reads for statewide WA parcels
// (ORIG_PARCEL_ID, PARCEL_ID_NR, FIPS_NR, SITUS_*, DATA_LINK, _countyDisplay) plus ACRES, the
// assessor acreage the "show both" acreage display reads (public/acreage.js).
import { arcgisJson, cachedJson } from '../shared/upstream.js';
import { esriPolygonToGeoJSON } from './kootenai-parcels.js';
import { normalizeSpokaneParcelId, spokaneScoutUrl } from './spokane-assessor.js';

export const SPOKANE_PARCEL_LAYER = 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/Parcels/MapServer/0';
export const SPOKANE_PARCEL_SOURCE = 'Spokane County GIS (Assessor/Parcels layer)';
export const SPOKANE_PARCEL_FIELDS = 'PID_NUM,site_address,site_city,site_zip,acreage,seg_status';
// One 6 s attempt (body included), no retry: on a failure the browser goes to the statewide layer.
export const SPOKANE_PARCEL_TIMEOUT_MS = 6000;
// Only the fields above and the outline are cached. Bump the version whenever they change.
export const SPOKANE_PARCEL_CACHE_PREFIX = 'https://acresx.internal/cache/spokane-parcels/v1/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const FIELDS = SPOKANE_PARCEL_FIELDS.split(',');

function str(value) { return String(value ?? '').trim(); }
function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }

// The layer fills a missing situs with placeholders ("0 ADDRESS UNKNOWN S", "0 UNKNOWN BABB RD",
// "Unassigned Address", city "UNKNOWN", zip "00000"); the statewide layer has none for those
// parcels (46301.9025, 48121.9001), so they become '' and are not searched as addresses.
// Cities are upper-cased like the statewide layer ("Elk" -> "ELK").
export function situs(attrs = {}) {
  const address = str(attrs.site_address), city = str(attrs.site_city).toUpperCase(), zip = str(attrs.site_zip);
  return {
    SITUS_ADDRESS: /\bUNKNOWN\b|^UNASSIGNED\b/i.test(address) ? '' : address,
    SITUS_CITY_NM: city === 'UNKNOWN' ? '' : city,
    SITUS_ZIP_NR: /^0+$/.test(zip) ? '' : zip
  };
}

// Layer attributes -> the properties the frontend reads. Named fields only.
export function mapSpokaneParcel(attrs = {}, geometry = null) {
  const pid = str(attrs.PID_NUM);
  return {
    type: 'Feature', geometry,
    properties: {
      FIPS_NR: '063', COUNTY_NM: 'Spokane',
      ORIG_PARCEL_ID: pid, PARCEL_ID_NR: `063-${pid}`,
      _countyDisplay: 'Spokane', _stateCode: 'WA', _stateDisplay: 'Washington',
      ...situs(attrs),
      DATA_LINK: spokaneScoutUrl(undefined, pid) || '',
      ACRES: num(attrs.acreage),
      _source: { name: SPOKANE_PARCEL_SOURCE, url: SPOKANE_PARCEL_LAYER }
    }
  };
}

// Duplicate rows (the same outline stored twice) would double the mapped area: identical parts
// are kept once, other parts become one MultiPolygon.
function mergeGeometries(geometries) {
  const polygons = [], seen = new Set();
  for (const g of geometries) {
    const parts = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of parts) { const key = JSON.stringify(p); if (!seen.has(key)) { seen.add(key); polygons.push(p); } }
  }
  if (!polygons.length) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

async function fetchLayer(id) {
  const data = await arcgisJson(`${SPOKANE_PARCEL_LAYER}/query`, {
    where: `PID_NUM='${id}'`, outFields: SPOKANE_PARCEL_FIELDS, returnGeometry: 'true', outSR: '4326', resultRecordCount: '10'
  }, {
    timeoutMs: SPOKANE_PARCEL_TIMEOUT_MS, retries: 0, label: 'spokane-parcel-search', agency: 'Spokane County parcel layer',
    arcgisMessage: message => `Spokane County parcel layer: ${message || 'query failed'}`
  });
  return (Array.isArray(data?.features) ? data.features : []).map(f => {
    const attrs = f?.attributes || {}, attributes = {};
    for (const key of FIELDS) if (key in attrs) attributes[key] = attrs[key];
    return { attributes, geometry: f?.geometry ?? null };
  });
}

// The parcel Feature, or null when the layer has no such PID (or the input cannot be one).
// Throws when the layer fails.
export async function findSpokaneCountyParcel(parcelInput) {
  const id = normalizeSpokaneParcelId(parcelInput);
  if (!id) return null;
  const rows = (await cachedJson(SPOKANE_PARCEL_CACHE_PREFIX, id, CACHE_TTL_SECONDS, () => fetchLayer(id), {
    isValid: features => Array.isArray(features) && features.length > 0
  })).filter(f => str(f.attributes?.PID_NUM) === id);
  if (!rows.length) return null;
  const geometry = mergeGeometries(rows.map(f => esriPolygonToGeoJSON(f.geometry)));
  if (!geometry) return null;
  return mapSpokaneParcel(rows[0].attributes, geometry);
}

// The /api/parcel-search answer for Spokane. Always HTTP 200: a miss or a failure is
// available:false (with note or error), and the browser then uses the statewide layer.
export async function searchSpokaneParcel(parcelId) {
  const base = { state: 'WA', county: 'Spokane', source: SPOKANE_PARCEL_SOURCE };
  try {
    const parcel = await findSpokaneCountyParcel(parcelId);
    if (parcel) return { body: { available: true, ...base, parcel }, cache: 'public, max-age=300, s-maxage=3600' };
    return { body: { available: false, ...base, parcel: null, note: 'No Spokane County parcel layer match; use the statewide parcel layer.' }, cache: 'no-store' };
  } catch (error) {
    console.warn('Spokane county parcel lookup failed', error?.message || error);
    const message = error?.kind === 'timeout' ? 'Spokane County parcel layer timed out' : String(error?.message || 'Spokane County parcel layer unavailable');
    return { body: { available: false, ...base, parcel: null, error: message }, cache: 'no-store' };
  }
}
