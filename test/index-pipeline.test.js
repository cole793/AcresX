// Offline tests for the parcel index batch job (pipeline/, docs/explore-index.md Phase 1 step 2):
// the inclusion rule and exclusion codes, the city-limits overlay, degraded layers, resume/skip
// and that the stored score is score-core.js's score. globalThis.fetch is stubbed (the county
// layers answer from synthetic parcels below; every other host fails), and the in-process report
// calls answer from a recorded fixture (test/fixtures/index-spokane-23123.9051.json, recorded
// 2026-11-24 from the live handlers with well project names, permits and the situs removed).
// Nothing here touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { decide, needsOutline, preExclusion, smallWithoutOutline, INCLUSION_REASONS } from '../pipeline/inclusion.mjs';
import * as spokane from '../pipeline/counties/spokane.mjs';
import { preparePolygons, parcelSamples } from '../pipeline/overlay.mjs';
import { openIndexDb } from '../pipeline/db.mjs';
import { runIndex, plan, parseArgs } from '../pipeline/build-index.mjs';
import { scoreParcel } from '../pipeline/score-parcel.mjs';
import { rehydrateInputs, scoreOf, useFlag, SINGLE_FAMILY_USE, MANUFACTURED_HOME_USE } from '../pipeline/columns.mjs';
import { politeFetch, requestScope, newCounter, MemoryCache } from '../pipeline/runtime.mjs';
import { setPageRetry } from '../pipeline/arcgis.mjs';
import { INCLUDE_MIN_ACRES, USER_AGENT } from '../pipeline/config.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/index-spokane-23123.9051.json', import.meta.url), 'utf8'));

// An independent copy of the score core (its own vm context), to check the pipeline's numbers.
const core = (() => { const c = vm.createContext({}); vm.runInContext(readFileSync(new URL('../public/score-core.js', import.meta.url), 'utf8'), c); return c.AcresXScoreCore; })();

const realFetch = globalThis.fetch;
setPageRetry({ retries: 1, backoffMs: [0] });
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

// ---- 1. Inclusion rule

test('INCLUDE_MIN_ACRES comes from pipeline/config.mjs and is 1 acre', () => {
  assert.equal(INCLUDE_MIN_ACRES, 1);
  assert.deepEqual([...INCLUSION_REASONS], ['rural_acreage', 'rural_improved', 'rural_vacant_small', 'city_acreage']);
});

test('inclusion rule: the four inclusion reasons', () => {
  const base = { id: 'X', codeReason: null, hasGeometry: true, publicLand: { coversMost: false, touches: false } };
  assert.deepEqual(decide({ ...base, acres: 10, inCity: 0, improved: 0 }), { included: true, reason: 'rural_acreage' });
  assert.deepEqual(decide({ ...base, acres: 10, inCity: 0, improved: 1 }), { included: true, reason: 'rural_improved' });
  assert.deepEqual(decide({ ...base, acres: 10, inCity: 0, improved: null }), { included: true, reason: 'rural_acreage' }, 'unknown improvement: acreage test only');
  assert.deepEqual(decide({ ...base, acres: 0.2, inCity: 0, improved: 0 }), { included: true, reason: 'rural_vacant_small' });
  assert.deepEqual(decide({ ...base, acres: 1, inCity: 1, improved: 1 }), { included: true, reason: 'city_acreage' }, 'exactly the cutoff counts');
  assert.deepEqual(decide({ ...base, acres: 5, inCity: 1, improved: 0 }), { included: true, reason: 'city_acreage' });
});

test('inclusion rule: small parcels, the cutoff and a failed city layer', () => {
  const base = { id: 'X', codeReason: null, hasGeometry: true, publicLand: null };
  assert.equal(decide({ ...base, acres: 0.99, inCity: 1, improved: 0 }).reason, 'city_small');
  assert.equal(decide({ ...base, acres: 0.5, inCity: 0, improved: 1 }).reason, 'small_improved');
  assert.equal(decide({ ...base, acres: 0.5, inCity: 0, improved: null }).reason, 'small_unknown_improvement');
  // City-limits layer down: kept on acreage, never dropped for being "maybe in a city".
  assert.deepEqual(decide({ ...base, acres: 3, inCity: null, improved: 1 }), { included: true, reason: 'rural_improved' });
  assert.equal(decide({ ...base, acres: 0.5, inCity: null, improved: 0 }).reason, 'city_unknown_small');
  assert.equal(decide({ ...base, acres: 3, inCity: 0, improved: 0 }, 5).reason, 'rural_vacant_small', 'the cutoff is a parameter');
  assert.equal(decide({ ...base, acres: 10, inCity: 0, improved: 0, hasGeometry: false }).reason, 'no_geometry');
  assert.equal(decide({ ...base, id: '', acres: 10, inCity: 0, improved: 0 }).reason, 'no_id');
});

