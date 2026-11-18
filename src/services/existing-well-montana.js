// Montana existing-well match for /api/existing-well (state MT, every county): is there a
// recorded well on this parcel? Owner request 2026-11-18 (Yellowstone 03113503101110000: the
// listing and the map show a well inside the parcel, the report said none).
//
// Two public records, read in parallel on the shared upstream client:
// - MBMG GWIC Boreholes (the state well-log database): well points with depth, static water
//   level and completion date. How a point was located matters (`geomethod`):
//     NAV-GPS / SUR-GPS / SURVEY  located on site, a few metres         -> precise (30 m)
//     MAP / DIGITALMAP            plotted on a 1:24,000 map            -> precise (60 m)
//     TRS-SEC                     the centre of the smallest PLSS tract named in `qsection`
//                                 (0 letters = the section centre, 640 ac; each letter quarters
//                                 it: 160, 40, 10, 2.5 ac) -> the well is somewhere in that square
//     TRS-TWN / UNKNOWN           too coarse to place on a parcel
//   A precise point inside the parcel, or a TRS tract that lies (>= 90%) inside the parcel, puts
//   the well on the parcel. A section-centre point never does, wherever it falls.
//   GWIC also records a parcel `geocode` for some wells: a geocode match is the strongest signal.
// - Montana DNRC water rights, points of diversion (WRQS): groundwater rights list the geocodes
//   of their parcels. An active groundwater right whose geocodes include this parcel and whose
//   point maps on it is a second, independent record of a well here (ground water certificates
//   are filed once a well is completed).
// - Owner name (internal only): the statewide cadastral OwnerName is compared with GWIC
//   site_name (the well owner at drilling, "SMITH JOHN * TOWN MT") and the water right's owners.
//   Names are compared in this module only. They are never returned, logged or cached; the
//   answer carries only ownerMatch / partialOwnerMatch / ownerSimilarity (owner rule 2026-11-18).
// - Address: neither GWIC nor DNRC has a well site address, so addressMatch is null (not checked).
//
// The answer has the Spokane shape (status, label, confidence, score, match.evidence) plus
// evidence.onParcel (the one flag the dashboard, report and cost model read for "a recorded well
// on this parcel"), `summary` (the one display line), `waterRight` and `sourceStatus`. score is
// capped at 54 unless the well is on the parcel, so the existing `score >= 55` readers
// (public/ui-polish.js) agree with onParcel.

import { json } from '../shared/http.js';
import { cachedJson, upstreamJson } from '../shared/upstream.js';
import { nameSimilarity } from '../shared/owner-match.js';
import { GWIC_BOREHOLES } from '../states/montana/wells.js';
import { MONTANA_CADASTRAL } from '../states/montana/parcels.js';

export const DNRC_WATER_RIGHT_PODS = 'https://gis.dnrc.mt.gov/arcgis/rest/services/WRD/WRQS/MapServer/1';
export const GWIC_PERFORMANCE = 'https://mbmgmap.mtech.edu/server/rest/services/Water_Resources/GWIC_Database/FeatureServer/11';
// Whole answers (owner-free; only complete ones) for a day. Bump the version whenever the rules
// or the answer shape change: previews share the Cache API with production.
export const MT_EXISTING_WELL_CACHE_PREFIX = 'https://acresx.internal/cache/mt-existing-well/v1/';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// The browser gives this follow-up 15 s (public/progressive-loading.js FOLLOWUP_TIMEOUT_MS).
const SOURCE_TIMEOUTS = { timeoutMs: 7000, retryTimeoutMs: 4000 };
const OWNER_TIMEOUTS = { timeoutMs: 6000, retryTimeoutMs: 3000 };
const YIELD_BUDGET_MS = 3000;
const TOTAL_BUDGET_MS = 13500;
const SEARCH_PAD_M = 500;
const MAX_RECORDS = 500;
const NEAR_PRECISE_M = 60;
const TRACT_ON_PARCEL_SHARE = 0.9;
const TRACT_NEAR_SHARE = 0.25;
const SECTION_HALF_SIDE_M = 804.7; // a 1-mile PLSS section
const FT_PER_M = 3.28084;
const GWIC_HEADERS = { 'User-Agent': 'AcresX/0.9 Montana Beta' };

const compact = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const number = value => { const n = Number(value); return value != null && value !== '' && Number.isFinite(n) ? n : null; };
const sql = value => String(value ?? '').replaceAll("'", "''");

