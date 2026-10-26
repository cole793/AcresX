// Offline tests for scripts/validate-county.mjs. fetch is stubbed; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAYERS, assertReadOnly, postJson, MAX_PER_QUERY, classifyResponse, interpretLayer, centroid, validateParcel, validateCounty,
  compareExpected, applyExpected, buildMarkdown, summarize, buildDiscoveryStrata, pickVaried, discoverParcels, parseArgs,
  arcgisGet, probeLayer, resolveDiscoverFields, MAX_FIELD_NAMES_SHOWN
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

const kootenaiFields = ['OBJECTID', 'PIN', 'Acres', 'ZONING', 'Loc_City', 'Loc_Addr'].map(name => ({ name }));

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
  for (const { body } of reso) assert.deepEqual(Object.keys(body).filter(k => !['parcelId', 'address', 'lat', 'lon'].includes(k)), []);
  assert.throws(() => assertReadOnly('/api/property-tax-test', {}), /allowlist/);
  assert.throws(() => assertReadOnly('/api/listing-evidence', {}), /allowlist/);
});

test('reso-listings guard allows only lookup keys', async () => {
  assert.doesNotThrow(() => assertReadOnly('/api/reso-listings', { parcelId: 'A', address: '1 Test Rd', lat: 47.7, lon: -116.8 }));
  assert.doesNotThrow(() => assertReadOnly('/api/reso-listings', {}));
  // Known sync options and any key not on the allowlist are refused.
  for (const body of [{ sync: true }, { parcelId: 'A', cursor: 'x' }, { incremental: true }, { parcelId: 'A', maxPages: 5 }, { parcelId: 'A', mode: 'sync' }, { since: '2026-01-01' }]) {
    assert.throws(() => assertReadOnly('/api/reso-listings', body), /only parcelId, address, lat, lon are allowed/, JSON.stringify(body));
  }
  // The guard runs before any request leaves the script.
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return new Response('{}'); };
  await assert.rejects(postJson(BASE, '/api/reso-listings', { parcelId: 'A', pageSize: 100 }, { fetchImpl }), /pageSize/);
  assert.equal(fetched, 0);
  await postJson(BASE, '/api/reso-listings', { parcelId: 'A' }, { fetchImpl });
  assert.equal(fetched, 1);
});

test('existing-well is not requested without a parcel number, like public/existing-well.js', async () => {
  const responses = happyResponses();
  const props = responses['/api/parcel-search'].parcel.properties;
  delete props.ORIG_PARCEL_ID; delete props.PARCEL_ID_NR;
  globalThis.fetch = stubFetch(responses);
  const result = await run();
  assert.equal(result.layers.parcel.status, 'ok');
  assert.equal(result.layers.existingWell.status, 'unavailable');
  assert.match(result.layers.existingWell.detail, /^not requested: parcel has no parcel number/);
  assert.ok(!calls.some(x => x.route === '/api/existing-well'));
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
    if (u.origin + u.pathname === config.discover.layerUrl) return new Response(JSON.stringify({ fields: kootenaiFields }));
    assert.equal(u.origin + u.pathname, `${config.discover.layerUrl}/query`);
    const p = u.searchParams;
    if (p.get('returnCountOnly')) return new Response(JSON.stringify({ count: 500 }));
    if (p.get('returnDistinctValues')) return new Response(JSON.stringify({ features: [...zones, 'Mining'].map(ZONING => ({ attributes: { ZONING } })) }));
    const where = p.get('where');
    const n = calls.length;
    const features = Array.from({ length: 4 }, (_, i) => ({ attributes: { PIN: `P${n}-${i}`, Acres: 2 + i, ZONING: /Mining/.test(where) ? 'Mining' : zones[i], Loc_City: cities[i] } }));
    return new Response(JSON.stringify({ features }));
  };
  // The Kootenai layer has no ZONING field; this exercises the zoning path with one configured.
  const { parcels: picked, diagnostics } = await discoverParcels({ ...config, discover: { ...config.discover, zoningField: 'ZONING', delayMs: 0 } }, { count: 10, seed: 7 });
  assert.equal(diagnostics.length, calls.length, 'one diagnostic per request');
  assert.equal(diagnostics[0].step, 'probe layer metadata');
  assert.equal(diagnostics[0].url, `${config.discover.layerUrl}?f=json`);
  assert.deepEqual(diagnostics[0].missingFields, []);
  assert.ok(diagnostics.every(x => x.ok && x.httpStatus === 200 && x.error === null && Number.isFinite(x.ms)));
  assert.ok(diagnostics.some(x => x.step === 'distinct-zoning' && x.featureCount === 5));
  assert.ok(diagnostics.some(x => /\(count\)$/.test(x.step) && x.featureCount === 500));
  assert.ok(diagnostics.some(x => /\(sample/.test(x.step) && x.featureCount === 4 && x.url.startsWith(`${config.discover.layerUrl}/query?f=json`)));
  assert.ok(diagnostics.some(x => x.step === 'zoning Mining' && x.featureCount === 4));
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked.map(p => p.parcelId)).size, 10);
  assert.ok(picked.some(p => p.countyAttributes.zoning === 'Mining'), 'zoning missed by strata should be sampled');
  assert.equal(new Set(picked.slice(0, 8).map(p => p.countyAttributes.stratum)).size, 8, 'first picks cover each stratum');
  for (const p of picked) { assert.ok(p.label && p.why); assert.deepEqual(p.expected, {}); }
  assert.ok(calls.every(u => !u.searchParams.has('sync')));
  const distinct = calls.find(u => u.searchParams.get('returnDistinctValues'));
  assert.equal(distinct.searchParams.get('resultRecordCount'), '200');
});