test('only parcels that can still be included need an outline', () => {
  assert.equal(needsOutline({ acres: 2, improved: 1 }), true);
  assert.equal(needsOutline({ acres: 0.3, improved: 0 }), true, 'small vacant: the city test decides');
  assert.equal(needsOutline({ acres: 0.3, improved: 1 }), false);
  assert.equal(needsOutline({ acres: 0.3, improved: null }), false);
  assert.equal(needsOutline({ acres: null, improved: 1 }), true, 'no assessor acres: the outline area decides');
  assert.equal(smallWithoutOutline({ improved: 1 }), 'small_improved');
  assert.equal(preExclusion({ id: 'A', codeReason: 'condo' }).excluded, 'condo');
});

// ---- 2. Exclusion codes

test('Spokane exclusion codes follow docs/explore-index.md section 1', () => {
  const reason = code => spokane.codeExclusion({ propUseCode: code });
  for (const c of ['14', '50']) assert.equal(reason(c), 'condo', c);
  for (const c of ['16', '21', '26', '39', '51', '53', '59', '61', '64', '66', '43', '44', '46']) assert.equal(reason(c), 'commercial_industrial', c);
  for (const c of ['41', '42', '45', '47', '48', '49']) assert.equal(reason(c), 'right_of_way', c);
  assert.equal(reason('67'), 'public_land');
  // Kept: residential, resource and undeveloped land (decided by the acreage and city rules).
  for (const c of ['11', '12', '13', '15', '17', '18', '19', '68', '72', '81', '83', '88', '91', '94', null]) assert.equal(reason(c), null, String(c));
  assert.equal(reason('9'), null, 'a one-digit code is read as 09');
});

test('public land: PAD-US Fee covering most of a parcel, or an exempt-government code with Fee land touching it', () => {
  const base = { id: 'X', codeReason: null, hasGeometry: true, acres: 20, inCity: 0, improved: 0 };
  assert.equal(decide({ ...base, publicLand: { coversMost: true, touches: true } }).reason, 'public_land');
  assert.equal(decide({ ...base, publicLand: { coversMost: false, touches: true }, publicHint: true }).reason, 'public_land');
  assert.equal(decide({ ...base, publicLand: { coversMost: false, touches: false }, publicHint: true }).reason, 'rural_acreage', 'an unconfirmed exemption code alone does not exclude');
  assert.equal(decide({ ...base, publicLand: { coversMost: false, touches: true }, publicHint: false }).reason, 'rural_acreage');
  for (const code of ['GOVT', 'WATD', 'CEM', 'govt']) assert.equal(spokane.publicHint({ exmpCode: code }), true, code);
  for (const code of ['SA', 'DOR', 'OPER', null]) assert.equal(spokane.publicHint({ exmpCode: code }), false, String(code));
});

test('no owner, taxpayer or mailing field is ever requested', () => {
  for (const fields of [spokane.ATTRIBUTE_FIELDS, spokane.OUTLINE_FIELDS, spokane.PADUS_FEE_FIELDS]) {
    assert.doesNotMatch(fields, /owner|taxpayer|mail|Own_Name|Mang_Name|\*/i, fields);
  }
});

// ---- Synthetic county layers for the stubbed fetch

const LAT = 47.8;
const square = (lon, lat, acres) => {
  const side = Math.sqrt(acres * 4046.8564224);
  const dy = side / 111320 / 2, dx = side / (111320 * Math.cos(lat * Math.PI / 180)) / 2;
  return { x0: lon - dx, x1: lon + dx, y0: lat - dy, y1: lat + dy };
};
const esriRect = ({ x0, x1, y0, y1 }) => ({ rings: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] }); // clockwise = outer
const CHENEY = { x0: -117.60, x1: -117.56, y0: 47.47, y1: 47.51 };
const FAIRCHILD = { x0: -117.68, x1: -117.62, y0: 47.60, y1: 47.64 };

