import { json } from '../shared/http.js';
import { arcgisQuery } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { nearestAvistaLine, inAvistaLayerExtent } from '../utilities/avista-distribution.js';
import { rankProviders } from './provider-ranking.js';

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

  const state = String(body.state || '').toUpperCase();
  // Avista's published distribution lines, for ranking (services/provider-ranking.js). Asked in
  // parallel with HIFLD, only in Washington and Idaho, within that layer's extent; a failure only
  // leaves the HIFLD order. Rings stop at 1,320 ft: ranking only needs "within 1,320 ft or not".
  const avistaLookup = (state === 'WA' || state === 'ID' || !state) && inAvistaLayerExtent(lat, lon)
    ? nearestAvistaLine({ lat, lon, rings: [330, 1320], timeoutMs: 4000 })
    : Promise.resolve(null);

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
      // The HIFLD layer has no owner or mailing fields today; strip in case one is added.
      attributes: withoutPersonalFields(attrs)
    };
  }).filter(item => item.name);

  const avista = await avistaLookup;
  const ranking = rankProviders(matches, { avista, state });
  // `providers` keeps every name (as before) but is now ordered: the primary first, then the
  // other retail utilities, then wholesale federal marketers. `primary`, `ranked`, `alsoListed`
  // and `wholesale` are additions.
  const names = ranking.providers;
  return json({
    available: true,
    source: 'DOE / ORNL HIFLD Electric Retail Service Territories',
    sourceDate: '2025-08-21',
    providers: names,
    primary: ranking.primary,
    ranked: ranking.ranked,
    alsoListed: ranking.alsoListed,
    wholesale: ranking.wholesale,
    matches,
    confidence: names.length === 1 ? 'moderate' : names.length > 1 ? 'low' : 'low',
    note: names.length ? 'Retail electric service territory intersected the parcel center. Confirm new-service availability directly with the utility.' : 'No mapped retail electric service territory intersected the parcel center.'
  }, 200, 'public, max-age=3600, s-maxage=86400');
}
