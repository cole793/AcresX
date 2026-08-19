import { fetchWithTimeout, json } from '../shared/http.js';

const SPOKANE = 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query';
const YELLOWSTONE = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1/query';
const MT_CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0/query';
const ID_PARCELS = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7/query';

async function arcgis(url, params) {
  const q = new URL(url);
  for (const [key, value] of Object.entries(params)) q.searchParams.set(key, value);
  q.searchParams.set('f', 'json'); q.searchParams.set('returnGeometry', 'false');
  const response = await fetchWithTimeout(q, { cf: { cacheTtl: 300, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  const data = await response.json(); if (data.error) throw new Error(data.error.message || 'ArcGIS query failed');
  return data.features || [];
}
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function safe(value) { return String(value || '').replace(/'/g, "''"); }
function compact(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

async function findMontanaStateRecord(parcelId) {
  const compactId = digits(parcelId);
  const formatted = compactId.length === 17 ? `${compactId.slice(0,2)}-${compactId.slice(2,6)}-${compactId.slice(6,8)}-${compactId.slice(8,9)}-${compactId.slice(9,11)}-${compactId.slice(11,13)}-${compactId.slice(13)}` : parcelId;
  const candidates = [...new Set([parcelId, compactId, formatted].filter(Boolean))];
  for (const candidate of candidates) {
    for (const field of ['ParcelID','Geocode','AssessmentCode']) {
      try {
        const records = await arcgis(MT_CADASTRAL, { where: `${field}='${safe(candidate)}'`, outFields: '*' });
        if (records.length) return { records, formatted };
      } catch (_) {}
    }
  }
  return { records: [], formatted };
}

export async function handlePropertyTaxTest(request) {
  const body = await request.json();
  const state = String(body.state || '').toUpperCase().trim();
  const county = String(body.county || '').replace(/\s+County$/i, '').trim();
  const parcelId = String(body.parcelId || '').trim();
  if (!parcelId) return json({ error: 'parcelId is required' }, 400, 'no-store');

  if (state === 'WA' && /^spokane$/i.test(county)) {
    const features = await arcgis(SPOKANE, { where: `PID_NUM='${safe(parcelId)}'`, outFields: 'PID_NUM,tax_year,asmt_year,land_value,exmp_amt,asmt_year_exmp_amt,acreage,site_address,prop_use_desc' });
    return json({ available: Boolean(features.length), state, county: 'Spokane', parcelId, source: 'Spokane County Assessor SCOUTSimple', records: features.map(f => f.attributes || {}) }, 200, 'no-store');
  }

  if (state === 'MT') {
    const statewide = await findMontanaStateRecord(parcelId);
    let countyRecords = [];
    if (/^yellowstone$/i.test(county)) {
      const compactId = digits(parcelId);
      const candidates = [...new Set([parcelId, compactId, statewide.formatted].filter(Boolean))];
      for (const candidate of candidates) {
        countyRecords = await arcgis(YELLOWSTONE, { where: `GEOCODE='${safe(candidate)}' OR GEO_CODE='${safe(candidate)}'`, outFields: 'GEOCODE,GEO_CODE,TAX_ID,TAXID,PROP_ID,FULLADD,SHORTLEGAL' });
        if (countyRecords.length) break;
      }
    }
    return json({
      available: Boolean(countyRecords.length || statewide.records.length), state, county, parcelId,
      formattedGeocode: statewide.formatted,
      ...(countyRecords.length ? { countySource: 'Yellowstone County TaxparcelOrion', countyRecords: countyRecords.map(f => f.attributes || {}) } : {}),
      statewideSource: 'Montana Cadastral / ORION integration', statewideRecords: statewide.records.map(f => f.attributes || {})
    }, 200, 'no-store');
  }

  if (state === 'ID') {
    const countySafe = safe(county.toUpperCase());
    const rawSafe = safe(parcelId.toUpperCase());
    const compactId = compact(parcelId);
    let features = await arcgis(ID_PARCELS, {
      where: `UPPER(County)='${countySafe}' AND (UPPER(PARCEL_ID)='${rawSafe}' OR UPPER(FP_ID)='${rawSafe}')`,
      outFields: 'PARCEL_ID,FP_ID,County,UPDATED,ASR_ACRES,ASR_CATS,VAL_LAND,VAL_IMPVTS,VAL_TOTAL,HOME_EXMPT,WEBSITE,SITE_ADD,SITE_CITY,SITE_ZIP'
    });
    if (!features.length && compactId !== parcelId.toUpperCase()) {
      features = await arcgis(ID_PARCELS, {
        where: `UPPER(County)='${countySafe}' AND (UPPER(PARCEL_ID)='${safe(compactId)}' OR UPPER(FP_ID)='${safe(compactId)}')`,
        outFields: 'PARCEL_ID,FP_ID,County,UPDATED,ASR_ACRES,ASR_CATS,VAL_LAND,VAL_IMPVTS,VAL_TOTAL,HOME_EXMPT,WEBSITE,SITE_ADD,SITE_CITY,SITE_ZIP'
      });
    }
    return json({ available: Boolean(features.length), state, county, parcelId, statewideSource: 'Idaho Statewide Standardized Parcel Layer', statewideRecords: features.map(f => f.attributes || {}) }, 200, 'no-store');
  }

  return json({ error: 'Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.' }, 400, 'no-store');
}
