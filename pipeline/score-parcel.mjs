// One included parcel -> the rows the index stores (parcels, parcel_layers, parcel_shapes,
// parcel_inputs). The report's parcel (in-process /api/parcel-search; the bulk outline when that
// fails), the report's layers (pipeline/assemble.mjs) and the report's score (score-core.js).
import * as turf from '@turf/turf';
import { createHash } from 'node:crypto';
import { assembleParcel, findParcel } from './assemble.mjs';
import { zoningPoint } from './report-inputs.mjs';
import { scoreOf, scoreColumns, layerColumns, layerStatuses, trimInputs, rehydrateInputs, layersMissing } from './columns.mjs';
import { loadAcreage, loadScoreCore } from './browser-scripts.mjs';
import { SHAPE_TOLERANCE_M, SHAPE_DECIMALS } from './config.mjs';

const round = (v, d = SHAPE_DECIMALS) => (Array.isArray(v) ? v.map(x => round(x, d)) : typeof v === 'number' ? Number(v.toFixed(d)) : v);
export const normId = id => String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// docs/explore-index.md section 4: hash of id, acres, outline (6 decimals), assessor values and
// property class, from the bulk pull, so a parcel can be skipped before any per-parcel request.
export function sourceHash({ pid, row, geometry }) {
  const a = row?.assessment || {};
  return createHash('sha256').update(JSON.stringify({
    id: pid, acres: row?.acreage ?? null, outline: geometry ? { type: geometry.type, coordinates: round(geometry.coordinates) } : null,
    values: [a.landValue ?? null, a.improvementValue ?? null, a.totalValue ?? null, a.taxableValue ?? null, a.marketLandValue ?? null, a.taxYear ?? null],
    propertyClass: row?.propUseCode ?? null, exemption: row?.exmpCode ?? null
  })).digest('hex').slice(0, 32);
}

// Simplified outline for parcel_shapes (Douglas-Peucker, ~5 m; 6 decimals).
export function simplifiedShape(geometry) {
  const tolerance = SHAPE_TOLERANCE_M / 111320;
  let g = geometry;
  try { g = turf.simplify({ type: 'Feature', properties: {}, geometry }, { tolerance, highQuality: false }).geometry; } catch { g = geometry; }
  return { geojson: JSON.stringify({ type: g.type, coordinates: round(g.coordinates) }), toleranceM: SHAPE_TOLERANCE_M };
}

export async function headlineAcres(parcel) {
  const d = (await loadAcreage()).describe(parcel);
  return { acres: d.official, acresSource: d.officialSource === 'assessor' ? 'assessor' : d.officialSource === 'mapped' ? 'gis_outline' : null };
}

// The parts of the row that come from the bulk pull and the inclusion rule.
export async function baseRow({ county, state, cand, parcel, now, runId }) {
  const [lng, lat] = zoningPoint(parcel);
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(parcel);
  const { acres, acresSource } = await headlineAcres(parcel);
  const a = cand.row.assessment || {};
  return {
    county_key: county, parcel_id: cand.pid, parcel_id_norm: normId(cand.pid), state,
    index_status: 'active', stale: 0, stale_reason: null, inclusion_reason: cand.reason,
    lat, lng, bbox_min_lat: minLat, bbox_min_lng: minLng, bbox_max_lat: maxLat, bbox_max_lng: maxLng,
    situs_city: parcel.properties?.SITUS_CITY_NM || null,
    acres: acres ?? cand.acres, acres_source: acresSource,
    in_city: cand.inCity, city_name: cand.cityName ?? null,
    property_class: cand.row.propUseCode, improved: cand.row.improved,
    assessed_land: a.landValue ?? null, assessed_improvements: a.improvementValue ?? null, assessed_total: a.totalValue ?? null, assessment_year: a.taxYear ?? null,
    tax_total: null, tax_year: null, tax_basis: null,
    cost_low: null, cost_central: null, cost_high: null, listing_key: null, listing_status: null, list_price: null, listing_synced_at: null,
    source_hash: cand.sourceHash, first_seen_at: now, pulled_at: now, scored_at: now, run_id: runId
  };
}

// cand: { pid, row, bulk (Feature), reason, inCity, cityName, acres, sourceHash, cityLayer, publicLayer }
export async function scoreParcel(cand, { api, where, county, state, labels = {}, now, runId, inputsVersion, assembleOptions = {} }) {
  const found = await findParcel(cand.pid, api);
  const parcel = found.parcel || cand.bulk;
  const parcelLayer = found.parcel
    ? { status: 'ok', source: labels.parcel || null }
    // The bulk outline comes from the same layer with the same fields and outSR, so the parcel
    // itself is not missing: 'ok' from the backup, with the reason kept.
    : { status: 'ok', backup: 1, source: 'bulk outline (same parcel layer)', error: `parcel search failed: ${String(found.error || 'no answer')}`.slice(0, 160) };

  const { last, sections, followups, attempts } = await assembleParcel(parcel, { api, where, ...assembleOptions });
  const result = scoreOf(last, sections);
  const inputs = trimInputs(last, sections);
  // The stored inputs must give the same score (they are what a rescore and the parity check read).
  const again = rehydrateInputs(JSON.parse(JSON.stringify(inputs)));
  const check = scoreOf(again.last, again.sections);
  const inputsMatch = check.score === result.score && check.rating === result.rating;

  const statuses = layerStatuses(last, { sections, followups, parcelLayer, cityLayer: cand.cityLayer, assessmentLayer: { status: 'ok', source: labels.assessment || null } });
  const row = { ...(await baseRow({ county, state, cand, parcel, now, runId })), ...layerColumns(last), ...scoreColumns(result), layers_missing: layersMissing(statuses) };
  return { row, layers: statuses, shape: simplifiedShape(parcel.geometry), inputs, inputsVersion, last, sections, followups, attempts, result, inputsMatch };
}

// A parcel whose scoring threw (a bug, not an upstream failure): kept with every layer unknown.
export async function failedParcel(cand, error, { county, state, labels = {}, now, runId }) {
  const parcel = cand.bulk;
  const message = String(error?.message || error || 'pipeline error').slice(0, 160);
  const layers = Object.fromEntries(['parcel', 'zoning', 'zoning_rules', 'flood', 'wetlands', 'land', 'slope', 'buildable', 'wells', 'well_terrain', 'public_utilities', 'utility', 'power', 'road']
    .map(k => [k, { status: 'unavailable', error: `pipeline error: ${message}` }]));
  if (cand.cityLayer) layers.city_limits = cand.cityLayer;
  layers.assessment = { status: 'ok', source: labels.assessment || null };
  layers.tax = { status: 'not_checked' }; layers.listing = { status: 'not_checked' };
  const C = loadScoreCore();
  const row = { ...(await baseRow({ county, state, cand, parcel, now, runId })), score: null, score_band: null, score_rating: 'Not scored', score_factors_measured: 0, score_provisional: 1, score_why: null, score_factors_json: null, score_version: String(C.SCORE_RULES_VERSION), layers_missing: layersMissing(layers) };
  return { row, layers, shape: simplifiedShape(parcel.geometry), inputs: null };
}
