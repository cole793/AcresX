import { fetchWithTimeout } from '../../shared/http.js';
import { findKootenaiCountyParcel } from '../../counties/kootenai-parcels.js';

const IDAHO_PARCELS = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7';
const IDWR_PARCELS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

// ArcGIS Online answers a rate limit either as HTTP 429 or as HTTP 200 with
// {error:{code:429, message:'Unable to perform query. Too many requests.'}}.
function isRateLimit(status, error) { return status === 429 || Number(error?.code) === 429 || /too many requests/i.test(String(error?.message || '')); }
export const RATE_LIMIT_RETRY_MS = { value: 600 };

async function queryService(service, where, count = 20, { retryRateLimit = false } = {}) {
  const url = new URL(`${service}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  for (let attempt = 0; ; attempt++) {
    const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
    const data = response.ok ? await response.json() : null;
    if (retryRateLimit && attempt === 0 && isRateLimit(response.status, data?.error)) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_MS.value));
      continue;
    }
    if (!response.ok) throw new Error(`Idaho parcel service returned ${response.status}`);
    if (data.error) throw new Error(data.error.message || 'Idaho parcel search failed');
    return data.features || [];
  }
}
async function query(where, count = 20) { return queryService(IDAHO_PARCELS, where, count, { retryRateLimit: true }); }

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
    const features = await queryService(IDWR_PARCELS, `UPPER(PIN)='${sql(candidate)}' AND UPPER(COUNTY)='KOOTENAI'`, 20);
    const exact = features.filter(f => normalize(f.properties?.PIN) === compact);
    if (exact.length) return exact;
  }
  // County assessor PINs are canonical without dashes; normalize punctuation if IDWR retained it.
  const prefix = compact.slice(0, Math.min(8, compact.length));
  const broad = await queryService(IDWR_PARCELS, `UPPER(COUNTY)='KOOTENAI' AND UPPER(PIN) LIKE '${sql(prefix)}%'`, 200);
  return broad.filter(f => normalize(f.properties?.PIN) === compact);
}

// Statewide layer 7 lookup by PARCEL_ID / FP_ID (Kootenai also tries the dashed PIN and a prefix match).
async function findStatewide(raw, countyName) {
  const compact = normalize(raw);
  const countySafe = sql(countyName); const countyWhere = countySafe ? `UPPER(County)='${countySafe.toUpperCase()}' AND ` : '';
  const variants = /^kootenai$/i.test(countyName) ? kootenaiVariants(raw) : [...new Set([raw.toUpperCase(), compact])];
  let features = [];
  for (const candidate of variants) {
    features = await query(`${countyWhere}(UPPER(PARCEL_ID)='${sql(candidate)}' OR UPPER(FP_ID)='${sql(candidate)}')`, 20);
    if (features.length) break;
  }
  if (!features.length && /^kootenai$/i.test(countyName)) {
    const prefix = compact.slice(0, Math.min(8, compact.length));
    const broad = await query(`${countyWhere}(UPPER(PARCEL_ID) LIKE '${sql(prefix)}%' OR UPPER(FP_ID) LIKE '${sql(prefix)}%')`, 200);
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
function withoutOwnerFields(feature, source) {
  const properties = {};
  for (const [k, v] of Object.entries(feature.properties || {})) if (!OWNER_FIELD.test(k)) properties[k] = v;
  properties._source = source;
  return { ...feature, properties };
}

// Kootenai: county Ownership_Display layer first, then the statewide layer, then IDWR. Each
// source that errors or misses hands on to the next; an ambiguous county match is final.
async function findKootenaiParcel(raw, county) {
  const errors = [];
  try {
    const parcel = await findKootenaiCountyParcel(raw);
    if (parcel) return parcel;
  } catch (error) {
    if (error.ambiguous) throw error;
    errors.push(error); console.warn(`Kootenai county parcel layer failed (${error.message}); trying the statewide Idaho layer.`);
  }
  const fallbacks = [
    { find: () => findStatewide(raw, 'Kootenai'), source: { name: 'Idaho statewide parcels (Public_Idaho_Parcels_)', url: IDAHO_PARCELS } },
    { find: () => findKootenaiIdwr(raw), source: { name: 'IDWR statewide parcel compilation', url: IDWR_PARCELS } }
  ];
  for (const { find, source } of fallbacks) {
    let features = [];
    try { features = await find(); } catch (error) { errors.push(error); continue; }
    if (features.length) return withoutOwnerFields(pickOne(features, raw, county), source);
  }
  if (errors.length) throw new Error(`Idaho parcel sources failed for Kootenai: ${errors.map(e => e.message).join('; ')}`);
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