// pid, assessor acres, code, exemption, improved, centre
const PARCELS = [
  ['10001.0001', 10, '91', null, 0, [-117.30, LAT]],
  ['10001.0002', 0.3, '91', null, 0, [-117.28, LAT]],
  ['10001.0003', 0.3, '11', null, 1, [-117.58, 47.49]],
  ['10001.0004', 5, '11', null, 1, [-117.585, 47.495]],
  ['10001.0005', 0.5, '91', null, 0, [-117.575, 47.485]],
  ['10001.0006', 2, '14', null, 1, [-117.26, LAT]],
  ['10001.0007', 3, '45', null, 0, [-117.24, LAT]],
  ['10001.0008', 3, '53', null, 1, [-117.22, LAT]],
  ['10001.0009', 3, '67', null, 1, [-117.20, LAT]],
  ['10001.0010', 20, '91', 'GOVT', 0, [-117.18, LAT]],
  ['10001.0011', 40, '91', null, 0, [-117.16, LAT]],
  ['10001.0012', 20, '91', 'GOVT', 0, [-117.14, LAT]],
  ['10001.0013', 3, '11', null, 1, [-117.12, LAT]],
  ['10001.0014', 2, '91', null, 0, [-117.10, LAT]], // no outline on the parcel layer
  ['10001.0015', 10, '91', null, 0, [-117.65, 47.62]] // Fairchild AFB: outside city limits
];
const EXPECTED = {
  '10001.0001': 'rural_acreage', '10001.0002': 'rural_vacant_small', '10001.0004': 'city_acreage', '10001.0012': 'rural_acreage',
  '10001.0013': 'rural_improved', '10001.0015': 'rural_acreage'
};
const box = Object.fromEntries(PARCELS.map(([pid, acres, , , , [lon, lat]]) => [pid, square(lon, lat, acres)]));
// PAD-US Fee: state land over 80% of 10001.0011 (x from its west edge), local land over 20% of 10001.0010.
const fee = (b, share, ownType) => ({ attributes: { OBJECTID: 1, Category: 'Fee', Own_Type: ownType, Unit_Nm: 'Test unit' }, geometry: esriRect({ x0: b.x0 - 0.001, x1: b.x0 + (b.x1 - b.x0) * share, y0: b.y0 - 0.001, y1: b.y1 + 0.001 }) });
const PADUS = [fee(box['10001.0011'], 0.8, 'STAT'), fee(box['10001.0010'], 0.2, 'LOC'), fee(box['10001.0012'], 1.0, 'NGO')];

let assessedExtra = {};
function attributesOf([pid, acres, code, exmp, improved]) {
  const land = 100000, assessed = (improved ? 300000 : land) + (assessedExtra[pid] || 0);
  return { PID_NUM: pid, prop_use_code: code, exmp_code: exmp, acreage: acres, land_value: land, assessed_amt: assessed, taxable_amt: assessed, asmt_year: 2027 };
}

// Stubbed county servers. Records every request body (to check the fields asked for).
function countyFetch({ failCity = false } = {}) {
  const seen = [];
  const fn = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const params = new URLSearchParams(init.body ? String(init.body) : url.search);
    seen.push({ host: url.host, path: url.pathname, outFields: params.get('outFields'), userAgent: new Headers(init.headers).get('User-Agent') });
    const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.includes('/ISDSDE/LandCapacityAnalysis/MapServer/0/query')) {
      if (params.get('returnCountOnly')) return ok({ count: PARCELS.length });
      const where = params.get('where') || '';
      const rows = PARCELS.filter(p => where === '1=1' || where.includes(`'${p[0]}'`));
      const offset = Number(params.get('resultOffset') || 0), size = Number(params.get('resultRecordCount') || 2000);
      return ok({ features: rows.slice(offset, offset + size).map(p => ({ attributes: attributesOf(p) })) });
    }
    if (url.pathname.includes('/Assessor/Parcels/MapServer/0/query')) {
      const where = params.get('where') || '';
      const rows = PARCELS.filter(p => where.includes(`'${p[0]}'`) && p[0] !== '10001.0014');
      return ok({ features: rows.map(([pid, acres]) => ({ attributes: { PID_NUM: pid, acreage: acres, site_city: 'CHENEY', site_zip: '99004', site_address: '' }, geometry: esriRect(box[pid]) })) });
    }
    if (url.pathname.includes('/SCOUT/PermittingLookup/MapServer/0/query')) {
      if (failCity) return new Response('Service Unavailable', { status: 500 });
      return ok({ features: [
        { attributes: { NAME: 'Cheney', MUNITYP: 'City' }, geometry: esriRect(CHENEY) },
        { attributes: { NAME: 'Fairchild Air Force Base', MUNITYP: 'Other' }, geometry: esriRect(FAIRCHILD) },
        { attributes: { NAME: 'Spokane County', MUNITYP: 'Other' }, geometry: esriRect({ x0: -117.9, x1: -117.0, y0: 47.2, y1: 48.1 }) }
      ] });
    }
    if (url.pathname.includes('/Protection_Mechanism_Category_PADUS/FeatureServer/0/query')) return ok({ features: PADUS });
    throw new Error(`network disabled in tests (${url.host})`);
  };
  fn.seen = seen;
  return fn;
}

