import { json } from '../shared/http.js';
import { arcgisQuery } from '../shared/upstream.js';

const HIFLD_RETAIL = 'https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0';

function normalizeName(attrs) {
  const candidates = ['NAME','UTILITY','UTIL_NAME','UTILITY_NAME','COMPANY','COMPANY_NAME','ENTITY','OWNER'];
  for (const key of candidates) {
    if (attrs?.[key] != null && String(attrs[key]).trim()) return String(attrs[key]).trim();
  }
  const dynamic = Object.entries(attrs || {}).find(([key, value]) => /name|utility|company|owner/i.test(key) && value != null && String(value).trim());
  return dynamic ? String(dynamic[1]).trim() : '';
}

export async function handleUtilityTerritory(request) {
  const body = await request.json();
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'lat and lon are required.' }, 400, 'no-store');

  // Was one 20 s attempt; now 12 s + one retry at 8 s (body included).
  let features;
  try {
    features = await arcgisQuery(HIFLD_RETAIL, {
      where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', resultRecordCount: '20'
    }, {
      headers: { 'User-Agent': 'AcresX/0.9 Multi-State Beta' }, timeoutMs: 12000, retryTimeoutMs: 8000,
      label: 'hifld-retail-territory', agency: 'Utility territory service', arcgisMessage: 'Utility territory lookup failed'
    });
  } catch (error) {
    if (error.kind === 'http' || error.kind === 'arcgis') return json({ available: false, error: error.message }, 200, 'public, max-age=3600');
    throw error;
  }

  const matches = features.map(feature => {
    const attrs = feature.attributes || {};
    return {
      name: normalizeName(attrs),
      type: attrs.TYPE || attrs.UTIL_TYPE || attrs.OWNERSHIP || '',
      state: attrs.STATE || '',
      year: attrs.YEAR || '',
      attributes: attrs
    };
  }).filter(item => item.name);

  const names = [...new Set(matches.map(item => item.name))];
  return json({
    available: true,
    source: 'DOE / ORNL HIFLD Electric Retail Service Territories',
    sourceDate: '2025-08-21',
    providers: names,
    matches,
    confidence: names.length === 1 ? 'moderate' : names.length > 1 ? 'low' : 'low',
    note: names.length ? 'Retail electric service territory intersected the parcel center. Confirm new-service availability directly with the utility.' : 'No mapped retail electric service territory intersected the parcel center.'
  }, 200, 'public, max-age=3600, s-maxage=86400');
}
