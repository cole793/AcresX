// How much of a parcel lies in each flood zone, for POST /api/hazards { kind: 'flood' }.
//
// src/services/flood.js answers which zones touch the parcel (FEMA NFHL layer 28, or the Esri
// backup copy). Once it has, floodShares() asks the same layer again for the outlines of the
// zones that need measuring and adds these fields to the answer (nothing existing changes):
//   floodZones:   [{ zone, subtype, sfha, category, sharePct, acres, edgeOnly?, remainder? }],
//                 largest first. sharePct is the percent of the parcel (1 decimal), acres 2
//                 decimals. edgeOnly: the zone was returned (it touches the parcel) but covers
//                 no measurable area, i.e. it only meets the parcel line. remainder: the entry
//                 is the part of the parcel outside every measured zone, given to the parcel's
//                 minimal-hazard zone (see below).
//   sfhaSharePct, sfhaAcres: Special Flood Hazard Area (1% annual chance) share, overlaps once.
//   parcelAcres:  the parcel area the shares are taken of (spherical, from the outline).
//   floodShare:   { status: 'measured' | 'unavailable', method, source, restSharePct?, restZone?,
//                   coverage?, error? }
// When the outlines can't be had (timeout, error, answer too large), only floodShare is added,
// with status 'unavailable': the zone answer stands and the page says the share is unmeasured.
//
// Which outlines are asked for (FEMA, checked live on 2026-11-14 for Spokane 23123.9051):
//   The unshaded zone X ("AREA OF MINIMAL FLOOD HAZARD") polygon is enormous: 24,157 vertices,
//   578 KB for one 20-acre parcel (1 m generalization), where the zone A polygon was 132 vertices,
//   3.7 KB. So minimal X (and C) outlines are never fetched: whatever part of the parcel no
//   fetched zone covers is given to the minimal zone the zone answer listed (restZone), and if
//   the answer listed none, it is reported as restSharePct with restZone null.
//   FEMA's firewall answers HTTP 202 with an empty body to any where clause holding " AND " or
//   " OR " (seen on 2026-11-14), so the two zone families are two simple queries, run together:
//     FLD_ZONE NOT IN ('X','C')                       A*, V*, D, AREA NOT INCLUDED, OPEN WATER
//     ZONE_SUBTY <> 'AREA OF MINIMAL FLOOD HAZARD'    kept only for X rows: shaded X
//   Each is sent only when the zone answer has such a zone, so a parcel that is all minimal X
//   costs no extra request (it is 100% X).
//   The Esri backup holds no minimal X at all, so it is one 1=1 query, and the rest of the parcel
//   is "outside mapped high- and moderate-risk areas" (restZone null, coverage noted).
// Area: src/shared/polygon-coverage.js stripAreas (exact along 400 strips; zone A on 23123.9051
// measured 67.12% at 400 strips and 67.13% at 10,000).
// Requests: the shared upstream client, f=json, outSR 4326, maxAllowableOffset 0.00001 (~1 m),
// geometryPrecision 6, at most 100 features, a 3 MB body cap, one attempt of at most 6 s (less
// when the zone lookup already used most of the 25 s budget).
import { arcgisQuery } from '../shared/upstream.js';
import { ringsFromGeometry, stripAreas, SQM_PER_ACRE } from '../shared/polygon-coverage.js';

export const FLOOD_SHARE_TIMEOUT_MS = 6000;
export const FLOOD_SHARE_MIN_TIMEOUT_MS = 2000;
export const FLOOD_SHARE_MAX_BYTES = 3_000_000;
export const FLOOD_SHARE_METHOD = 'strip-integration';
export const MINIMAL_SUBTYPE = 'AREA OF MINIMAL FLOOD HAZARD';
export const WHERE_NOT_X = "FLD_ZONE NOT IN ('X','C')";
export const WHERE_SHADED = `ZONE_SUBTY <> '${MINIMAL_SUBTYPE}'`;
const OUT_FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF';
const BACKUP_OUT_FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,esri_symbology';

// Tests only: { enabled: false } turns shares off, for tests of the zone lookup alone (its
// request counts and exact bodies). test/flood-share.test.js runs with shares on. Returns a
// restore function.
let settings = { enabled: true };
export function configureFloodShares(overrides = {}) {
  const previous = settings;
  settings = { ...settings, ...overrides };
  return () => { settings = previous; };
}

const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;

function esriRings(geometry) {
  return geometry?.type === 'Polygon' ? geometry.coordinates : geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat() : [];
}