// In-process report calls from the recorded fixture. parcel-search answers with the synthetic
// parcel itself; failing: paths (or 'hazards:flood') answered with HTTP 502.
function fixtureApi({ failing = [], parcelFor } = {}) {
  const calls = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    const key = body?.kind ? `${path.replace('/api/', '')}:${body.kind}` : path.replace('/api/', '');
    if (failing.includes(key)) return { ok: false, status: 502, data: { error: `${key} down (test)` } };
    if (path === '/api/parcel-search') {
      const parcel = parcelFor?.(body.parcelId);
      if (parcel) return { ok: true, status: 200, data: { available: true, state: 'WA', county: 'Spokane', parcel } };
    }
    const hit = FIXTURE.calls.find(c => c.path === path && (c.kind || null) === (body?.kind || body?.service || null));
    if (!hit) return { ok: false, status: 404, data: { error: 'not recorded' } };
    return { ok: hit.ok, status: hit.status, data: JSON.parse(JSON.stringify(hit.data)) };
  };
  api.calls = calls;
  return api;
}

const FAST = { retries: 0 };
const ISO = '2026-11-24T08:00:00.000Z';
let tick = 0;
const clock = () => new Date(Date.parse(ISO) + (tick++) * 1000).toISOString();

async function run(db, { fetchImpl = countyFetch(), api, ...rest } = {}) {
  const options = { ...parseArgs([]), db, fetchImpl, api: api || fixtureApi({ parcelFor: syntheticParcel }), assembleOptions: FAST, log: () => {}, now: clock, gitSha: 'test', cache: true, ...rest };
  return runIndex(options);
}
async function syntheticParcelAsync(pid) { return (await spokane.fetchOutlines([pid])).get(pid); }
const PARCEL_FEATURES = new Map();
function syntheticParcel(pid) { return PARCEL_FEATURES.get(pid) || null; }
async function loadParcelFeatures() {
  globalThis.fetch = countyFetch();
  for (const [pid] of PARCELS) { const f = await syntheticParcelAsync(pid); if (f) PARCEL_FEATURES.set(pid, f); }
}

// ---- 3. City-limits overlay

test('city limits: the majority of the parcel decides; Fairchild AFB and no polygon are outside', () => {
  const polygons = preparePolygons([
    { attributes: { NAME: 'Cheney', MUNITYP: 'City' }, geometry: esriRect(CHENEY) },
    { attributes: { NAME: 'Fairchild Air Force Base', MUNITYP: 'Other' }, geometry: esriRect(FAIRCHILD) }
  ]);
  const limits = { polygons };
  const at = b => parcelSamples({ type: 'Polygon', coordinates: [[[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]]] });
  const inside = spokane.cityOf(at({ x0: -117.59, x1: -117.585, y0: 47.49, y1: 47.495 }), limits);
  assert.equal(inside.inCity, 1);
  assert.equal(inside.cityName, 'City of Cheney');
  // 70% inside the city: inside.
  const mostly = spokane.cityOf(at({ x0: -117.567, x1: -117.557, y0: 47.49, y1: 47.495 }), limits);
  assert.equal(mostly.inCity, 1);
  // 30% inside: outside (unincorporated land covers more of it).
  const edge = spokane.cityOf(at({ x0: -117.557, x1: -117.547, y0: 47.49, y1: 47.495 }), limits);
  assert.equal(edge.inCity, 0);
  assert.equal(edge.cityName, null);
  assert.equal(spokane.cityOf(at({ x0: -117.66, x1: -117.64, y0: 47.61, y1: 47.62 }), limits).inCity, 0, 'Fairchild AFB is not a city');
  assert.equal(spokane.cityOf(at({ x0: -117.3, x1: -117.29, y0: 47.8, y1: 47.81 }), limits).inCity, 0);
});

