// Road access, the `roadAccess` part of POST /api/cost-context (src/services/cost-context.js):
// straight-line distance from the parcel's interior point to the nearest mapped road centerline
// (and to the nearest public one), for the driveway line of the development-cost estimate (public/local-cost-model.js).
// Counties with an official road layer are configured in src/counties/*-roads.js; any other
// county answers { available: false, status: 'not_configured' }.
//
// lookupRoadAccess({ state, county, lat, lon }) (lat/lon: the parcel's interior point, the same
// point the browser sends to /api/zoning-permits) answers:
//   { available: true, status: 'found', distanceFt, road: { name, kind, public },
//     nearestPublic: { distanceFt, road } | null (none within searchedFt), searchedFt, method, source }
//   { available: true, status: 'none_within', distanceFt: null, nearestPublic: null, searchedFt, method, source }
//   { available: false, status: 'not_configured' | 'source_unavailable' | 'invalid_location', error? }
// distanceFt is to the nearest road of any kind (public or private), which is what a driveway
// most likely connects to.
// A failed layer makes the whole answer unavailable (a partial answer could name a farther road),
// and the cost estimate then shows its labeled length range. Read-only queries; never throws.

import { arcgisQuery } from '../shared/upstream.js';
import { nearestDistanceFt } from '../utilities/avista-distribution.js';
import { SPOKANE_ROADS } from '../counties/spokane-roads.js';
import { KOOTENAI_ROADS } from '../counties/kootenai-roads.js';

// Search rings, nearest first. The first ring with any road gives the nearest road of any kind;
// the search goes on until a public road is found or the rings run out.
export const ROAD_SEARCH_RINGS_FT = [330, 1320, 2640];
const RECORD_LIMIT = 1000;
export const ROAD_METHOD = 'Straight line from the parcel interior point (assumed homesite) to the nearest mapped road centerline (public or private). Not a surveyed driveway route.';

const CONFIGS = [SPOKANE_ROADS, KOOTENAI_ROADS];
export function roadConfig(state, county) {
  const s = String(state || '').toUpperCase().trim();
  const c = String(county || '').replace(/\s+County$/i, '').trim().toLowerCase();
  return CONFIGS.find(cfg => cfg.state === s && cfg.county.toLowerCase() === c) || null;
}

export async function lookupRoadAccess({ state, county, lat, lon } = {}, { rings = ROAD_SEARCH_RINGS_FT, timeoutMs = 6000 } = {}) {
  const cfg = roadConfig(state, county);
  if (!cfg) return { available: false, status: 'not_configured', note: 'No official road centerline layer is configured for this county.' };
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'invalid_location' };
  const base = { method: ROAD_METHOD, source: cfg.source, county: cfg.county, state: cfg.state };
  try {
    let any = null, pub = null, searchedFt = 0;
    for (const ringFt of rings) {
      searchedFt = ringFt;
      const answers = await Promise.all(cfg.layers.map(layer => arcgisQuery(layer.url, {
        where: layer.where, geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', distance: String(ringFt), units: 'esriSRUnit_Foot',
        outFields: layer.outFields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
        resultRecordCount: String(RECORD_LIMIT)
      }, { timeoutMs, retries: 0, label: layer.id, agency: `${cfg.county} County GIS` }).then(features => ({ layer, features }))));
      for (const { layer, features } of answers) {
        for (const feature of features) {
          const ft = nearestDistanceFt([feature], { lat, lon });
          if (!Number.isFinite(ft)) continue;
          const road = layer.describe(feature.attributes || {});
          if (!any || ft < any.ft) any = { ft, road };
          if (road.public && (!pub || ft < pub.ft)) pub = { ft, road };
        }
      }
      if (pub) break;
    }
    const nearestPublic = pub ? { distanceFt: Math.round(pub.ft), road: pub.road } : null;
    if (any) return { available: true, status: 'found', distanceFt: Math.round(any.ft), road: any.road, nearestPublic, searchedFt, ...base };
    return { available: true, status: 'none_within', distanceFt: null, nearestPublic: null, searchedFt, ...base };
  } catch (error) {
    return { available: false, status: 'source_unavailable', error: error?.message || 'Road centerline layer unavailable', source: cfg.source };
  }
}