// ---- Geometry, in metres on a local plane around the parcel

function projector(geometry) {
  const pts = [];
  const walk = value => (Array.isArray(value?.[0]) ? value.forEach(walk) : pts.push(value));
  walk(geometry?.coordinates || []);
  const ok = pts.filter(p => Number.isFinite(Number(p?.[0])) && Number.isFinite(Number(p?.[1])));
  if (!ok.length) return null;
  const xs = ok.map(p => Number(p[0])), ys = ok.map(p => Number(p[1]));
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const lat0 = (box.minY + box.maxY) / 2;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return { box, lat0, kx, ky, toXY: p => [Number(p[0]) * kx, Number(p[1]) * ky] };
}

// [[outerRing, ...holes], ...] in metres.
function polygonsXY(geometry, proj) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.map(poly => (poly || []).map(ring => (ring || []).map(proj.toXY)));
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}
const inPolygons = (pt, polys) => polys.some(([outer, ...holes]) => outer && inRing(pt, outer) && !holes.some(h => inRing(pt, h)));

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, d2 = dx * dx + dy * dy;
  const t = d2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / d2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distanceToPolygons(pt, polys) {
  if (inPolygons(pt, polys)) return 0;
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentDistance(pt, ring[i - 1], ring[i]));
  return Number.isFinite(best) ? best : null;
}

// Share of the square (centre, half side) inside the parcel, from a 9 x 9 sample grid.
function squareShareInside([cx, cy], half, polys) {
  const n = 9; let hits = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (inPolygons([cx - half + (2 * half * (i + 0.5)) / n, cy - half + (2 * half * (j + 0.5)) / n], polys)) hits++;
  }
  return hits / (n * n);
}

// ---- Location precision

// GWIC geomethod + qsection (letters A-D, largest tract first).
export function gwicPrecision(geomethod, qsection) {
  const m = String(geomethod || '').trim().toUpperCase();
  if (/GPS|SURVEY/.test(m)) return { kind: 'precise', method: m, radiusM: 30 };
  if (/MAP/.test(m)) return { kind: 'precise', method: m, radiusM: 60 };
  if (m === 'TRS-SEC') return tractPrecision(m, String(qsection || '').toUpperCase().replace(/[^A-D]/g, '').length);
  if (m === 'TRS-TWN') return { kind: 'township', method: m };
  return { kind: 'unknown', method: m || 'UNKNOWN' };
}
// DNRC TRS_QQQQ, e.g. "T2N R28E Sec. 3 NWNWNE" (smallest tract first): count the quarter calls.
export function podPrecision(trs) {
  const tail = String(trs || '').toUpperCase().replace(/^.*SEC\.?\s*\d+\s*/, '');
  const calls = (tail.match(/NE|NW|SE|SW/g) || []).length;
  return tractPrecision('TRS', calls);
}
function tractPrecision(method, calls) {
  const n = Math.min(4, Math.max(0, calls));
  if (!n) return { kind: 'section', method, halfSideM: SECTION_HALF_SIDE_M, tractAcres: 640 };
  return { kind: 'tract', method, halfSideM: SECTION_HALF_SIDE_M / 2 ** n, tractAcres: 640 / 4 ** n };
}

// Where a record's point sits relative to the parcel, given how precise the point is.
function locate(lonLat, precision, polys, proj) {
  const pt = proj.toXY(lonLat);
  const pointInParcel = inPolygons(pt, polys);
  const distanceM = distanceToPolygons(pt, polys);
  let tractShare = null, located = false, near = false;
  if (precision.kind === 'precise') {
    located = pointInParcel;
    near = !pointInParcel && distanceM != null && distanceM <= NEAR_PRECISE_M;
  } else if (precision.kind === 'tract') {
    tractShare = squareShareInside(pt, precision.halfSideM, polys);
    located = pointInParcel && tractShare >= TRACT_ON_PARCEL_SHARE;
    near = !located && tractShare >= TRACT_NEAR_SHARE;
  } else if (precision.kind === 'section') {
    // Never "on the parcel" from a section-centre point; only whether the section touches it.
    tractShare = squareShareInside(pt, precision.halfSideM, polys);
  } else if (precision.kind === 'unknown') {
    near = distanceM != null && distanceM <= 100;
  }
  const sectionOnly = precision.kind === 'section' && tractShare > 0;
  return { pointInParcel, distanceM, tractShare, located, near, sectionOnly };
}