// ---- 4-6. The run: rule, degraded layers, resume/skip, stored score

test('a run applies the rule with the stubbed county layers and records the run', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  const fetchImpl = countyFetch();
  const result = await run(db, { fetchImpl });
  assert.equal(result.status, 'succeeded', result.notes.join('; '));
  const rows = db.raw.prepare('SELECT parcel_id, inclusion_reason, in_city, city_name, acres, acres_source, improved FROM parcels ORDER BY parcel_id').all();
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.parcel_id, r.inclusion_reason])), EXPECTED);
  const city = rows.find(r => r.parcel_id === '10001.0004');
  assert.equal(city.in_city, 1);
  assert.equal(city.city_name, 'City of Cheney');
  assert.equal(rows.find(r => r.parcel_id === '10001.0015').in_city, 0);
  assert.equal(rows.find(r => r.parcel_id === '10001.0001').acres_source, 'assessor');
  const runRow = db.raw.prepare('SELECT * FROM index_runs').get();
  assert.equal(runRow.status, 'succeeded');
  assert.equal(runRow.min_acres, 1);
  assert.equal(runRow.pulled_count, PARCELS.length);
  assert.equal(runRow.included_count, Object.keys(EXPECTED).length);
  assert.deepEqual(JSON.parse(runRow.excluded_json), {
    condo: 1, right_of_way: 1, commercial_industrial: 1, public_land: 3, small_improved: 1, city_small: 1, no_geometry: 1
  });
  assert.equal(JSON.parse(runRow.rules_json).score_rules_version, core.SCORE_RULES_VERSION);
  // Bulk requests: named fields only, and the job's User-Agent.
  for (const r of fetchImpl.seen) {
    assert.doesNotMatch(String(r.outFields || ''), /owner|taxpayer|mail|Own_Name|\*/i, r.path);
    assert.equal(r.userAgent, USER_AGENT);
  }
  db.close();
});

test('a failed city-limits layer keeps parcels on the acreage test with in_city NULL', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  const result = await run(db, { fetchImpl: countyFetch({ failCity: true }) });
  assert.match(result.notes.join(' '), /city limits unavailable/);
  const rows = db.raw.prepare('SELECT parcel_id, inclusion_reason, in_city FROM parcels').all();
  assert.ok(rows.length >= 5);
  for (const r of rows) assert.equal(r.in_city, null, r.parcel_id);
  assert.equal(rows.find(r => r.parcel_id === '10001.0004').inclusion_reason, 'rural_improved', 'acreage test only');
  assert.equal(rows.some(r => r.parcel_id === '10001.0002'), false, 'small parcels need the city test');
  const layer = db.raw.prepare("SELECT status FROM parcel_layers WHERE layer = 'city_limits' AND parcel_id = '10001.0001'").get();
  assert.equal(layer.status, 'unavailable');
  db.close();
});

