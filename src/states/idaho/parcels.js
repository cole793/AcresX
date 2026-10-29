import { cachedJson, upstreamJson } from '../../shared/upstream.js';
import { findKootenaiCountyParcel } from '../../counties/kootenai-parcels.js';
import { PERSONAL_FIELD } from '../../shared/personal-fields.js';
import { FALLBACK_KINDS, fallbackHint, isFallbackEligible } from '../../shared/fallback.js';

const IDAHO_PARCELS = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7';
const IDWR_PARCELS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

// ArcGIS Online answers a rate limit either as HTTP 429 or as HTTP 200 with
// {error:{code:429, message:'Unable to perform query. Too many requests.'}}.
function isRateLimit(error) { return error?.status === 429 || Number(error?.code) === 429 || /too many requests/i.test(String(error?.message || '')); }
// Wait before the one retry of a statewide query (tests shorten it).
export const RATE_LIMIT_RETRY_MS = { value: 600 };

// Only the Kootenai fallback queries (statewide layer for Kootenai, IDWR) are cached: their
// answers have owner and mailing fields removed before they are stored and before they are used,
// which is what the Kootenai response does anyway. Other Idaho counties still return the
// statewide owner fields in /api/parcel-search (a decision pending with the owner), so their
// answers are never cached. Feature lists that found parcels are cached per query for 7 days;
// errors and empty answers (a parcel may be added) are never cached.
// Bump the version in the prefix whenever the fields requested or stripped change, so no entry
// in the old shape survives.
export const IDAHO_PARCEL_CACHE_PREFIX = 'https://acresx.internal/cache/idaho-parcels/v2/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Through the shared client (src/shared/upstream.js). Was one 20 s attempt (plus one retry on a
// statewide rate limit); now 12 s + one retry at 8 s (body included) on a timeout, network error,
// 5xx or non-4xx ArcGIS error, and for the statewide layer also on a rate limit.
async function fetchService(service, where, count, { retryRateLimit, label }) {
  const url = new URL(`${service}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  const data = await upstreamJson(url, {
    timeoutMs: 12000, retryTimeoutMs: 8000, arcgis: true, label, agency: 'Idaho parcel service', arcgisMessage: 'Idaho parcel search failed',
    ...(retryRateLimit ? { backoffMs: RATE_LIMIT_RETRY_MS.value, retryOn: error => isRateLimit(error) || Boolean(error.retryable) } : {})
  });
  return data.features || [];
}

function queryService(service, where, count = 20, { retryRateLimit = false, label = 'idaho-parcels', ownerFree = false } = {}) {
  if (!ownerFree) return fetchService(service, where, count, { retryRateLimit, label });
  return cachedJson(IDAHO_PARCEL_CACHE_PREFIX, { service, where, count }, CACHE_TTL_SECONDS,
    async () => (await fetchService(service, where, count, { retryRateLimit, label })).map(withoutOwnerProperties),
    { isValid: features => Array.isArray(features) && features.length > 0 });
}
async function query(where, count = 20, { ownerFree = false } = {}) { return queryService(IDAHO_PARCELS, where, count, { retryRateLimit: true, label: 'idaho-statewide-parcels', ownerFree }); }

function normalizeFeature(feature, requestedId, county = '') {
  const attrs = feature.properties || {};
  const parcelId = String(attrs.PARCEL_ID || attrs.FP_ID || attrs.PIN || requestedId || '').trim();
  const countyDisplay = String(county || attrs.County || attrs.COUNTY || '').replace(/\s+County$/i, '').trim();
  return {
    type: 'Feature', geometry: feature.geometry,
    properties: {
      ...attrs, ORIG_PARCEL_ID: parcelId, PARCEL_ID_NR: parcelId, COUNTY_NM: countyDisplay,
      _countyDisplay: countyDisplay, _stateCode: 'ID', _stateDisplay: 'Idaho',
      SITUS_ADDRESS: String(attrs.SITE_ADD || '').trim(), SITUS_CITY_NM: String(attrs.SITE_CITY || '').trim(),
      SITUS_ZIP_NR: String(attrs.SITE_ZIP || '').trim(), DATA_LINK: String(attrs.WEBSITE || '').trim(), ACRES: attrs.ASR_ACRES,
      _assessment: { landValue: attrs.VAL_LAND, improvementValue: attrs.VAL_IMPVTS, totalValue: attrs.VAL_TOTAL, categories: attrs.ASR_CATS || '' }
    }
  };
}

function kootenaiVariants(raw) {
  const compact = normalize(raw); const variants = new Set([String(raw || '').trim().toUpperCase(), compact]);
  const m = compact.match(/^(\d{2}[NS]\d{2}[EW])(\d{2})([A-Z0-9]{4})$/);
  if (m) variants.add(`${m[1]}-${m[2]}-${m[3]}`);
  return [...variants].filter(Boolean);
}

async function findKootenaiIdwr(raw) {
  const compact = normalize(raw);
  const variants = kootenaiVariants(raw);
  for (const candidate of variants) {
    const features = await queryService(IDWR_PARCELS, `UPPER(PIN)='${sql(candidate)}' AND UPPER(COUNTY)='KOOTENAI'`, 20, { label: 'idwr-parcels', ownerFree: true });
    const exact = features.filter(f => normalize(f.properties?.PIN) === compact);
    if (exact.length) return exact;
  }
  // County assessor PINs are canonical without dashes; normalize punctuation if IDWR retained it.
  const prefix = compact.slice(0, Math.min(8, compact.length));
  const broad = await queryService(IDWR_PARCELS, `UPPER(COUNTY)='KOOTENAI' AND UPPER(PIN) LIKE '${sql(prefix)}%'`, 200, { label: 'idwr-parcels', ownerFree: true });
  return broad.filter(f => normalize(f.properties?.PIN) === compact);
}

// Statewide layer 7 lookup by PARCEL_ID / FP_ID (Kootenai also tries the dashed PIN and a prefix match).
async function findStatewide(raw, countyName, { ownerFree = false } = {}) {
  const compact = normalize(raw);
  const countySafe = sql(countyName); const countyWhere = countySafe ? `UPPER(County)='${countySafe.toUpperCase()}' AND ` : '';
  const variants = /^kootenai$/i.test(countyName) ? kootenaiVariants(raw) : [...new Set([raw.toUpperCase(), compact])];
  let features = [];
  for (const candidate of variants) {
    features = await query(`${countyWhere}(UPPER(PARCEL_ID)='${sql(candidate)}' OR UPPER(FP_ID)='${sql(candidate)}')`, 20, { ownerFree });
    if (features.length) break;
  }
  if (!features.length && /^kootenai$/i.test(countyName)) {
    const prefix = compact.slice(0, Math.min(8, compact.length));
    const broad = await query(`${countyWhere}(UPPER(PARCEL_ID) LIKE '${sql(prefix)}%' OR UPPER(FP_ID) LIKE '${sql(prefix)}%')`, 200, { ownerFree });
    features = broad.filter(feature => [feature.properties?.PARCEL_ID, feature.properties?.FP_ID].some(value => normalize(value) === compact));
  }
  return features;
}

function pickOne(features, raw, county) {
  const compact = normalize(raw);
  const exact = features.filter(feature => {
    const p = feature.properties || {}; return [p.PARCEL_ID, p.FP_ID, p.PIN].some(value => normalize(value) === compact);
  });
  const pool = exact.length ? exact : features; const unique = new Map();
  for (const feature of pool) {
    const p = feature.properties || {}; const key = `${normalize(p.County || p.COUNTY)}:${normalize(p.PARCEL_ID || p.FP_ID || p.PIN || JSON.stringify(feature.geometry))}`;
    if (!unique.has(key)) unique.set(key, feature);
  }
  if (unique.size > 1) throw new Error('Multiple Idaho parcels match that identifier. Confirm the exact county parcel number.');
  return normalizeFeature([...unique.values()][0], raw, county);
}

const NOT_FOUND = 'Parcel not found in available Idaho parcel sources. Confirm the county and assessor parcel number.';

// Owner name and mailing address fields of the statewide (OWNER1, OWNER2, PUBLIC_STD, MAIL_*)
// and IDWR (OWNER) layers. Kootenai answers never carry them.
const OWNER_FIELD = /^(OWNER\d*|PUBLIC_STD|MAIL_.*|Name)$/i;
const isOwnerField = key => OWNER_FIELD.test(key) || PERSONAL_FIELD.test(key);
function withoutOwnerProperties(feature) {
  const properties = {};
  for (const [k, v] of Object.entries(feature?.properties || {})) if (!isOwnerField(k)) properties[k] = v;
  return { ...feature, properties };
}
function withoutOwnerFields(feature, source) {
  const stripped = withoutOwnerProperties(feature);
  stripped.properties._source = source;
  return stripped;
}

// Kootenai: county Ownership_Display layer first, then the statewide layer, then IDWR. Each
// source that errors or misses hands on to the next; an ambiguous county match is final.
// If the county layer itself failed in a way a browser might get past and no fallback found the
// parcel, the error carries a browser fallback hint (src/shared/fallback.js; src/index.js copies
// it into the 502 answer). A county-layer miss gets no hint: the browser would miss too.
async function findKootenaiParcel(raw, county) {
  const errors = [];
  let browserFallback = null;
  try {
    const parcel = await findKootenaiCountyParcel(raw);
    if (parcel) return parcel;
  } catch (error) {
    if (error.ambiguous) throw error;
    if (isFallbackEligible(error)) browserFallback = fallbackHint(FALLBACK_KINDS.kootenaiParcel, { parcelId: raw });
    errors.push(error); console.warn(`Kootenai county parcel layer failed (${error.message}); trying the statewide Idaho layer.`);
  }
  const fallbacks = [
    { find: () => findStatewide(raw, 'Kootenai', { ownerFree: true }), source: { name: 'Idaho statewide parcels (Public_Idaho_Parcels_)', url: IDAHO_PARCELS } },
    { find: () => findKootenaiIdwr(raw), source: { name: 'IDWR statewide parcel compilation', url: IDWR_PARCELS } }
  ];
  for (const { find, source } of fallbacks) {
    let features = [];
    try { features = await find(); } catch (error) { errors.push(error); continue; }
    if (features.length) return withoutOwnerFields(pickOne(features, raw, county), source);
  }
  if (errors.length) {
    const error = new Error(`Idaho parcel sources failed for Kootenai: ${errors.map(e => e.message).join('; ')}`);
    if (browserFallback) error.fallback = browserFallback;
    throw error;
  }
  throw new Error(NOT_FOUND);
}

export async function findIdahoParcel(parcelInput, county = '') {
  const raw = String(parcelInput || '').trim(); const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');
  const countyName = String(county || '').replace(/\s+County$/i, '').trim();
  if (/^kootenai$/i.test(countyName)) return findKootenaiParcel(raw, county);
  const features = await findStatewide(raw, countyName);
  if (!features.length) throw new Error(NOT_FOUND);
  return pickOne(features, raw, county);
}
