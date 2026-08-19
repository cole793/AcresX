import { fetchWithTimeout } from '../../shared/http.js';

const IDAHO_PARCELS = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7';

function normalize(value) { return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function sql(value) { return String(value ?? '').replaceAll("'", "''"); }

async function query(where, count = 20) {
  const url = new URL(`${IDAHO_PARCELS}/query`);
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

function normalizeFeature(feature, requestedId, county = '') {
  const attrs = feature.properties || {};
  const parcelId = String(attrs.PARCEL_ID || attrs.FP_ID || requestedId || '').trim();
  const countyDisplay = String(county || attrs.County || '').replace(/\s+County$/i, '').trim();
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...attrs,
      ORIG_PARCEL_ID: parcelId,
      PARCEL_ID_NR: parcelId,
      COUNTY_NM: countyDisplay,
      _countyDisplay: countyDisplay,
      _stateCode: 'ID',
      _stateDisplay: 'Idaho',
      SITUS_ADDRESS: String(attrs.SITE_ADD || '').trim(),
      SITUS_CITY_NM: String(attrs.SITE_CITY || '').trim(),
      SITUS_ZIP_NR: String(attrs.SITE_ZIP || '').trim(),
      DATA_LINK: String(attrs.WEBSITE || '').trim(),
      ACRES: attrs.ASR_ACRES,
      _assessment: {
        landValue: attrs.VAL_LAND,
        improvementValue: attrs.VAL_IMPVTS,
        totalValue: attrs.VAL_TOTAL,
        categories: attrs.ASR_CATS || ''
      }
    }
  };
}

export async function findIdahoParcel(parcelInput, county = '') {
  const raw = String(parcelInput || '').trim();
  const compact = normalize(raw);
  if (!compact) throw new Error('Parcel number is required.');
  const countySafe = sql(String(county || '').replace(/\s+County$/i, '').trim());
  const countyWhere = countySafe ? `UPPER(County)='${countySafe.toUpperCase()}' AND ` : '';
  const candidates = [
    `UPPER(PARCEL_ID)='${sql(raw.toUpperCase())}'`,
    `UPPER(FP_ID)='${sql(raw.toUpperCase())}'`
  ];
  let features = await query(`${countyWhere}(${candidates.join(' OR ')})`, 20);
  if (!features.length && compact !== raw.toUpperCase()) {
    features = await query(`${countyWhere}(UPPER(PARCEL_ID)='${sql(compact)}' OR UPPER(FP_ID)='${sql(compact)}')`, 20);
  }
  if (!features.length) throw new Error('Parcel not found in the Idaho statewide parcel layer. Confirm the county and assessor parcel number.');

  const exact = features.filter(feature => {
    const p = feature.properties || {};
    return [p.PARCEL_ID, p.FP_ID].some(value => normalize(value) === compact);
  });
  const pool = exact.length ? exact : features;
  const unique = new Map();
  for (const feature of pool) {
    const p = feature.properties || {};
    const key = `${normalize(p.County)}:${normalize(p.PARCEL_ID || p.FP_ID || JSON.stringify(feature.geometry))}`;
    if (!unique.has(key)) unique.set(key, feature);
  }
  if (unique.size > 1) throw new Error('Multiple Idaho parcels match that identifier. Confirm the exact county parcel number.');
  return normalizeFeature([...unique.values()][0], raw, county);
}