test('degraded layers: a failed layer is a NULL column and a status row, never a dropped parcel', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  const api = fixtureApi({ parcelFor: syntheticParcel, failing: ['hazards:flood', 'land-analysis'] });
  await run(db, { api });
  const row = db.getParcel('spokane', '10001.0001');
  assert.ok(row, 'parcel kept');
  assert.equal(row.flood_share_pct, null);
  assert.equal(row.flood_high, null);
  assert.equal(row.flood_zones, null);
  assert.equal(row.slope_mean_pct, null);
  assert.equal(row.septic_grade, null);
  assert.equal(row.layers_missing.split(',').sort().join(','), 'flood,land,slope');
  const layers = Object.fromEntries(db.getLayers('spokane', '10001.0001').map(l => [l.layer, l.status]));
  assert.equal(layers.flood, 'unavailable');
  assert.equal(layers.land, 'unavailable');
  assert.equal(layers.wetlands, 'ok');
  assert.equal(layers.tax, 'not_checked');
  // The score leaves the missing factors out, exactly as the report does.
  const factors = JSON.parse(row.score_factors_json);
  assert.equal(factors.flood.measured, false);
  assert.equal(factors.terrain.measured, false);
  assert.equal(factors.soil.measured, false);
  assert.equal(row.score_factors_measured, 4);
  assert.equal(row.score_rating === 'Provisional' || ['Excellent', 'Good', 'Moderate', 'Challenging'].includes(row.score_rating), true);
  const runRow = db.raw.prepare('SELECT partial_count, layer_failures_json FROM index_runs').get();
  assert.equal(runRow.partial_count, Object.keys(EXPECTED).length);
  assert.equal(JSON.parse(runRow.layer_failures_json).flood, Object.keys(EXPECTED).length);
  db.close();
});

test('every report layer down: the parcel is still stored, Not scored, with each layer flagged', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  const all = ['arcgis', 'utility-territory', 'hazards:flood', 'hazards:wetlands', 'zoning-permits', 'land-analysis', 'public-utilities', 'well-depth-terrain', 'cost-context'];
  await run(db, { api: fixtureApi({ parcelFor: syntheticParcel, failing: all }) });
  const row = db.getParcel('spokane', '10001.0013');
  assert.equal(row.score, null);
  assert.equal(row.score_rating, 'Not scored');
  assert.equal(row.score_factors_measured, 0);
  for (const key of ['flood', 'wetlands', 'land', 'slope', 'zoning', 'wells', 'utility', 'public_utilities']) assert.ok(row.layers_missing.split(',').includes(key), key);
  db.close();
});

test('resume: a second run skips current parcels; a changed source, score version or failed layer is redone', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  await run(db);
  const firstWrites = { ...db.writes };
  assert.equal(firstWrites.parcels, Object.keys(EXPECTED).length);

  const api = fixtureApi({ parcelFor: syntheticParcel });
  const second = await run(db, { api });
  assert.equal(second.stats.skipped, Object.keys(EXPECTED).length);
  assert.equal(second.stats.scored, 0);
  assert.equal(api.calls.length, 0, 'no in-process calls for current parcels');
  assert.deepEqual(second.stats.plans, { 'skip:current': Object.keys(EXPECTED).length });

  // Assessor value changed -> source hash differs -> that parcel only is scored again.
  assessedExtra = { '10001.0013': 5000 };
  try {
    const third = await run(db);
    assert.equal(third.stats.plans['score:source_changed'], 1);
    assert.equal(third.stats.scored, 1);
  } finally { assessedExtra = {}; }
  // Same values again: unchanged layer rows are not rewritten.
  const before = { ...db.writes };
  const fourth = await run(db);
  assert.equal(fourth.stats.plans['score:source_changed'], 1);
  assert.ok(db.writes.layersUnchanged > before.layersUnchanged, 'unchanged layer rows skipped by the change hash');

  // Score rules newer than the stored score: rescored from the stored inputs, no network.
  db.raw.prepare("UPDATE parcels SET score_version = '0', score = 1 WHERE parcel_id = '10001.0001'").run();
  const api5 = fixtureApi({ parcelFor: syntheticParcel });
  const fifth = await run(db, { api: api5 });
  assert.equal(fifth.stats.rescored, 1);
  assert.equal(api5.calls.length, 0);
  const rescored = db.getParcel('spokane', '10001.0001');
  assert.equal(rescored.score_version, String(core.SCORE_RULES_VERSION));
  assert.notEqual(rescored.score, 1);

  // A parcel with a missing layer is asked again on the next run.
  db.raw.prepare("UPDATE parcels SET layers_missing = 'flood' WHERE parcel_id = '10001.0002'").run();
  const sixth = await run(db);
  assert.equal(sixth.stats.plans['score:layer_retry'], 1);
  db.close();
});