test('discovery caps perQuery and pauses between count and sample queries', async () => {
  const config = JSON.parse(readFileSync(new URL('../validation/counties/kootenai.json', import.meta.url), 'utf8'));
  const log = [];
  globalThis.fetch = async url => {
    const u = new URL(url), p = u.searchParams;
    if (!u.pathname.endsWith('/query')) return new Response(JSON.stringify({ fields: kootenaiFields }));
    const kind = p.get('returnCountOnly') ? 'count' : p.get('returnDistinctValues') ? 'distinct' : 'sample';
    log.push({ kind, at: performance.now(), records: p.get('resultRecordCount') });
    if (kind === 'count') return new Response(JSON.stringify({ count: 100000 }));
    if (kind === 'distinct') return new Response(JSON.stringify({ features: [] }));
    return new Response(JSON.stringify({ features: [{ attributes: { PIN: `P${log.length}`, Acres: 3, ZONING: 'Rural', Loc_City: 'Athol' } }] }));
  };
  await discoverParcels({ ...config, discover: { ...config.discover, perQuery: 5000, delayMs: 30 } }, { count: 2, seed: 1 });
  const samples = log.filter(x => x.kind === 'sample');
  assert.equal(samples.length, config.discover.acreBands.length * 2);
  assert.equal(MAX_PER_QUERY, 200);
  for (const s of samples) assert.equal(s.records, '200');
  for (const [i, entry] of log.entries()) {
    if (entry.kind !== 'sample') continue;
    assert.equal(log[i - 1].kind, 'count');
    assert.ok(entry.at - log[i - 1].at >= 25, `sample query came ${Math.round(entry.at - log[i - 1].at)} ms after its count query`);
  }
});

test('pickVaried is deterministic for a seed and parseArgs validates input', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ parcelId: `X${i}`, zoning: `Z${i % 5}`, city: `C${i % 3}`, stratum: `S${i % 4}` }));
  assert.deepEqual(pickVaried(candidates, 6, 3), pickVaried(candidates, 6, 3));
  assert.equal(new Set(pickVaried(candidates, 5, 3).map(p => p.countyAttributes.zoning)).size, 5);
  assert.deepEqual(parseArgs(['--county', 'kootenai', '--discover', '--count', '4']).count, 4);
  assert.throws(() => parseArgs(['--county', '../etc']), /--county/);
  assert.throws(() => parseArgs(['--county', 'kootenai', '--bogus']), /Unknown argument/);
});

