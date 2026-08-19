import { fetchWithTimeout } from '../../shared/http.js';

const IDAHO_PARCELS = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7';
const IDWR_PARCELS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

async function queryService(service, where, count = 20) {
  const url = new URL(`${service}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Idaho parcel service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Idaho parcel search failed');
  return data.features || [];
}
async function query(where, count = 20) { return queryService(IDAHO_PARCELS, where, count); }

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

export async function findIdahoParcel(parcelInput, county = '') {
  const raw = String(parcelInput || '').trim(); const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');
  const countyName = String(county || '').replace(/\s+County$/i, '').trim();
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
  // IDWR's statewide parcel compilation includes Kootenai County and exposes the county assessor PIN directly.
  if (!features.length && /^kootenai$/i.test(countyName)) features = await findKootenaiIdwr(raw);
  if (!features.length) throw new Error('Parcel not found in available Idaho parcel sources. Confirm the county and assessor parcel number.');
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