export function floodShareParams(geometry, where, outFields = OUT_FIELDS) {
  return {
    where, geometry: JSON.stringify({ rings: esriRings(geometry), spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPolygon',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'true', outSR: '4326',
    maxAllowableOffset: '0.00001', geometryPrecision: '6', resultRecordCount: '100'
  };
}

// The queries a zone answer needs. describe(row) -> { zone, subtype, sfha, category } (from
// src/services/flood.js). Returns { queries: [{ where, keep }], restZone }.
export function floodSharePlan(rows, { describe, backup = false } = {}) {
  const described = (rows || []).map(row => describe(row)).filter(d => d.zone);
  if (backup) return { queries: described.length ? [{ where: '1=1', keep: () => true }] : [], restZone: null };
  const minimal = described.filter(d => d.category === 'minimal');
  const restZone = minimal.length ? (minimal.find(d => d.zone === 'X') || minimal[0]).zone : null;
  const queries = [];
  if (described.some(d => d.zone !== 'X' && d.zone !== 'C')) queries.push({ where: WHERE_NOT_X, keep: () => true });
  if (described.some(d => d.zone === 'X' && d.category !== 'minimal')) queries.push({ where: WHERE_SHADED, keep: d => d.zone === 'X' });
  return { queries, restZone };
}

// The added fields from the parcel outline and the fetched zone features.
export function measureFloodShares(geometry, features, { describe, restZone = null, provider, coverage } = {}) {
  const parcel = ringsFromGeometry(geometry);
  if (!parcel) throw new Error('parcel outline missing');
  const groups = { sfha: [], any: [] };
  const entries = new Map();
  for (const feature of features || []) {
    const rings = ringsFromGeometry(feature?.geometry);
    if (!rings) throw new Error('a flood zone came back without its outline');
    const d = describe(feature?.attributes || {});
    if (!d.zone) continue;
    const key = `${d.zone}|${d.subtype || ''}`;
    if (!entries.has(key)) { entries.set(key, d); groups[`zone:${key}`] = []; }
    groups[`zone:${key}`].push(rings);
    if (d.sfha) groups.sfha.push(rings);
    groups.any.push(rings);
  }
  const areas = stripAreas(parcel, groups);
  const total = areas.parcelSqM;
  if (!(total > 0)) throw new Error('parcel area could not be measured');
  const share = sqm => Math.min(1, Math.max(0, sqm / total));
  const zones = [...entries.entries()].map(([key, d]) => {
    const s = share(areas.groups[`zone:${key}`]);
    return { zone: d.zone, subtype: d.subtype || null, sfha: d.sfha, category: d.category, sharePct: round1(s * 100), acres: round2(s * total / SQM_PER_ACRE), ...(s === 0 ? { edgeOnly: true } : {}) };
  });
  const rest = 1 - share(areas.groups.any);
  if (restZone && rest > 0.0005) {
    zones.push({ zone: restZone, subtype: restZone === 'X' ? MINIMAL_SUBTYPE : null, sfha: false, category: 'minimal', sharePct: round1(rest * 100), acres: round2(rest * total / SQM_PER_ACRE), remainder: true });
  }
  zones.sort((a, b) => b.sharePct - a.sharePct || Number(b.sfha) - Number(a.sfha));
  const sfha = share(areas.groups.sfha);
  return {
    floodZones: zones,
    sfhaSharePct: round1(sfha * 100), sfhaAcres: round2(sfha * total / SQM_PER_ACRE),
    parcelAcres: round2(total / SQM_PER_ACRE),
    floodShare: {
      status: 'measured', method: FLOOD_SHARE_METHOD, source: provider || null,
      restSharePct: round1(Math.max(0, rest) * 100), restZone, ...(coverage ? { coverage } : {})
    }
  };
}

// The fields to add to a zone answer, or {} when there is nothing to measure. Never throws.
// options: { layerUrl, provider, agency, rows (the zone answer's attribute rows), describe,
//            backup, coverage, timeoutMs }
export async function floodShares(geometry, options = {}) {
  const { layerUrl, provider, agency, rows, describe, backup = false, coverage, timeoutMs = FLOOD_SHARE_TIMEOUT_MS } = options;
  if (!settings.enabled) return {};
  try {
    const plan = floodSharePlan(rows, { describe, backup });
    if (!plan.queries.length && !plan.restZone) return {};
    if (plan.queries.length && timeoutMs < FLOOD_SHARE_MIN_TIMEOUT_MS) throw new Error('no time left after the zone lookup');
    const answers = await Promise.all(plan.queries.map(q => arcgisQuery(layerUrl, floodShareParams(geometry, q.where, backup ? BACKUP_OUT_FIELDS : OUT_FIELDS), {
      agency, label: 'flood-share', timeoutMs: Math.min(FLOOD_SHARE_TIMEOUT_MS, timeoutMs), retries: 0, maxBytes: FLOOD_SHARE_MAX_BYTES
    }).then(features => features.filter(f => q.keep(describe(f?.attributes || {}))))));
    const fields = measureFloodShares(geometry, answers.flat(), { describe, restZone: plan.restZone, provider, coverage });
    if (!plan.queries.length) fields.floodShare.method = 'single-zone';
    return fields;
  } catch (error) {
    console.warn('Flood share not measured', error?.message);
    return { floodShare: { status: 'unavailable', source: provider || null, error: String(error?.message || 'failed') } };
  }
}
