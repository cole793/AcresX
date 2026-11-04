// Stevens County, WA flood zones from the county's copy of FEMA's paper flood maps (FIRM).
//
// Why: FEMA's digital map (NFHL) has no Stevens County panels. NFHL layer 3 (FIRM Panels) grouped
// by DFIRM_ID for ('53065C','53063C','53019C') answered on 2026-11-04 with only
//   {"DFIRM_ID":"53019C","n":94}, {"DFIRM_ID":"53063C","n":128}
// (Ferry and Spokane; no 53065C), and layer 28 returns no features in Stevens (Colville
// -117.905,48.546: "features":[]). So src/services/flood.js answers `not_mapped` there and asks
// this layer before saying so.
//
// Source, checked with read-only curl on 2026-11-04:
//   GET https://gis.stevenscountywa.gov/server/rest/services/Hydrology/MapServer/19?f=json
//   "name":"FEMAFloodData", "type":"Feature Layer", "geometryType":"esriGeometryPolygon",
//   "capabilities":"Map,Query,Data", "maxRecordCount":2000, currentVersion 11.3,
//   sourceSpatialReference {"wkid":2926} (NAD83(HARN) / Washington North, US feet).
//   Fields used: zone_ (String 5), sfha (String 3), floodway (String 5), firm_panel (String 11).
//   Other fields: objectid, fema_, fema_id, fips, community, quad, cobra, symbol, panel_typ,
//   st_fips, co_fips, state, pcomm, panel, lat, long_, quad_unit, creator, create_date,
//   last_editor, last_edit_date, globalid. No owner or personal fields.
//   Last edit: the layer has no editingInfo / editFieldsInfo, and max(last_edit_date),
//   min/max(create_date) over all 811 features are all null, so no edit date is published.
//   The layer metadata (MapServer/19/metadata) gives the date instead: origin "Federal Emergency
//   Management Agency", pubdate "1998", "Filename: Q3 ... Metadata_Filename: c53065m", and
//   "The Q3 Flood Data are derived from the Flood Insurance Rate Maps (FIRMS) published by the
//   Federal Emergency Management Agency (FEMA). ... consistent with those required for mapping at a
//   scale of 1:24000." and "Q3 Flood Data files are intended to convey certain key features from
//   the existing hard copy FIRM ... More detailed information may be obtained from the paper FIRM."
//   Extent (query returnExtentOnly, outSR 4326): xmin -118.41267, ymin 47.77613,
//   xmax -117.37325, ymax 49.02315. Every feature has fips 53065.
//   Zone values (outStatistics count grouped by zone_, sfha, floodway), all 811 features:
//     X    OUT      374      A    IN      295      AE   IN  FW   10
//     ANI  OUT       32      X500 OUT      58      AE   IN       42
//   (floodway is " " when not a floodway.) ANI = area not included on the FIRM.
//   CORS: the server answers Origin with access-control-allow-origin (the origin echoed), so
//   public/browser-fallback.js can ask it from the browser too.
//
// The rows are mapped to FEMA NFHL field names and values (FLD_ZONE, ZONE_SUBTY, SFHA_TF), so the
// shared flood categories and scores in src/services/flood.js and public/flood-status.js apply
// unchanged:
//   A, AE  -> A / AE, SFHA_TF T (AE floodway "FW" -> subtype FLOODWAY)   high      20
//   X500   -> X, 0.2 PCT ANNUAL CHANCE FLOOD HAZARD                        moderate  70
//   X      -> X, AREA OF MINIMAL FLOOD HAZARD                              minimal   96
//   ANI    -> AREA NOT INCLUDED                                            not_mapped (never high)
//   anything else keeps its code (undetermined, or high when sfha is IN): never safe.
import { arcgisQuery } from '../shared/upstream.js';

export const STEVENS_FLOOD_LAYER = 'https://gis.stevenscountywa.gov/server/rest/services/Hydrology/MapServer/19';
export const STEVENS_FLOOD_PROVIDER = 'Stevens County digitized FEMA FIRM';
export const STEVENS_FLOOD_LABEL = 'Stevens County digitized FEMA FIRM (paper map copy, not a FEMA digital map)';
export const STEVENS_FLOOD_NOTE = 'FEMA has no digital flood map (NFHL) for Stevens County. This is the county\'s copy of FEMA\'s 1998 Q3 flood data, digitized from the paper FIRM. Verify with Stevens County or FEMA.';
export const STEVENS_FLOOD_COVERAGE = 'paper-firm-copy';
export const STEVENS_FLOOD_OUT_FIELDS = 'zone_,sfha,floodway,firm_panel';
export const STEVENS_AGENCY = 'Stevens County GIS';

