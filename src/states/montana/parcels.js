import { fetchWithTimeout } from '../../shared/http.js';

const YELLOWSTONE_OWNER_PARCEL = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/YCO_DATA_OwnerParcel/MapServer/0';

function normalize(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sql(value) {
  return String(value || '').replaceAll("'", "''");
}

function findField(fields, candidates) {
  const list = Array.isArray(fields) ? fields : [];
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const match = list.find(field => normalize(field.name) === wanted || normalize(field.alias) === wanted);
    if (match) return match.name;
  }
  return null;
}

function valueFrom(attrs, candidates) {
  const keys = Object.keys(attrs || {});
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const key = keys.find(name => normalize(name) === wanted);
    if (key && attrs[key] != null && String(attrs[key]).trim()) return String(attrs[key]).trim();
  }
  return '';
}

async function metadata() {
  const response = await fetchWithTimeout(`${YELLOWSTONE_OWNER_PARCEL}?f=json`, {
    cf: { cacheTtl: 86400, cacheEverything: true }
  }, 15000);
  if (!response.ok) throw new Error(`Yellowstone parcel metadata returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Yellowstone parcel metadata unavailable');
  return data;
}

async function query(where) {
  const url = new URL(`${YELLOWSTONE_OWNER_PARCEL}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', '20');
  const response = await fetchWithTimeout(url, {
    cf: { cacheTtl: 3600, cacheEverything: true }
  }, 20000);
  if (!response.ok) throw new Error(`Yellowstone parcel service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Yellowstone parcel search failed');
  return data.features || [];
}

function normalizeFeature(feature, requestedId) {
  const attrs = feature.properties || {};
  const parcelId = valueFrom(attrs, [
    'GEOCODE','PARCELID','PARCEL_ID','PARCEL_ID_NR','PROPERTYID','PROPERTY_ID','TAXID','TAX_ID','PID','ACCOUNT','ACCOUNTNO','ACCOUNT_NO'
  ]) || requestedId;
  const street = valueFrom(attrs, ['SITUS_ADDRESS','SITUSADDR','SITEADDRESS','SITE_ADDRESS','ADDRESS','PROPADDR','PROPERTY_ADDRESS']);
  const city = valueFrom(attrs, ['SITUS_CITY','SITUSCITY','CITY','CITYNAME','CITY_NAME']);
  const zip = valueFrom(attrs, ['SITUS_ZIP','SITUSZIP','ZIP','ZIPCODE','ZIP_CODE']);

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...attrs,
      ORIG_PARCEL_ID: parcelId,
      PARCEL_ID_NR: parcelId,
      COUNTY_NM: 'Yellowstone',
      _countyDisplay: 'Yellowstone',
      _stateCode: 'MT',
      _stateDisplay: 'Montana',
      SITUS_ADDRESS: street,
      SITUS_CITY_NM: city,
      SITUS_ZIP_NR: zip,
      DATA_LINK: 'https://gis.yellowstonecountymt.gov/'
    }
  };
}

export async function findYellowstoneParcel(parcelInput) {
  const raw = String(parcelInput || '').trim();
  if (!raw) throw new Error('Parcel number is required.');

  const meta = await metadata();
  const fields = meta.fields || [];
  const idCandidates = [
    'GEOCODE','PARCELID','PARCEL_ID','PROPERTYID','PROPERTY_ID','TAXID','TAX_ID','PID','ACCOUNT','ACCOUNTNO','ACCOUNT_NO'
  ];
  const idFields = idCandidates.map(name => findField(fields, [name])).filter((value, index, arr) => value && arr.indexOf(value) === index);
  if (!idFields.length) throw new Error('Yellowstone parcel ID field could not be identified from the county GIS schema.');

  const escaped = sql(raw.toUpperCase());
  const compact = normalize(raw);
  const exact = idFields.map(field => `UPPER(${field})='${escaped}'`).join(' OR ');
  let features = await query(`(${exact})`);

  if (!features.length && compact) {
    const like = idFields.map(field => `UPPER(${field}) LIKE '%${sql(compact)}%'`).join(' OR ');
    const candidates = await query(`(${like})`);
    features = candidates.filter(feature => idFields.some(field => normalize(feature.properties?.[field]) === compact));
  }

  if (features.length !== 1) {
    throw new Error(features.length
      ? 'Multiple Yellowstone County parcel matches were found. Use the exact parcel/geocode format shown by the county.'
      : 'Parcel not found in Yellowstone County. Confirm the parcel/geocode number.');
  }

  return normalizeFeature(features[0], raw);
}