test('removal: a parcel gone from the pull is marked removed, but never after a short pull', async () => {
  await loadParcelFeatures();
  const db = openIndexDb(':memory:');
  await run(db);
  const saved = PARCELS.splice(PARCELS.findIndex(p => p[0] === '10001.0013'), 1);
  try {
    const second = await run(db);
    assert.equal(second.stats.removed, 1);
    assert.equal(db.getParcel('spokane', '10001.0013').index_status, 'removed');
    assert.equal(db.getParcel('spokane', '10001.0001').index_status, 'active');
  } finally { PARCELS.push(...saved); }
  // A pull with under 90% of the previous count marks nothing.
  const kept = PARCELS.splice(0, 4);
  try {
    const third = await run(db);
    assert.equal(third.stats.removed, 0);
    assert.match(third.notes.join(' '), /nothing marked removed/);
    assert.equal(db.getParcel('spokane', '10001.0002').index_status, 'active');
  } finally { PARCELS.unshift(...kept); }
  db.close();
});

test('plan(): the refresh order', () => {
  const base = { source_hash: 'h', score_version: '1', scored_at: ISO, layers_missing: null, index_status: 'active', inclusion_reason: 'rural_acreage' };
  const opts = { sourceHash: 'h', inputsVersion: 'v', scoreVersion: '1', now: ISO };
  assert.equal(plan(null, null, opts).why, 'new');
  assert.equal(plan(base, { inputs_version: 'v' }, opts).action, 'skip');
  assert.equal(plan(base, { inputs_version: 'v' }, { ...opts, force: true }).why, 'forced');
  assert.equal(plan({ ...base, source_hash: 'x' }, { inputs_version: 'v' }, opts).why, 'source_changed');
  assert.equal(plan(base, { inputs_version: 'old' }, opts).why, 'rules_version');
  assert.equal(plan({ ...base, layers_missing: 'flood' }, { inputs_version: 'v' }, opts).why, 'layer_retry');
  assert.equal(plan({ ...base, scored_at: '2026-01-01T00:00:00Z' }, { inputs_version: 'v' }, opts).why, 'age');
  assert.deepEqual(plan({ ...base, score_version: '0' }, { inputs_version: 'v' }, opts), { action: 'rescore', why: 'score_version' });
  assert.equal(plan({ ...base, index_status: 'removed' }, { inputs_version: 'v' }, opts).why, 'reactivated');
});

test('the stored score is score-core.js\'s score for the recorded Spokane parcel', async () => {
  const parcel = FIXTURE.calls.find(c => c.path === '/api/parcel-search').data.parcel;
  const row = spokane.attributeRow({ PID_NUM: '23123.9051', prop_use_code: '91', acreage: 20.48, land_value: 100000, assessed_amt: 100000, taxable_amt: 100000, asmt_year: 2027 });
  const cand = { pid: '23123.9051', row, bulk: parcel, reason: 'rural_acreage', inCity: 0, cityName: null, acres: 20.48, sourceHash: 'h', cityLayer: { status: 'ok' } };
  const out = await scoreParcel(cand, { api: fixtureApi(), where: spokane.WHERE, county: 'spokane', state: 'WA', labels: spokane.LABELS, now: ISO, runId: 'r', inputsVersion: 'v', assembleOptions: FAST });
  const expected = core.calculate(out.last, { sectionStatus: name => out.sections[name] });
  assert.equal(typeof expected.score, 'number');
  assert.equal(out.row.score, expected.score);
  assert.equal(out.row.score_rating, expected.rating);
  assert.equal(out.row.score_factors_measured, expected.completeness.measured);
  assert.equal(out.row.score_why, expected.why);
  assert.deepEqual(JSON.parse(out.row.score_factors_json), JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(expected.factors).map(([k, f]) => [k, { score: f.score, measured: f.measured }])))));
  assert.equal(out.inputsMatch, true);

  // Written and read back.
  const db = openIndexDb(':memory:');
  db.writeParcel({ row: out.row, layers: out.layers, shape: out.shape, inputs: out.inputs, inputsVersion: 'v', now: ISO, runId: 'r' });
  const stored = db.getParcel('spokane', '23123.9051');
  assert.equal(stored.score, expected.score);
  // The trimmed inputs re-score to the same number without the network.
  const again = rehydrateInputs(JSON.parse(db.getInputs('spokane', '23123.9051').inputs_json));
  assert.equal(core.calculate(again.last, { sectionStatus: n => again.sections[n] }).score, expected.score);
  assert.equal(scoreOf(again.last, again.sections).score, expected.score);
  // The trimmed inputs hold no well project names or addresses.
  assert.doesNotMatch(db.getInputs('spokane', '23123.9051').inputs_json, /ProjectName"\s*:\s*"(?!irrigat|agricultur|industrial|monitor|observation|injection|dewater|geothermal|environmental|remediation|municipal)/i);
  // Columns from the recorded answers.
  assert.equal(stored.zoning_code, 'RT');
  assert.equal(stored.zoning_status, 'gis_match');
  assert.equal(stored.flood_zones.split(',')[0], 'A');
  assert.equal(stored.flood_high, 1);
  assert.ok(stored.flood_share_pct > 0 && stored.flood_share_pct < 100);
  assert.ok(stored.buildable_acres > 0 && stored.buildable_acres < 20.48);
  assert.equal(stored.home_allowed, 1);
  assert.equal(stored.home_allowed_status, 'permitted');
  assert.equal(stored.slope_median_pct, null, 'R7 not done: no median yet');
  const shape = JSON.parse(db.raw.prepare('SELECT geojson FROM parcel_shapes').get().geojson);
  assert.ok(['Polygon', 'MultiPolygon'].includes(shape.type));
  db.close();
});

