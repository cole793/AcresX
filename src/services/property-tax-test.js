import { fetchWithTimeout, json } from '../shared/http.js';

const SPOKANE = 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/SCOUTSimple/MapServer/0/query';
const YELLOWSTONE = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1/query';
const MT_CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0/query';

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

async function findMontanaStateRecord(parcelId) {
  const compact = digits(parcelId);
  const formatted = compact.length === 17 ? `${compact.slice(0,2)}-${compact.slice(2,6)}-${compact.slice(6,8)}-${compact.slice(8,9)}-${compact.slice(9,11)}-${compact.slice(11,13)}-${compact.slice(13)}` : parcelId;
  const candidates = [...new Set([parcelId, compact, formatted].filter(Boolean))];
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
      const compact = digits(parcelId);
      const candidates = [...new Set([parcelId, compact, statewide.formatted].filter(Boolean))];
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

  return json({ error: 'Property assessment endpoint currently supports Spokane County WA and Montana.' }, 400, 'no-store');
}