const tinyDiscover = { county: 'Testco', state: 'ID', discover: {
  layerUrl: 'https://gis.test/arcgis/rest/services/Parcels/MapServer/0', idField: 'PIN', acresField: 'Acres', zoningField: 'ZONING',
  cityField: 'Loc_City', addressField: 'Loc_Addr', cities: ['Athol'], acreBands: [{ label: 'any' }], perQuery: 5, delayMs: 0
} };

test('discovery diagnostics record HTTP 403 HTML, ArcGIS JSON errors and network errors', async () => {
  const html = '<html>\n  <head><title>403 Forbidden</title></head>\n  <body>   Access denied by WAF   </body>\n</html>' + 'x'.repeat(400);
  const fetchImpl = async url => {
    const u = new URL(url), p = u.searchParams;
    if (!u.pathname.endsWith('/query')) return new Response(JSON.stringify({ fields: kootenaiFields }), { headers: { 'Content-Type': 'application/json' } });
    if (p.get('returnCountOnly')) return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (p.get('returnDistinctValues')) {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND gis.test'), { code: 'ENOTFOUND' });
      throw new TypeError('fetch failed', { cause });
    }
    return new Response(JSON.stringify({ error: { code: 400, message: 'Unable to complete operation.', details: ["'where' parameter is invalid"] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { parcels, diagnostics } = await discoverParcels(tinyDiscover, { count: 3, fetchImpl });
  assert.deepEqual(parcels, []);
  assert.deepEqual(diagnostics.map(x => x.step), ['probe layer metadata', 'any | city-named locality (count)', 'any | city-named locality (sample)', 'any | other/blank locality (count)', 'any | other/blank locality (sample)', 'distinct-zoning']);
  assert.equal(diagnostics[0].ok, true);
  assert.equal(diagnostics[0].contentType, 'application/json');

  const forbidden = diagnostics[1];
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.httpStatus, 403);
  assert.match(forbidden.error, /HTTP 403, content-type text\/html; charset=utf-8, body: <html> <head><title>403 Forbidden<\/title><\/head> <body> Access denied by WAF <\/body> <\/html>x/);
  assert.ok(forbidden.error.length < 320, 'body is truncated to ~200 chars');
  assert.equal(forbidden.featureCount, null);

  const arcgis = diagnostics[2];
  assert.equal(arcgis.ok, false);
  assert.equal(arcgis.httpStatus, 200);
  assert.equal(arcgis.error, "ArcGIS error 400: Unable to complete operation. (details: 'where' parameter is invalid)");

  const network = diagnostics[5];
  assert.equal(network.httpStatus, null);
  assert.equal(network.error, 'network error: TypeError: fetch failed (cause: ENOTFOUND getaddrinfo ENOTFOUND gis.test)');
  assert.ok(diagnostics.every(x => Number.isFinite(x.ms) && x.url.startsWith(tinyDiscover.discover.layerUrl)));
});

test('arcgisGet reports non-JSON 200 bodies, ArcGIS errors on non-OK responses and timeouts', async () => {
  await assert.rejects(arcgisGet('https://gis.test/q', { fetchImpl: async () => new Response('  <html>Login</html> ', { status: 200, headers: { 'Content-Type': 'text/html' } }) }),
    e => e.httpStatus === 200 && e.contentType === 'text/html' && e.message === 'ArcGIS returned non-JSON (HTTP 200, content-type text/html, body: <html>Login</html>)');
  await assert.rejects(arcgisGet('https://gis.test/q', { fetchImpl: async () => new Response(JSON.stringify({ error: { code: 498, message: 'Invalid token.', details: [] } }), { status: 498 }) }),
    e => e.httpStatus === 498 && e.message === 'ArcGIS returned HTTP 498: ArcGIS error 498: Invalid token.');
  await assert.rejects(arcgisGet('https://gis.test/q', { fetchImpl: async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; } }),
    e => e.httpStatus === null && /network error: TimeoutError: The operation was aborted due to timeout/.test(e.message));
});

test('layer probe lists missing and wrong-case field names', async () => {
  const fields = ['OBJECTID', 'PIN', 'ACRES', 'Loc_City'].map(name => ({ name }));
  let requested;
  const probe = await probeLayer({ ...tinyDiscover.discover, layerUrl: tinyDiscover.discover.layerUrl + '/' }, { fetchImpl: async url => { requested = url; return new Response(JSON.stringify({ name: 'Parcels', fields }), { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(requested, `${tinyDiscover.discover.layerUrl}?f=json`);
  assert.equal(probe.ok, false);
  assert.equal(probe.httpStatus, 200);
  assert.deepEqual(probe.fieldsChecked, ['PIN', 'Acres', 'ZONING', 'Loc_City', 'Loc_Addr']);
  assert.deepEqual(probe.missingFields, ['Acres (layer has ACRES)', 'ZONING', 'Loc_Addr']);
  assert.equal(probe.error, 'missing fields: Acres (layer has ACRES), ZONING, Loc_Addr');

  const down = await probeLayer(tinyDiscover.discover, { fetchImpl: async () => new Response('Service Unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } }) });
  assert.equal(down.ok, false);
  assert.equal(down.httpStatus, 503);
  assert.equal(down.contentType, 'text/plain');
  assert.match(down.error, /HTTP 503, content-type text\/plain, body: Service Unavailable/);

  const noFields = await probeLayer(tinyDiscover.discover, { fetchImpl: async () => new Response(JSON.stringify({ name: 'x' })) });
  assert.equal(noFields.error, 'layer metadata has no fields list');
  assert.deepEqual(noFields.missingFields, noFields.fieldsChecked);
});

test('markdown has a discovery diagnostics section when discovery ran, even with no parcels', async () => {
  const diagnostics = [
    { step: 'probe layer metadata', url: 'https://gis.test/0?f=json', ok: false, httpStatus: 200, contentType: 'application/json', error: 'missing fields: ZONING', featureCount: null, ms: 12, fieldsChecked: ['PIN', 'ZONING'], missingFields: ['ZONING'] },
    { step: 'any | city-named locality (count)', url: 'https://gis.test/0/query?f=json', ok: false, httpStatus: 403, error: 'ArcGIS returned HTTP 403 | blocked', featureCount: null, ms: 40 },
    { step: 'distinct-zoning', url: 'https://gis.test/0/query?f=json', ok: true, httpStatus: 200, error: null, featureCount: 7, ms: 9 }
  ];
  const report = { county: 'Testco', state: 'ID', baseUrl: BASE, startedAt: 'now', discovered: true, discoveryDiagnostics: diagnostics, results: [], summary: summarize([]) };
  const md = buildMarkdown(report);
  assert.match(md, /## Discovery diagnostics/);
  assert.match(md, /Requests: 3, failed: 2\./);
  assert.match(md, /- Layer probe: HTTP 200, content-type application\/json, fields checked: PIN, ZONING, missing: ZONING/);
  assert.match(md, /\| Step \| HTTP \| Features \| ms \| Error \|/);
  assert.match(md, /\| any \\\| city-named locality \(count\) \| 403 \| - \| 40 \| ArcGIS returned HTTP 403 \\\| blocked \|/);
  assert.match(md, /\| distinct-zoning \| 200 \| 7 \| 9 \|  \|/);
  assert.match(md, /No parcels to validate/);
  assert.ok(md.indexOf('## Discovery diagnostics') < md.indexOf('No parcels to validate'));

  globalThis.fetch = stubFetch(happyResponses());
  const ran = await validateCounty({ county: 'Kootenai', state: 'ID' }, { parcels: [{ parcelId: 'TESTPIN1' }], baseUrl: BASE, delayMs: 0, requestDelayMs: 0 });
  assert.doesNotMatch(buildMarkdown(ran), /Discovery diagnostics/, 'no section when discovery did not run');
  assert.match(buildMarkdown({ ...ran, discoveryDiagnostics: diagnostics.slice(2) }), /## Discovery diagnostics[\s\S]*\| Parcel \|/);
});
