// Offline tests for scripts/validate-county.mjs. fetch is stubbed; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAYERS, assertReadOnly, classifyResponse, interpretLayer, centroid, validateParcel, validateCounty,
  compareExpected, applyExpected, buildMarkdown, summarize, buildDiscoveryStrata, pickVaried, discoverParcels, parseArgs
} from '../scripts/validate-county.mjs';

const BASE = 'https://acresx.test';
const square = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };

// Canned answers for each route, shaped like the real Worker responses.
function happyResponses() {
  return {
    '/api/parcel-search': { available: true, state: 'ID', county: 'Kootenai', parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: 'TESTPIN1', PARCEL_ID_NR: 'TESTPIN1', COUNTY_NM: 'Kootenai', _countyDisplay: 'Kootenai', SITUS_ADDRESS: '1 Test Rd', SITUS_CITY_NM: 'Athol', ACRES: 10 } } },
    '/api/well-search': { available: true, state: 'ID', wells: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-116.795, 47.705] }, properties: { CompletedDepth: 220 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-116.7, 47.7] }, properties: { CompletedDepth: 0 } }
    ] },
    '/api/utility-territory': { available: true, providers: ['Kootenai Electric Cooperative'] },
    'flood': { available: true, intersects: false, high: false, zones: [] },
    'wetlands': { available: true, intersects: true, count: 2, types: ['PEM'], coveragePct: 3.21 },
    '/api/zoning-permits': { available: true, county: 'Kootenai', jurisdiction: 'Kootenai County', countyStatus: 'kootenai-data-layers-v3', zoning: { status: 'gis_match', code: 'Rural', name: 'Rural' }, allowedBuildings: { status: 'mapped_from_county_code' }, permitHistoryStatus: 'unavailable', urbanGrowthArea: { intersects: false } },
    '/api/land-analysis': { available: true, soil: { available: true, feasibility: 'favorable', mapUnit: 'Rathdrum silt loam', hydrologicGroup: 'B' }, terrain: { available: true, gradePct: 4.27, maxGradePct: 9.1, reliefFt: 40 } },
    '/api/existing-well': { available: false, status: 'not_supported', label: 'Existing-well matching is not configured for this county yet.' },
    '/api/property-assessment': { available: true, state: 'ID', statewideSource: 'Idaho Statewide Standardized Parcel Layer', statewideRecords: [{ VAL_TOTAL: 350000, VAL_LAND: 150000, VAL_IMPVTS: 200000 }] },
    '/api/reso-listings': { available: true, configured: true, matchCount: 0, best: null, matchConfidence: 'none' },
    '/api/power-intelligence': { available: true, provider: 'Kootenai Electric Cooperative', distribution: { estimatedDistanceFt: 410.4, confidence: 'moderate', status: 'osm_mapped_proximity' } },
    '/api/zoning-rules': { available: true, county: 'Kootenai', code: 'R', family: 'Rural', uses: [{}, {}, {}] },
    '/api/slope-grid': { available: true, cells: [{ gradePct: 2 }, { gradePct: 6 }], partial: false }
  };
}