function scoreRecord({ parcelMatch, loc, precision, owner }) {
  const onParcel = Boolean(parcelMatch || loc.located || (owner.match && loc.near && precision.kind === 'precise'));
  let score = 0;
  if (parcelMatch) score += 80;
  if (loc.located) score += precision.kind === 'precise' ? 70 : 65;
  else if (loc.near) score += precision.kind === 'precise' ? 45 : precision.kind === 'tract' ? 30 : 20;
  else if (loc.sectionOnly) score += 10;
  if (owner.match) score += 25; else if (owner.partial) score += 12;
  score = Math.min(100, score);
  if (!onParcel) score = Math.min(54, score);
  const confidence = onParcel
    ? (parcelMatch || owner.match || precision.kind === 'precise' || (precision.kind === 'tract' && precision.tractAcres <= 10) ? 'High' : 'Moderate')
    : score >= 50 ? 'Moderate' : 'Low';
  return { onParcel, score, confidence };
}

function ownerSignal(parcelOwner, recordOwner) {
  if (!parcelOwner || !recordOwner) return { checked: false, match: false, partial: false, similarity: 0 };
  const similarity = nameSimilarity(parcelOwner, recordOwner);
  return { checked: true, match: similarity >= 0.55, partial: similarity >= 0.34, similarity };
}

function evidenceFor({ parcelMatch, loc, owner, onParcel, sourceKind }) {
  return {
    source: sourceKind,
    onParcel,
    parcelMatch: Boolean(parcelMatch),
    // insideParcel: the record places the well inside the parcel at its location precision
    // (never true for a section-centre point). pointInParcel: the plotted point alone.
    insideParcel: Boolean(loc.located),
    pointInParcel: Boolean(loc.pointInParcel),
    nearParcel: Boolean(loc.near),
    sectionCentreOnly: Boolean(loc.sectionOnly),
    distanceToParcelFt: loc.distanceM == null ? null : Math.round(loc.distanceM * FT_PER_M),
    tractShareInParcel: loc.tractShare == null ? null : Math.round(loc.tractShare * 100) / 100,
    ownerChecked: owner.checked,
    ownerMatch: owner.match,
    partialOwnerMatch: owner.partial,
    ownerSimilarity: Math.round(owner.similarity * 100),
    addressMatch: null
  };
}

const isoDate = value => {
  const n = number(value);
  const d = n != null ? new Date(n) : value ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

function gwicRecordUrl(id) {
  return id ? `https://mbmggwic.mtech.edu/sqlserver/v11/reports/SiteSummary.asp?gwicid=${encodeURIComponent(id)}&agency=mbmg&reqby=M` : '';
}
function dnrcRecordUrl(value) {
  try { const u = new URL(String(value || '')); return u.protocol === 'https:' && /(^|\.)mt\.gov$/i.test(u.hostname) ? u.href : ''; } catch { return ''; }
}

// ---- Upstream reads

function envelopeFor(proj) {
  const padY = SEARCH_PAD_M / proj.ky, padX = SEARCH_PAD_M / proj.kx;
  return { xmin: proj.box.minX - padX, ymin: proj.box.minY - padY, xmax: proj.box.maxX + padX, ymax: proj.box.maxY + padY, spatialReference: { wkid: 4326 } };
}
function envelopeParams(url, envelope) {
  url.searchParams.set('geometry', JSON.stringify(envelope));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('resultRecordCount', String(MAX_RECORDS));
  url.searchParams.set('f', 'json');
}

async function queryGwicWells(envelope) {
  const url = new URL(`${GWIC_BOREHOLES}/query`);
  url.searchParams.set('where', "site_type = 'WELL'");
  envelopeParams(url, envelope);
  // site_name is the well owner's name: requested for the owner comparison only, never returned.
  url.searchParams.set('outFields', 'gwicid,site_name,geomethod,qsection,township,range,section,geocode,total_depth_ft_bgs,static_water_level_ft_bgs,date_completed,status,site_type,construction_type,abandoned_flag');
  const data = await upstreamJson(url, { ...SOURCE_TIMEOUTS, headers: GWIC_HEADERS, arcgis: true, label: 'mbmg-gwic-existing-well', agency: 'GWIC Boreholes service', arcgisMessage: 'GWIC Boreholes query failed' });
  return data.features || [];
}

async function queryWaterRights(envelope) {
  const url = new URL(`${DNRC_WATER_RIGHT_PODS}/query`);
  url.searchParams.set('where', "SOURCE_TYPE = 'GROUNDWATER'");
  envelopeParams(url, envelope);
  // OWNERS: compared with the parcel owner here only, never returned.
  url.searchParams.set('outFields', 'WR_NUMBER,WR_TYPE,WR_STATUS,PURPOSES,GEOCODES,SOURCE_TYPE,MEANS_OF_DIV,WELL_DEPTH,TRS_QQQQ,MAX_FLOW_GPM,URL_ABSTRACT,OWNERS');
  const data = await upstreamJson(url, { ...SOURCE_TIMEOUTS, arcgis: true, label: 'mt-dnrc-water-right-pods', agency: 'Montana DNRC water rights service', arcgisMessage: 'DNRC water rights query failed' });
  return data.features || [];
}

// The parcel owner from the statewide cadastral (OwnerName only). Never cached or returned.
async function queryParcelOwner(parcelId) {
  const id = compact(parcelId);
  if (!id) return '';
  const url = new URL(`${MONTANA_CADASTRAL}/query`);
  url.searchParams.set('where', `UPPER(PARCELID)='${sql(id)}'`);
  url.searchParams.set('outFields', 'PARCELID,OwnerName');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '2');
  url.searchParams.set('f', 'json');
  const data = await upstreamJson(url, { ...OWNER_TIMEOUTS, arcgis: true, label: 'mt-cadastral-owner', agency: 'Montana cadastral service', arcgisMessage: 'Montana cadastral owner lookup failed' });
  const row = (data.features || []).find(f => compact(f.attributes?.PARCELID) === id);
  return String(row?.attributes?.OwnerName || '').trim();
}

