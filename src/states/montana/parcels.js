import { cachedJson, upstreamJson } from '../../shared/upstream.js';
import { withoutPersonalFields } from '../../shared/personal-fields.js';

// No owner names or mailing addresses (owner decision, 2026-10-29). Each layer is asked for its
// non-personal fields by name (every field the layer had on 2026-10-29 except the owner and
// mailing ones, so the answer is what outFields '*' gave minus those), and every feature also
// goes through withoutPersonalFields() in case a layer adds one.
// Never add here: cadastral OwnerName, OwnerAddress1-3, OwnerCity, OwnerState, OwnerZipCode,
// CareOfTaxpayer; Yellowstone OWNER, OWNER_NAME, MAILADDRESS1-3, MAILCITY, MAILSTATE, MAILZIP.
export const MONTANA_CADASTRAL_FIELDS = 'RefreshDate,OBJECTID,PARCELID,COUNTYCD,GISAcres,TaxYear,PropertyID,AssessmentCode,Township,Range,Section,LegalDescriptionShort,Subdivision,CertificateOfSurvey,AddressLine1,AddressLine2,CityStateZip,PropAccess,LevyDistrict,PropType,ContinuousCropAcres,FallowAcres,FarmsiteAcres,ForestAcres,GrazingAcres,WildHayAcres,IrrigatedAcres,NonQualAcres,TotalAcres,TotalBuildingValue,TotalLandValue,TotalValue,Geocode,PropertyCardLink,Shape__Area,Shape__Length';
export const YELLOWSTONE_TAX_PARCEL_FIELDS = 'OBJECTID,GEOCODE,TAX_ID,PROP_ID,ADDR,GEO_CODE,TAXID,FULLADD,SHORTLEGAL,Shape.STArea(),Shape.STLength()';

// Layer answers (feature lists, owner-free) that found parcels are cached per query for 7 days
// (Cache API); errors and empty answers (a parcel may be added) are never cached. The parcel is
// rebuilt from the cached answer. v1 entries (outFields '*', with owner fields) may exist from PR
// previews, so the prefix is v2; bump it whenever the fields requested or stripped change.
export const MONTANA_PARCEL_CACHE_PREFIX = 'https://acresx.internal/cache/montana-parcels/v2/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const YELLOWSTONE_TAX_PARCEL = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1';
const MONTANA_CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
const YELLOWSTONE_PROPERTY_SEARCH = 'https://www.yellowstonecountymt.gov/Treasurer/PropertySearch/';
const MONTANA_CADASTRAL_APP = 'https://svc.mt.gov/msl/cadastral/';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

const LAYER_FIELDS = { [MONTANA_CADASTRAL]: MONTANA_CADASTRAL_FIELDS, [YELLOWSTONE_TAX_PARCEL]: YELLOWSTONE_TAX_PARCEL_FIELDS };

async function fetchLayer(layer, where, count, label) {
  const url = new URL(`${layer}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', LAYER_FIELDS[layer]);
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  // Was one 20 s attempt; now 12 s + one retry at 8 s (body included).
  const data = await upstreamJson(url, { timeoutMs: 12000, retryTimeoutMs: 8000, arcgis: true, label, agency: 'Montana parcel service', arcgisMessage: 'Montana parcel search failed' });
  return (data.features || []).map(feature => ({ ...feature, properties: withoutPersonalFields(feature?.properties || {}) }));
}

function queryLayer(layer, where, count = 20, label = 'montana-parcels') {
  return cachedJson(MONTANA_PARCEL_CACHE_PREFIX, { layer, where, count }, CACHE_TTL_SECONDS, () => fetchLayer(layer, where, count, label), { isValid: features => Array.isArray(features) && features.length > 0 });
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
  const features = await queryLayer(MONTANA_CADASTRAL, `(${candidates.join(' OR ')})`, 10, 'mt-cadastral-parcel');
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
  const features = await queryLayer(YELLOWSTONE_TAX_PARCEL, `(${candidates.join(' OR ')})`, 10, 'yellowstone-taxparcel');
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
