import { fetchWithTimeout } from '../../shared/http.js';

const YELLOWSTONE_TAX_PARCEL = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1';
const MONTANA_CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
const YELLOWSTONE_PROPERTY_SEARCH = 'https://www.yellowstonecountymt.gov/Treasurer/PropertySearch/';
const MONTANA_CADASTRAL_APP = 'https://svc.mt.gov/msl/cadastral/';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

async function queryLayer(layer, where, count = 20) {
  const url = new URL(`${layer}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Montana parcel service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Montana parcel search failed');
  return data.features || [];
}

function normalizeFeature(feature, requestedId, county = '') {
  const attrs = feature.properties || {};
  const parcelId = String(attrs.PARCELID || attrs.Geocode || attrs.GEOCODE || attrs.GEO_CODE || attrs.TAX_ID || attrs.TAXID || requestedId || '').trim();
  const street = String(attrs.AddressLine1 || attrs.FULLADD || attrs.ADDR || '').trim();
  const countyDisplay = String(county || attrs.COUNTY_NM || '').replace(/\s+County$/i, '').trim();
  return {
    type: 'Feature', geometry: feature.geometry,
    properties: {
      ...attrs,
      ORIG_PARCEL_ID: parcelId, PARCEL_ID_NR: parcelId,
      COUNTY_NM: countyDisplay, _countyDisplay: countyDisplay,
      _stateCode: 'MT', _stateDisplay: 'Montana',
      SITUS_ADDRESS: street,
      SITUS_CITY_NM: String(attrs.CityStateZip || '').trim(), SITUS_ZIP_NR: '',
      DATA_LINK: attrs.PropertyCardLink || MONTANA_CADASTRAL_APP
    }
  };
}

export async function findMontanaParcel(parcelInput, county = '') {
  const raw = String(parcelInput || '').trim();
  const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');
  const candidates = [`UPPER(PARCELID)='${sql(compact)}'`, `UPPER(Geocode)='${sql(compact)}'`, `UPPER(AssessmentCode)='${sql(compact)}'`];
  if (/^\d+$/.test(compact) && compact.length < 12) candidates.push(`PropertyID=${Number(compact)}`);
  const features = await queryLayer(MONTANA_CADASTRAL, `(${candidates.join(' OR ')})`, 10);
  if (!features.length) throw new Error('Parcel not found in the Montana statewide cadastral database. Try the 17-digit geocode shown on the Montana property record.');
  const unique = new Map();
  for (const feature of features) {
    const p = feature.properties || {};
    const key = normalize(p.PARCELID || p.Geocode || p.PropertyID || JSON.stringify(feature.geometry));
    if (!unique.has(key)) unique.set(key, feature);
  }
  if (unique.size > 1) throw new Error('Multiple Montana parcels use that identifier. Try the full 17-digit geocode.');
  return normalizeFeature([...unique.values()][0], raw, county);
}

export async function findYellowstoneParcel(parcelInput) {
  const raw = String(parcelInput || '').trim();
  const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');
  const candidates = [`UPPER(GEOCODE)='${sql(compact)}'`, `UPPER(GEO_CODE)='${sql(compact)}'`, `UPPER(TAX_ID)='${sql(compact)}'`, `UPPER(TAXID)='${sql(compact)}'`];
  if (/^\d+$/.test(compact)) candidates.push(`PROP_ID=${Number(compact)}`);
  const features = await queryLayer(YELLOWSTONE_TAX_PARCEL, `(${candidates.join(' OR ')})`, 10);
  if (!features.length) return findMontanaParcel(raw, 'Yellowstone');
  const exact = features.filter(feature => {
    const p = feature.properties || {};
    return [p.GEOCODE, p.GEO_CODE, p.TAX_ID, p.TAXID, p.PROP_ID].some(value => normalize(value) === compact);
  });
  const pool = exact.length ? exact : features;
  const unique = new Map();
  for (const feature of pool) {
    const p = feature.properties || {};
    const key = normalize(p.GEOCODE || p.GEO_CODE || p.TAX_ID || p.TAXID || p.PROP_ID || JSON.stringify(feature.geometry));
    if (!unique.has(key)) unique.set(key, feature);
  }
  if (unique.size > 1) throw new Error('Multiple Yellowstone County tax parcels use that identifier. Try the full 17-digit GEOCODE.');
  const result = normalizeFeature([...unique.values()][0], raw, 'Yellowstone');
  result.properties.DATA_LINK = YELLOWSTONE_PROPERTY_SEARCH;
  return result;
}