test('zoning use flags: permitted / not permitted / not mapped', () => {
  const zdp = { available: true, uses: [{ label: 'Single-family dwelling', status: 'permitted' }, { label: 'Manufactured home', status: 'not_permitted' }, { label: 'Manufactured home park', status: 'permitted' }] };
  assert.deepEqual(useFlag(zdp, SINGLE_FAMILY_USE), { allowed: 1, status: 'permitted' });
  assert.deepEqual(useFlag(zdp, MANUFACTURED_HOME_USE), { allowed: 0, status: 'not_permitted' }, 'the park is not the home');
  assert.deepEqual(useFlag({ available: true, uses: [{ label: 'Manufactured home park', status: 'permitted' }] }, MANUFACTURED_HOME_USE), { allowed: null, status: 'not_mapped' });
  assert.deepEqual(useFlag({ available: false, status: 'zone_not_mapped' }, SINGLE_FAMILY_USE), { allowed: null, status: 'not_mapped' });
  assert.deepEqual(useFlag({ available: true, uses: [{ label: 'Single-family dwelling', status: 'conditional' }] }, SINGLE_FAMILY_USE), { allowed: null, status: 'conditional' });
});

// ---- Runtime and parity helpers

test('the fetch wrapper adds the polite User-Agent, counts per parcel and waits out a 429', async () => {
  const sent = [];
  let first = true;
  const inner = async (input, init) => {
    sent.push(new Headers(init.headers).get('User-Agent'));
    if (first) { first = false; return new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }); }
    return new Response('{}', { status: 200 });
  };
  const fetch = politeFetch(inner, { backoff: () => 0 });
  const counter = newCounter();
  const response = await requestScope.run(counter, () => fetch('https://example.test/a', {}));
  assert.equal(response.status, 200);
  assert.equal(counter.requests, 2);
  assert.equal(counter.rateLimited, 1);
  assert.deepEqual(counter.byHost, { 'example.test': 2 });
  assert.deepEqual(sent, [USER_AGENT, USER_AGENT]);
  assert.doesNotMatch(USER_AGENT, /@|https?:/, 'no email or personal link');
  await fetch('https://example.test/b', { headers: { 'User-Agent': 'AcresX/0.5.2' } });
  assert.equal(sent.at(-1), 'AcresX/0.5.2', 'a handler\'s own User-Agent is kept');
  assert.equal(fetch.counter.requests, 1, 'outside a parcel scope: the bulk counter');
});

test('the in-memory Cache API keeps cacheable answers only', async () => {
  const cache = new MemoryCache(2);
  await cache.put('https://x/1', new Response('a', { headers: { 'Cache-Control': 'public, max-age=60' } }));
  await cache.put('https://x/2', new Response('b', { headers: { 'Cache-Control': 'no-store' } }));
  assert.equal(await (await cache.match('https://x/1')).text(), 'a');
  assert.equal(await cache.match('https://x/2'), undefined);
  await cache.put('https://x/3', new Response('c', { headers: { 'Cache-Control': 's-maxage=60' } }));
  await cache.put('https://x/4', new Response('d', { headers: { 'Cache-Control': 's-maxage=60' } }));
  assert.equal(await cache.match('https://x/1'), undefined, 'least recently used first out');
});