let calls;
function stubFetch(responses, overrides = {}) {
  calls = [];
  return async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, route, body, method: init.method || 'GET' });
    const key = route === '/api/hazards' ? body.kind : route;
    if (overrides[key]) return overrides[key]();
    if (!(key in responses)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const run = (entry = { parcelId: 'TESTPIN1' }) => validateParcel(entry, { state: 'ID', county: 'Kootenai', baseUrl: BASE, requestDelayMs: 0 });

test('every layer is ok when the API returns usable data', async () => {
  const responses = happyResponses();
  responses['/api/existing-well'] = { available: true, status: 'no_match', label: 'No existing well match found', confidence: 'Low' };
  responses['/api/reso-listings'] = { available: true, configured: true, matchCount: 1, best: { status: 'Active' }, matchConfidence: 'high' };
  globalThis.fetch = stubFetch(responses);
  const result = await run();
  for (const { key } of LAYERS) assert.equal(result.layers[key].status, 'ok', `${key}: ${result.layers[key].detail}`);
  assert.equal(result.layers.zoning.values.code, 'Rural');
  assert.equal(result.layers.flood.values.high, false);
  assert.equal(result.layers.wells.values.nearestDepthsCount, 1);
  assert.equal(result.layers.soil.values.feasibility, 'favorable');
  assert.equal(result.layers.terrain.values.gradePct, 4.3);
  assert.equal(result.layers.assessment.values.assessedValue, 350000);
  assert.equal(result.layers.assessment.values.taxPresent, false);
  assert.deepEqual(result.layers.utility.values.providers, ['Kootenai Electric Cooperative']);
});

test('browser request sequence and bodies are mirrored', async () => {
  globalThis.fetch = stubFetch(happyResponses());
  await run();
  const c = centroid(square);
  const byRoute = route => calls.filter(x => x.route === route).map(x => x.body);
  assert.deepEqual(calls.map(x => x.route === '/api/hazards' ? `hazards:${x.body.kind}` : x.route), [
    '/api/parcel-search', '/api/well-search', '/api/utility-territory', 'hazards:flood', 'hazards:wetlands',
    '/api/zoning-permits', '/api/land-analysis', '/api/existing-well', '/api/property-assessment',
    '/api/reso-listings', '/api/power-intelligence', '/api/zoning-rules', '/api/slope-grid'
  ]);
  assert.ok(calls.every(x => x.method === 'POST' && x.url.startsWith(BASE)));
  assert.deepEqual(byRoute('/api/parcel-search')[0], { state: 'ID', county: 'Kootenai', parcelId: 'TESTPIN1' });
  assert.deepEqual(byRoute('/api/well-search')[0], { state: 'ID', county: 'Kootenai', lat: c.lat, lon: c.lon });
  const zoning = byRoute('/api/zoning-permits')[0];
  assert.equal(zoning.county, 'Kootenai'); assert.equal(zoning.parcelId, 'TESTPIN1'); assert.deepEqual(zoning.geometry, square);
  assert.deepEqual(byRoute('/api/zoning-rules')[0], { county: 'Kootenai', zoneCode: 'Rural', zoneName: 'Rural', jurisdiction: 'Kootenai County', uga: false, developmentAgreement: '' });
  assert.deepEqual(byRoute('/api/power-intelligence')[0].providers, ['Kootenai Electric Cooperative']);
});

test('centroid skips the closing vertex like turf.centroid', () => {
  const c = centroid(square);
  assert.ok(Math.abs(c.lon - -116.795) < 1e-9 && Math.abs(c.lat - 47.705) < 1e-9);
});

test('reso-listings is never called with sync options', async () => {
  globalThis.fetch = stubFetch(happyResponses());
  await validateCounty({ county: 'Kootenai', state: 'ID' }, { parcels: [{ parcelId: 'A' }, { parcelId: 'B' }], baseUrl: BASE, delayMs: 0, requestDelayMs: 0 });
  const reso = calls.filter(x => x.route === '/api/reso-listings');
  assert.equal(reso.length, 2);
  for (const { body } of reso) { assert.equal('sync' in body, false); assert.equal('incremental' in body, false); assert.equal('cursor' in body, false); }
  assert.ok(!calls.some(x => x.route === '/api/property-tax-test' || x.route === '/api/listing-evidence'));
  assert.throws(() => assertReadOnly('/api/reso-listings', { sync: true }), /live MLS database/);
  assert.throws(() => assertReadOnly('/api/property-tax-test', {}), /allowlist/);
  assert.throws(() => assertReadOnly('/api/listing-evidence', {}), /allowlist/);
});

test('clean "not available" answers are unavailable, and the browser-skipped calls are not made', async () => {
  const responses = happyResponses();
  responses['/api/utility-territory'] = { available: true, providers: [], note: 'No mapped retail electric service territory intersected the parcel center.' };
  responses['/api/zoning-permits'] = { available: false, county: 'Kootenai', jurisdiction: 'Kootenai County', zoning: { status: 'no_mapped_result', label: 'No mapped zoning result found' }, permits: [] };
  responses['/api/reso-listings'] = { available: false, configured: false, status: 'not_configured' };
  globalThis.fetch = stubFetch(responses);
  const result = await run();
  assert.equal(result.layers.utility.status, 'unavailable');
  assert.equal(result.layers.zoning.status, 'unavailable');
  assert.equal(result.layers.zoning.values.jurisdiction, 'Kootenai County');
  assert.equal(result.layers.existingWell.status, 'unavailable');
  assert.equal(result.layers.listing.status, 'unavailable');
  assert.equal(result.layers.power.status, 'unavailable');
  assert.match(result.layers.power.detail, /not requested/);
  assert.equal(result.layers.zoningRules.status, 'unavailable');
  assert.ok(!calls.some(x => x.route === '/api/power-intelligence' || x.route === '/api/zoning-rules'));
});

test('HTTP errors, invalid JSON, timeouts and error fields are errors', async () => {
  const responses = happyResponses();
  responses['/api/utility-territory'] = { available: false, error: 'Utility territory service returned 503' };
  responses['/api/land-analysis'] = { available: true, soil: { available: false, error: 'Soil data unavailable' }, terrain: { available: true, gradePct: 3 } };
  globalThis.fetch = stubFetch(responses, {
    flood: () => new Response('<html>Bad gateway</html>', { status: 200 }),
    wetlands: () => new Response(JSON.stringify({ error: 'NWI down' }), { status: 502 }),
    '/api/well-search': () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
  });
  const result = await run();
  assert.equal(result.layers.utility.status, 'error');
  assert.match(result.layers.utility.detail, /503/);
  assert.equal(result.layers.flood.status, 'error');
  assert.match(result.layers.flood.detail, /invalid JSON/);
  assert.equal(result.layers.wetlands.status, 'error');
  assert.match(result.layers.wetlands.detail, /HTTP 502: NWI down/);
  assert.equal(result.layers.wells.status, 'error');
  assert.match(result.layers.wells.detail, /timeout/);
  assert.equal(result.layers.soil.status, 'error');
  assert.equal(result.layers.terrain.status, 'ok');
});

test('a failed parcel lookup marks the other layers skipped and makes no further calls', async () => {
  globalThis.fetch = stubFetch({}, { '/api/parcel-search': () => new Response(JSON.stringify({ error: 'Parcel not found in available Idaho parcel sources.' }), { status: 502 }) });
  const result = await run();
  assert.equal(result.layers.parcel.status, 'error');
  assert.equal(calls.length, 1);
  for (const { key } of LAYERS.slice(1)) assert.equal(result.layers[key].status, 'skipped');
  assert.equal(summarize([result]).failed, 1);
});

test('classifyResponse leaves clean responses to the layer interpreter', () => {
  assert.equal(classifyResponse({ ok: true, httpStatus: 200, data: { available: false } }), null);
  assert.equal(classifyResponse({ ok: true, httpStatus: 200, data: [] }).status, 'error');
  assert.equal(interpretLayer('flood', { ok: true, httpStatus: 200, data: { available: true, high: true, zones: ['AE'] } }).values.high, true);
});

test('expected values: matches, mismatches and ranges', async () => {
  globalThis.fetch = stubFetch(happyResponses());
  const result = await run();
  const expected = {
    'zoning.code': 'rural', 'flood.high': false, 'utility.providers': 'Kootenai Electric Cooperative', 'terrain.gradePct': { max: 10 }, soil: 'ok',
    'zoning.jurisdiction': 'City of Athol', 'wetlands.intersects': false, 'assessment.assessedValue': { min: 400000 }, 'nope.field': 1
  };
  const mismatches = compareExpected(expected, result.layers);
  assert.deepEqual(mismatches.map(m => m.key).sort(), ['assessment.assessedValue', 'nope.field', 'wetlands.intersects', 'zoning.jurisdiction']);
  applyExpected(result, expected);
  assert.equal(result.layers.zoning.mismatches.length, 1);
  const summary = summarize([result]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.layerCounts.mismatch, 3);
});

test('markdown has a parcels x layers table and per-parcel details', async () => {
  globalThis.fetch = stubFetch(happyResponses());
  const report = await validateCounty({ county: 'Kootenai', state: 'ID' }, {
    parcels: [{ parcelId: 'TESTPIN1', label: 'rural | sample', why: 'test', expected: { 'zoning.code': 'AG' } }], baseUrl: BASE, delayMs: 0, requestDelayMs: 0
  });
  const md = buildMarkdown(report);
  const lines = md.split('\n');
  const header = lines.find(l => l.startsWith('| Parcel |'));
  assert.equal(header, `| Parcel | ${LAYERS.map(l => l.label).join(' | ')} |`);
  const row = lines.find(l => l.startsWith('| TESTPIN1 |'));
  const cells = row.split(' | ').map(s => s.replace(/^\| |\s?\|$/g, ''));
  assert.equal(cells.length, LAYERS.length + 1);
  assert.equal(cells[LAYERS.findIndex(l => l.key === 'zoning') + 1], 'mismatch');
  assert.equal(cells[1], 'ok');
  assert.match(md, /### TESTPIN1 \(rural \\\| sample\)/);
  assert.match(md, /mismatch `zoning.code`: expected AG, got Rural/);
  assert.match(md, /with an error or mismatch: 1/);
  assert.match(buildMarkdown({ ...report, results: [], summary: summarize([]) }), /No parcels to validate/);
});

test('discovery builds strata from county config and picks a varied sample', async () => {
  const config = JSON.parse(readFileSync(new URL('../validation/counties/kootenai.json', import.meta.url), 'utf8'));
  const strata = buildDiscoveryStrata(config.discover);
  assert.equal(strata.length, config.discover.acreBands.length * 2);
  assert.match(strata[0].where, /UPPER\(Loc_City\) IN \(.*'COEUR D''ALENE'/);
  assert.match(strata[1].where, /Loc_City IS NULL OR UPPER\(Loc_City\) NOT IN/);

  const zones = ['AG', 'Rural', 'Suburban', 'Commercial'];
  const cities = ['Coeur d\'Alene', 'Post Falls', null, 'Athol'];
  calls = [];
  globalThis.fetch = async url => {
    const u = new URL(url); calls.push(u);
    assert.equal(u.origin + u.pathname, `${config.discover.layerUrl}/query`);
    const p = u.searchParams;
    if (p.get('returnCountOnly')) return new Response(JSON.stringify({ count: 500 }));
    if (p.get('returnDistinctValues')) return new Response(JSON.stringify({ features: [...zones, 'Mining'].map(ZONING => ({ attributes: { ZONING } })) }));
    const where = p.get('where');
    const n = calls.length;
    const features = Array.from({ length: 4 }, (_, i) => ({ attributes: { PIN: `P${n}-${i}`, Acres: 2 + i, ZONING: /Mining/.test(where) ? 'Mining' : zones[i], Loc_City: cities[i] } }));
    return new Response(JSON.stringify({ features }));
  };
  const picked = await discoverParcels({ ...config, discover: { ...config.discover, delayMs: 0 } }, { count: 10, seed: 7 });
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked.map(p => p.parcelId)).size, 10);
  assert.ok(picked.some(p => p.countyAttributes.zoning === 'Mining'), 'zoning missed by strata should be sampled');
  assert.equal(new Set(picked.slice(0, 8).map(p => p.countyAttributes.stratum)).size, 8, 'first picks cover each stratum');
  for (const p of picked) { assert.ok(p.label && p.why); assert.deepEqual(p.expected, {}); }
  assert.ok(calls.every(u => !u.searchParams.has('sync')));
});

test('pickVaried is deterministic for a seed and parseArgs validates input', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ parcelId: `X${i}`, zoning: `Z${i % 5}`, city: `C${i % 3}`, stratum: `S${i % 4}` }));
  assert.deepEqual(pickVaried(candidates, 6, 3), pickVaried(candidates, 6, 3));
  assert.equal(new Set(pickVaried(candidates, 5, 3).map(p => p.countyAttributes.zoning)).size, 5);
  assert.deepEqual(parseArgs(['--county', 'kootenai', '--discover', '--count', '4']).count, 4);
  assert.throws(() => parseArgs(['--county', '../etc']), /--county/);
  assert.throws(() => parseArgs(['--county', 'kootenai', '--bogus']), /Unknown argument/);
});
