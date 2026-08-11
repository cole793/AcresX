import { fetchWithTimeout } from '../../shared/http.js';

// Yellowstone County's tax parcel layer exposes the identifiers buyers/realtors actually use:
// GEOCODE (17 chars), TAX_ID/TAXID, PROP_ID and FULLADD.
const YELLOWSTONE_TAX_PARCEL = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1';

function normalize(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sql(value) {
  return String(value ?? '').replaceAll("'", "''");
}

async function query(where, count = 20) {
  const url = new URL(`${YELLOWSTONE_TAX_PARCEL}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(count));
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
  if (!response.ok) throw new Error(`Yellowstone parcel service returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Yellowstone parcel search failed');
  return data.features || [];
}

function normalizeFeature(feature, requestedId) {
  const attrs = feature.properties || {};
  const parcelId = String(attrs.GEOCODE || attrs.GEO_CODE || attrs.TAX_ID || attrs.TAXID || requestedId || '').trim();
  const street = String(attrs.FULLADD || attrs.ADDR || '').trim();

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
      SITUS_CITY_NM: '',
      SITUS_ZIP_NR: '',
      DATA_LINK: 'https://gis.yellowstonecountymt.gov/'
    }
  };
}

export async function findYellowstoneParcel(parcelInput) {
  const raw = String(parcelInput || '').trim();
  const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');

  // Exact matching only. The prior broad LIKE fallback could return several ownership
  // polygons and incorrectly report "multiple matches" for a valid 17-digit geocode.
  // GEOCODE is the primary Montana cadastral identifier shown in Yellowstone's tax layer.
  const candidates = [
    `UPPER(GEOCODE)='${sql(compact)}'`,
    `UPPER(GEO_CODE)='${sql(compact)}'`,
    `UPPER(TAX_ID)='${sql(compact)}'`,
    `UPPER(TAXID)='${sql(compact)}'`
  ];
  if (/^\d+$/.test(compact)) candidates.push(`PROP_ID=${Number(compact)}`);

  const features = await query(`(${candidates.join(' OR ')})`, 10);
  if (!features.length) {
    throw new Error('Parcel not found in Yellowstone County. Enter the county GEOCODE or tax ID shown on the property record.');
  }

  // Some county records can duplicate the same tax parcel. Collapse identical geocodes
  // before deciding that the user's identifier is ambiguous.
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

  if (unique.size > 1) {
    throw new Error('Multiple Yellowstone County tax parcels use that identifier. Try the full 17-digit GEOCODE shown by the county.');
  }

  return normalizeFeature([...unique.values()][0], raw);
}