// The layer extent above, padded by about 0.02 degrees. It overlaps parts of Spokane, Ferry,
// Pend Oreille and Lincoln counties; that only costs a query that finds nothing (every feature
// is in Stevens), and flood.js only asks when FEMA has no mapped zone for the parcel.
export const STEVENS_FLOOD_BBOX = Object.freeze({ xmin: -118.43, ymin: 47.75, xmax: -117.35, ymax: 49.05 });

// Timeouts (body included, src/shared/upstream.js). After a FEMA answer: 6 s and one retry at 4 s.
// After FEMA and the Esri backup failed (up to 22.5 s spent): one 5 s attempt.
export const STEVENS_FLOOD_TIMEOUT_MS = 6000;
export const STEVENS_FLOOD_RETRY_TIMEOUT_MS = 4000;
export const STEVENS_FLOOD_LATE_TIMEOUT_MS = 5000;

function rings(geometry) {
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) return geometry.coordinates.flat();
  return [];
}

// True when the parcel's bounding box touches STEVENS_FLOOD_BBOX. A `county` given with the
// request decides instead ("Stevens", "Stevens County", "Stevens County, WA").
export function isStevensParcel(geometry, county) {
  const named = String(county ?? '').trim();
  if (named) return /^stevens(\s+county)?(\s*,?\s*(wa|washington))?$/i.test(named);
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const ring of rings(geometry)) {
    for (const point of Array.isArray(ring) ? ring : []) {
      const [x, y] = point || [];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y);
    }
  }
  if (!Number.isFinite(xmin)) return false;
  const b = STEVENS_FLOOD_BBOX;
  return xmax >= b.xmin && xmin <= b.xmax && ymax >= b.ymin && ymin <= b.ymax;
}

const text = value => String(value ?? '').trim();

// One county row -> an NFHL-shaped row (see the table above).
export function stevensFloodRow(attributes) {
  const a = attributes || {};
  const zone = text(a.zone_).toUpperCase();
  const sfha = text(a.sfha).toUpperCase();
  const floodway = text(a.floodway).toUpperCase() === 'FW';
  if (zone === 'A' || zone === 'AE') return { FLD_ZONE: zone, ZONE_SUBTY: floodway ? 'FLOODWAY' : null, SFHA_TF: 'T' };
  if (zone === 'X500') return { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' };
  if (zone === 'X') return { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' };
  if (zone === 'ANI') return { FLD_ZONE: 'AREA NOT INCLUDED', ZONE_SUBTY: null, SFHA_TF: 'F' };
  return { FLD_ZONE: zone || null, ZONE_SUBTY: null, SFHA_TF: sfha === 'IN' ? 'T' : sfha === 'OUT' ? 'F' : null };
}

// Query params for the whole parcel outline (same spatial filter as the FEMA NFHL query).
export function stevensFloodParams(geometry) {
  return {
    where: '1=1', geometry: JSON.stringify({ rings: rings(geometry), spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: STEVENS_FLOOD_OUT_FIELDS, returnGeometry: 'false', resultRecordCount: '100'
  };
}

// The source block for an answer built from this layer (additive to FEMA's { provider, url }).
export function stevensFloodSource(countyRows) {
  const zones = [...new Set(countyRows.map(a => text(a?.zone_)).filter(Boolean))];
  const panels = [...new Set(countyRows.map(a => text(a?.firm_panel)).filter(Boolean))];
  return {
    provider: STEVENS_FLOOD_PROVIDER, url: STEVENS_FLOOD_LAYER, label: STEVENS_FLOOD_LABEL, coverage: STEVENS_FLOOD_COVERAGE,
    digitalFemaMap: false, mapDate: '1998', countyZones: zones, firmPanels: panels, note: STEVENS_FLOOD_NOTE
  };
}

// Resolves { rows (NFHL-shaped), source } for the parcel; rows is empty when no county polygon
// touches it. Throws the shared client's UpstreamError when the county server fails.
// options.late: FEMA and the Esri backup already failed, so one short attempt only.
export async function stevensFloodLookup(geometry, { late = false } = {}) {
  const features = await arcgisQuery(STEVENS_FLOOD_LAYER, stevensFloodParams(geometry), {
    agency: STEVENS_AGENCY, label: 'stevens-flood',
    timeoutMs: late ? STEVENS_FLOOD_LATE_TIMEOUT_MS : STEVENS_FLOOD_TIMEOUT_MS,
    retryTimeoutMs: STEVENS_FLOOD_RETRY_TIMEOUT_MS, retries: late ? 0 : 1
  });
  const countyRows = features.map(f => f?.attributes || {});
  return { rows: countyRows.map(stevensFloodRow), source: stevensFloodSource(countyRows) };
}

// The registry entry src/services/flood.js uses (one per county with its own flood layer).
export const stevensFlood = Object.freeze({
  id: 'stevens', provider: STEVENS_FLOOD_PROVIDER, url: STEVENS_FLOOD_LAYER,
  matches: isStevensParcel, lookup: stevensFloodLookup
});