// Pump-test yield for one GWIC well (best effort: null when the table does not answer in time).
async function queryYield(gwicId, timeoutMs) {
  const url = new URL(`${GWIC_PERFORMANCE}/query`);
  url.searchParams.set('where', `gwicid = ${Number(gwicId)}`);
  url.searchParams.set('outFields', 'gwicid,yield_gpm');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '20');
  url.searchParams.set('f', 'json');
  try {
    const data = await upstreamJson(url, { timeoutMs, retries: 0, headers: GWIC_HEADERS, arcgis: true, label: 'mbmg-gwic-yield', agency: 'GWIC Performance service' });
    const yields = (data.features || []).map(f => number(f.attributes?.yield_gpm)).filter(v => v != null && v > 0);
    return yields.length ? Math.max(...yields) : null;
  } catch { return null; }
}

const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

// ---- Candidates

function gwicCandidates(features, ctx) {
  const out = [];
  for (const feature of features) {
    const a = feature.attributes || {}, g = feature.geometry || {};
    const lon = number(g.x), lat = number(g.y);
    if (lon == null || lat == null) continue;
    if (['Y', 'YES', 'TRUE'].includes(String(a.abandoned_flag || '').trim().toUpperCase())) continue;
    const id = a.gwicid != null ? String(a.gwicid) : '';
    const precision = gwicPrecision(a.geomethod, a.qsection);
    const loc = locate([lon, lat], precision, ctx.polys, ctx.proj);
    const parcelMatch = Boolean(a.geocode && compact(a.geocode) === ctx.parcelKey);
    // GWIC site_name: "SMITH JOHN * TOWN MT" (owner, then the town after the asterisk).
    const owner = ownerSignal(ctx.owner, String(a.site_name || '').split('*')[0]);
    const s = scoreRecord({ parcelMatch, loc, precision, owner });
    const depth = number(a.total_depth_ft_bgs), completed = isoDate(a.date_completed);
    out.push({
      source: 'gwic', id, gwicId: id, wellTag: id ? `GWIC ${id}` : '', parcelNumber: a.geocode ? String(a.geocode) : '',
      completedDepth: depth != null && depth > 0 ? depth : null,
      completionDate: completed, completionYear: completed ? Number(completed.slice(0, 4)) : null,
      staticWaterLevelFt: number(a.static_water_level_ft_bgs), yieldGpm: null, flowRateGPM: null,
      wellType: String(a.construction_type || a.site_type || ''), status: String(a.status || ''),
      locationMethod: precision.method, locationPrecision: { kind: precision.kind, tractAcres: precision.tractAcres ?? null },
      latitude: lat, longitude: lon, recordUrl: gwicRecordUrl(id),
      evidence: evidenceFor({ parcelMatch, loc, owner, onParcel: s.onParcel, sourceKind: 'gwic' }),
      score: s.score, confidence: s.confidence
    });
  }
  return out.sort((a, b) => b.score - a.score || (a.evidence.distanceToParcelFt ?? 1e9) - (b.evidence.distanceToParcelFt ?? 1e9));
}

