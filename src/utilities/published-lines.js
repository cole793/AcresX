// Distribution lines a utility publishes itself, as public ArcGIS layers. Used for the distance to
// the nearest mapped power line (services/power-intelligence.js) when the parcel's primary
// provider is that utility. Avista has its own module (avista-distribution.js), which also ranks
// providers; this registry is for utilities whose map only gives a distance.
//
// Flathead Electric Cooperative (Kalispell, MT). ArcGIS Online item e75c65f850d04ae38db3b324c0b4e60a,
// "Public_Basic_FEC_System", access public, in Flathead Electric's own ArcGIS organization
// (B3FuYHZpRXI3e6dB; its other items include "FEC Service Area" and staff accounts @flathead.coop).
// Item summary: "Publicly available electrical grid information provided by Flathead Electric
// Cooperative in Kalispell Montana." Description: "a trimmed down version of the FEC_System layer
// in order to make basic FEC grid data available to the public. NO Consumer data is included".
// Layers 14 "Overhead" (wmBaseKv, wmPhasing, wmOHConductor) and 15 "Underground" (wmPhasing,
// wmUGConductor), polylines. Checked 2026-11-15: 20 overhead and 3 underground sections within
// 1,320 ft of Flathead parcel 07396611101010000.
//
// Other utilities checked 2026-11-15 and not found as public line layers on ArcGIS Online: Inland
// Power & Light, Kootenai Electric Cooperative, Yellowstone Valley Electric, NorthWestern Energy.
// (Spokane County's ThirdPartySDE/PowerAndGas MapServer could not be reached from the build
// session and is not used.)

import { arcgisQuery } from '../shared/upstream.js';
import { distanceToParcelFt } from '../shared/line-distance.js';

const FEC = 'https://services2.arcgis.com/B3FuYHZpRXI3e6dB/arcgis/rest/services/Public_Basic_FEC_System/FeatureServer';

export const PUBLISHED_LINE_SOURCES = Object.freeze([
  Object.freeze({
    id: 'flathead-electric',
    utility: 'Flathead Electric Cooperative',
    match: /\bflathead electric\b/i,
    source: 'Flathead Electric Cooperative public grid map (Public_Basic_FEC_System)',
    sourceLabel: 'Flathead Electric map',
    sourceUrl: FEC,
    layers: Object.freeze([
      Object.freeze({ url: `${FEC}/14`, infrastructure: 'overhead_distribution' }),
      Object.freeze({ url: `${FEC}/15`, infrastructure: 'underground_distribution' })
    ])
  })
]);

// Search rings, nearest first; the first ring with any line gives the distance (small rings keep
// town answers small and under the record limit).
export const PUBLISHED_SEARCH_RINGS_FT = [1320, 5280];
const RECORD_LIMIT = 1000;
const MAX_BYTES = 3_000_000;

export function publishedLineSource(provider = '') {
  return PUBLISHED_LINE_SOURCES.find(s => s.match.test(String(provider))) || null;
}

// Returns { available: true, distanceFt (null when none within searchedFt), searchedFt,
// infrastructure, source, sourceUrl, utility } or { available: false, status, error }. Never throws.
export async function nearestPublishedLine(src, { lat, lon, geometry = null, timeoutMs = 4000, signal } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!src) return { available: false, status: 'no_published_map' };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'invalid_location' };
  const base = { source: src.source, sourceLabel: src.sourceLabel, sourceUrl: src.sourceUrl, utility: src.utility };
  try {
    for (const ringFt of PUBLISHED_SEARCH_RINGS_FT) {
      const answers = await Promise.all(src.layers.map(layer => arcgisQuery(layer.url, {
        where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', distance: String(ringFt), units: 'esriSRUnit_Foot',
        outFields: 'OBJECTID', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
        resultRecordCount: String(RECORD_LIMIT)
      }, { timeoutMs, retries: 0, signal, maxBytes: MAX_BYTES, label: `published-lines-${src.id}`, agency: src.utility })
        .then(features => ({ layer, features }))));
      let best = null;
      for (const { layer, features } of answers) {
        for (const f of features) {
          const ft = distanceToParcelFt(f?.geometry?.paths || [], { lat, lon, geometry });
          if (Number.isFinite(ft) && (!best || ft < best.ft)) best = { ft, infrastructure: layer.infrastructure };
        }
      }
      if (best) return { available: true, distanceFt: Math.round(best.ft), searchedFt: ringFt, infrastructure: best.infrastructure, ...base };
    }
    return { available: true, distanceFt: null, searchedFt: PUBLISHED_SEARCH_RINGS_FT.at(-1), infrastructure: 'unknown', ...base };
  } catch (error) {
    return { available: false, status: error?.kind === 'timeout' ? 'timed_out' : 'source_unavailable', error: error?.message || `${src.utility} map unavailable`, ...base };
  }
}
