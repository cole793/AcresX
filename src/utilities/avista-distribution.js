// Avista's own published distribution line sections, used as evidence of where Avista has
// facilities (provider ranking in services/provider-ranking.js, distance in power-intelligence).
//
// Source: Avista Corporation, "DER Hosting Capacity PRD" hosted feature service, layer 0
// "DER Hosting Capacity" (polyline), published by Avista's own ArcGIS organization (the one that
// also publishes "Avista Geospatial Maps", item 955db80ba1124479a906c0a6edefe1cc, and the
// "WA Electric Service Reliability" layers):
//   https://services3.arcgis.com/WlYQgAChrqj0tuQi/arcgis/rest/services/DER_Hosting_Capacity_PRD/FeatureServer/0
//   ArcGIS Online item 4516668ae8fd49ec81ade98ca5caaea8, access "public".
//   Fields: SECTIONID, GEN_MAX_KW ("Gen Max kW"), FROMNODEID, TONODEID. Service description:
//   "published using ArcGIS Pro project $/GIS/DERCapacityMap_Public/ArcGISPro/DERCapacityMap_Public.aprx
//   2022.DERCapacityMap.R1". 511,505 sections (checked 2026-11-10).
// Each feature is a section of an Avista distribution circuit (hosting capacity is computed per
// circuit section), so a section near the parcel means Avista has a line there. The layer only
// covers Avista: it says nothing about where a co-op or PUD has lines.
//
// Layer extent (Web Mercator, from the layer metadata): x -13288619.30..-12839945.95,
// y 5702455.12..6274900.59, i.e. lon -119.38..-115.34, lat 45.55..48.98. Points outside it are
// not queried.

import { arcgisQuery } from '../shared/upstream.js';

export const AVISTA_DISTRIBUTION_LAYER = 'https://services3.arcgis.com/WlYQgAChrqj0tuQi/arcgis/rest/services/DER_Hosting_Capacity_PRD/FeatureServer/0';
export const AVISTA_DISTRIBUTION_SOURCE = 'Avista DER Hosting Capacity map (Avista-published distribution line sections)';
const EXTENT = { west: -119.38, east: -115.34, south: 45.55, north: 48.98 };
// Search rings, nearest first; the first ring with any section gives the nearest distance. Small
// rings first keep answers small in towns (there are ~270 sections within 1,320 ft of downtown
// Coeur d'Alene) and stay under the record limit, so the nearest section is always returned.
export const AVISTA_SEARCH_RINGS_FT = [330, 1320, 5280];
const RECORD_LIMIT = 1000;

export function inAvistaLayerExtent(lat, lon) {
  return lat >= EXTENT.south && lat <= EXTENT.north && lon >= EXTENT.west && lon <= EXTENT.east;
}

const FT_PER_DEG_LAT = 364000;

// Local flat projection around the point (feet). Accurate to well under 1% over a mile.
function projector(lat0) {
  const kx = FT_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);
  return (lon, lat) => [lon * kx, lat * FT_PER_DEG_LAT];
}

function pointSegmentFt(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Points the distance is measured from: the parcel point, plus the parcel outline's vertices
// when an outline is given (power-intelligence measures to the parcel edge, like OSM proximity).
function originPoints(lat, lon, geometry) {
  const points = [[lon, lat]];
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') { if (Number.isFinite(value[0]) && Number.isFinite(value[1])) points.push([value[0], value[1]]); return; }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points.slice(0, 2000);
}

export function nearestDistanceFt(features, { lat, lon, geometry } = {}) {
  const project = projector(lat);
  const origins = originPoints(lat, lon, geometry).map(([x, y]) => project(x, y));
  let best = Infinity;
  for (const feature of features || []) {
    for (const path of feature?.geometry?.paths || []) {
      const pts = path.filter(p => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).map(([x, y]) => project(x, y));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[i + 1] || pts[i];
        for (const o of origins) best = Math.min(best, pointSegmentFt(o, a, b));
      }
    }
  }
  return best;
}

// Nearest Avista-published distribution section to the point (or outline).
// Returns { available: true, nearestFt (null when none within the last ring), searchedFt, sections }
// or { available: false, status: 'outside_layer' | 'source_unavailable', error }.
// Never throws: a failure only means "no Avista evidence".
export async function nearestAvistaLine({ lat, lon, geometry = null, rings = AVISTA_SEARCH_RINGS_FT, timeoutMs = 4000, signal } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'invalid_location' };
  if (!inAvistaLayerExtent(lat, lon)) return { available: false, status: 'outside_layer' };
  try {
    for (const ringFt of rings) {
      const features = await arcgisQuery(AVISTA_DISTRIBUTION_LAYER, {
        where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', distance: String(ringFt), units: 'esriSRUnit_Foot',
        outFields: 'SECTIONID', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
        resultRecordCount: String(RECORD_LIMIT)
      }, { timeoutMs, retries: 0, signal, label: 'avista-distribution', agency: 'Avista distribution map' });
      if (features.length) {
        const nearestFt = nearestDistanceFt(features, { lat, lon, geometry });
        return { available: true, nearestFt: Number.isFinite(nearestFt) ? Math.round(nearestFt) : null, searchedFt: ringFt, sections: features.length, source: AVISTA_DISTRIBUTION_SOURCE, sourceUrl: AVISTA_DISTRIBUTION_LAYER };
      }
    }
    return { available: true, nearestFt: null, searchedFt: rings[rings.length - 1], sections: 0, source: AVISTA_DISTRIBUTION_SOURCE, sourceUrl: AVISTA_DISTRIBUTION_LAYER };
  } catch (error) {
    return { available: false, status: 'source_unavailable', error: error?.message || 'Avista distribution map unavailable' };
  }
}