function waterRightCandidates(features, ctx) {
  const out = [];
  for (const feature of features) {
    const a = feature.attributes || {}, g = feature.geometry || {};
    if (!/ACTIVE/i.test(String(a.WR_STATUS || ''))) continue;
    if (a.MEANS_OF_DIV && !/WELL/i.test(String(a.MEANS_OF_DIV))) continue;
    const lon = number(g.x), lat = number(g.y);
    const geocodes = String(a.GEOCODES || '').split(/[;,]/).map(compact).filter(Boolean);
    const parcelMatch = geocodes.includes(ctx.parcelKey);
    const precision = podPrecision(a.TRS_QQQQ);
    const loc = lon != null && lat != null ? locate([lon, lat], precision, ctx.polys, ctx.proj) : { pointInParcel: false, distanceM: null, tractShare: null, located: false, near: false, sectionOnly: false };
    const owner = ownerSignal(ctx.owner, a.OWNERS);
    // A geocode match alone says the right lists this parcel; with the point mapping off the
    // parcel (a shared well next door) it stays "possible", not "on this parcel".
    const geocodeOnParcel = parcelMatch && (loc.pointInParcel || (loc.tractShare ?? 0) >= 0.5);
    const s = scoreRecord({ parcelMatch: geocodeOnParcel, loc, precision, owner });
    const score = parcelMatch && !s.onParcel ? Math.max(s.score, 50) : s.score;
    const depth = number(a.WELL_DEPTH), flow = number(a.MAX_FLOW_GPM);
    out.push({
      source: 'dnrc_water_right', id: String(a.WR_NUMBER || '').trim(), waterRightNumber: String(a.WR_NUMBER || '').trim(),
      type: String(a.WR_TYPE || ''), status: String(a.WR_STATUS || ''), purposes: String(a.PURPOSES || ''),
      completedDepth: depth != null && depth > 0 ? depth : null, maxFlowGpm: flow != null && flow > 0 ? flow : null,
      locationMethod: 'TRS', locationPrecision: { kind: precision.kind, tractAcres: precision.tractAcres ?? null },
      latitude: lat, longitude: lon, recordUrl: dnrcRecordUrl(a.URL_ABSTRACT),
      evidence: { ...evidenceFor({ parcelMatch: geocodeOnParcel, loc, owner, onParcel: s.onParcel, sourceKind: 'dnrc_water_right' }), geocodeListed: parcelMatch },
      score, confidence: s.onParcel ? s.confidence : score >= 50 ? 'Moderate' : 'Low'
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function statusOf(c) {
  if (!c) return 'no_match';
  if (c.evidence.onParcel) return 'strong_match';
  if (c.score >= 50) return 'likely_match';
  if (c.evidence.nearParcel || c.score >= 25) return 'possible_match';
  return 'no_match';
}
const RANK = { strong_match: 3, likely_match: 2, possible_match: 1, no_match: 0 };

function summaryLine(status, match, waterRight) {
  if (status === 'strong_match' && match?.source === 'gwic') {
    const parts = [`GWIC #${match.gwicId}`];
    if (match.completedDepth) parts.push(`${Math.round(match.completedDepth)} ft`);
    if (match.completionYear) parts.push(String(match.completionYear));
    const also = waterRight?.evidence?.onParcel ? '; a state groundwater right also lists this parcel' : '';
    return `Recorded well on this parcel (${parts.join(', ')})${also}`;
  }
  if (status === 'strong_match') return `State groundwater right for a well on this parcel (DNRC ${match.waterRightNumber})`;
  if (status === 'likely_match') return 'Possible well record near this parcel (moderate confidence)';
  if (status === 'possible_match') return 'Possible well record near this parcel (low confidence)';
  return 'No recorded well matched to this parcel';
}

const LABELS = { strong_match: 'Recorded well on this parcel', likely_match: 'Possible well record near this parcel', possible_match: 'Possible well record near this parcel', no_match: 'No existing well match found' };

async function buildAnswer(body, county) {
  const started = Date.now();
  const proj = projector(body.geometry);
  const polys = proj ? polygonsXY(body.geometry, proj) : [];
  if (!proj || !polys.length) return { error: 'A parcel polygon is required.', status: 400 };
  const envelope = envelopeFor(proj);
  const [gwic, rights, owner] = await Promise.all([settle(queryGwicWells(envelope)), settle(queryWaterRights(envelope)), settle(queryParcelOwner(body.parcelId))]);
  const sourceStatus = { gwic: gwic.ok ? 'ok' : 'unavailable', waterRights: rights.ok ? 'ok' : 'unavailable', assessor: owner.ok ? (owner.value ? 'checked' : 'not_found') : 'unavailable' };
  const base = { county: county || '', state: 'MT', parcelId: String(body.parcelId || ''), sourceStatus, sources: { wells: 'Montana Bureau of Mines and Geology GWIC well logs', waterRights: 'Montana DNRC water rights (points of diversion)', assessor: 'Montana statewide cadastral (owner compared, never shown)' } };
  if (!gwic.ok && !rights.ok) {
    return { body: { available: false, status: 'unavailable', label: 'Well-record screening unavailable: the Montana well and water-right services did not answer', confidence: 'Low', ...base } };
  }
  const ctx = { proj, polys, parcelKey: compact(body.parcelId), owner: owner.ok ? owner.value : '' };
  const wells = gwic.ok ? gwicCandidates(gwic.value, ctx) : [];
  const pods = rights.ok ? waterRightCandidates(rights.value, ctx) : [];
  const bestWell = wells[0] || null, bestPod = pods[0] || null;
  const wellStatus = statusOf(bestWell), podStatus = statusOf(bestPod);
  // The well log carries depth and year, so it is the match unless the water right is stronger.
  const useWell = RANK[wellStatus] >= RANK[podStatus];
  const status = useWell ? wellStatus : podStatus;
  const chosen = status === 'no_match' ? null : useWell ? bestWell : bestPod;
  const waterRight = podStatus === 'no_match' ? null : bestPod;
  let confidence = chosen ? chosen.confidence : 'Low';
  if (status === 'strong_match' && useWell && waterRight?.evidence?.onParcel) confidence = 'High';
  if (chosen?.source === 'gwic' && chosen.gwicId && Date.now() - started < TOTAL_BUDGET_MS - YIELD_BUDGET_MS) {
    chosen.yieldGpm = await queryYield(chosen.gwicId, YIELD_BUDGET_MS);
    chosen.flowRateGPM = chosen.yieldGpm;
  }
  const partial = !gwic.ok || !rights.ok;
  return {
    body: {
      available: true, ...base, partial,
      status, label: LABELS[status], confidence,
      summary: summaryLine(status, chosen, waterRight),
      score: chosen?.score || 0, match: chosen, waterRight,
      candidateCount: wells.length + pods.length,
      siteAddress: String(body.address || ''),
      methodology: 'Matches Montana GWIC well logs and DNRC groundwater rights to the parcel by parcel geocode, mapped location (GPS and map points; township-range-section tracts only when the whole tract lies in the parcel, never a section-centre point), and the current owner name (compared, never shown). GWIC and DNRC records have no well address.',
      caution: 'Well logs and water rights are historical records and mapped locations can be approximate. A match is screening evidence, not proof that a well is currently usable or legally serving the parcel; verify its condition and yield.'
    }
  };
}

export async function handleMontanaExistingWell(body, county) {
  if (!body?.parcelId || !body?.geometry) return json({ error: 'parcelId and geometry are required.' }, 400, 'no-store');
  const key = { parcelId: compact(body.parcelId), geometry: body.geometry };
  let answer;
  try {
    const cached = await cachedJson(MT_EXISTING_WELL_CACHE_PREFIX, key, CACHE_TTL_SECONDS, async () => {
      const built = await buildAnswer(body, county);
      return built.error ? { error: built.error, httpStatus: built.status } : built.body;
    }, { isValid: value => Boolean(value?.available && !value.partial && !value.error) });
    answer = cached;
  } catch (error) {
    answer = { available: false, status: 'unavailable', label: 'Well-record screening unavailable', state: 'MT', county: county || '', error: String(error?.message || error) };
  }
  if (answer?.error && answer.httpStatus) return json({ error: answer.error }, answer.httpStatus, 'no-store');
  // County name from this request (a cached answer may be shared by the same parcel's searches).
  const out = { ...answer, county: county || answer.county || '' };
  return json(out, 200, out.available && !out.partial ? 'public, max-age=300, s-maxage=900' : 'no-store');
}
