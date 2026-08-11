import { fetchWithTimeout, json } from '../shared/http.js';

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

  const url = new URL(`${HIFLD_RETAIL}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '20');

  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'AcresX/0.9 Multi-State Beta' },
    cf: { cacheTtl: 86400, cacheEverything: true }
  }, 20000);
  if (!response.ok) return json({ available: false, error: `Utility territory service returned ${response.status}` }, 200, 'public, max-age=3600');
  const data = await response.json();
  if (data.error) return json({ available: false, error: data.error.message || 'Utility territory lookup failed' }, 200, 'public, max-age=3600');

  const matches = (data.features || []).map(feature => {
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
