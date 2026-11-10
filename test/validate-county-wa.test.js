// Offline tests for the Washington path in scripts/validate-county.mjs: the statewide parcel
// lookup and Ecology well search through /api/arcgis (as public/index.html does), mapped acreage,
// discovery on the statewide layer with Shape__Area, the owner-field guards, and the saved WA
// validation configs. fetch is stubbed with recorded answers; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateParcel, centroid, assertReadOnly, assertNoOwnerFields, WA_PARCEL_FIELDS, WA_WELL_FIELDS, waParcelWhere,
  geodesicAreaSqM, mappedAcres, buildDiscoveryStrata, discoverParcels, isUnsupportedAssessment, unitsPerAcre
} from '../scripts/validate-county.mjs';

const BASE = 'https://acresx.test';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/wa-spokane-57344.0125.json', import.meta.url), 'utf8'));
const readConfig = name => JSON.parse(readFileSync(new URL(`../validation/counties/${name}.json`, import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

// Worker answers for the other layers, shaped like the live Spokane answers.
function waResponses() {
  return {
    parcel: () => clone(fixture.parcel),
    wells: () => clone(fixture.wells),
    '/api/utility-territory': { available: true, providers: ['INLAND POWER & LIGHT COMPANY'] },
    flood: { available: true, intersects: true, high: true, zones: ['AE', 'X'], source: { provider: 'FEMA NFHL' } },
    wetlands: { available: true, intersects: true, count: 1, coveragePct: 12.5 },
    '/api/zoning-permits': { available: true, county: 'Spokane', jurisdiction: 'Spokane County', countyStatus: 'official_adapter', zoning: { status: 'gis_match', code: 'RCV', name: 'Rural Conservation' }, urbanGrowthArea: { intersects: false } },
    '/api/land-analysis': { available: true, soil: { available: true, feasibility: 'limited', mapUnit: 'Aquepts' }, terrain: { available: true, gradePct: 2, maxGradePct: 8 } },
    '/api/existing-well': { available: true, status: 'possible_match', label: 'Possible well association', confidence: 'Low', score: 30 },
    '/api/property-assessment': { available: true, state: 'WA', county: 'Spokane', source: 'Spokane County Assessor SCOUTSimple', records: [{ PID_NUM: '57344.0125', land_value: 120000, tax_year: 2026 }] },
    '/api/reso-listings': { available: true, configured: true, matchCount: 1, best: { status: 'Closed' }, matchConfidence: 'moderate' },
    '/api/power-intelligence': { available: true, provider: 'INLAND POWER & LIGHT COMPANY', distribution: { estimatedDistanceFt: 300, confidence: 'low' } },
    '/api/zoning-rules': { available: true, county: 'Spokane', code: 'RCV', family: 'Rural', uses: [{}] },
    '/api/slope-grid': { available: true, cells: [{ gradePct: 3 }] },
    '/api/public-utilities': { available: true, water: { status: 'served', provider: 'Moab Irrigation Dist #20' }, sewer: { status: 'not_found', provider: null }, sources: [{ id: 'wa-doh-water', ok: true }] }
  };
}

let calls;
function stubFetch(responses) {
  calls = [];
  return async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, body });
    const key = route === '/api/hazards' ? body.kind : route === '/api/arcgis' ? body.service : route;
    let answer = responses[key];
    if (typeof answer === 'function') answer = answer(body, calls.filter(c => c.route === route && (c.body?.service || '') === (body?.service || '')).length);
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response(JSON.stringify({ error: 'API route not found' }), { status: 404 });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

// findParcel's where clauses (public/index.html:112) for county Spokane (fips '063', shortFips '63'),
// written out in full so dropping a branch (PARCEL_ID_NR, the FIPS-prefixed id, the short FIPS,
// COUNTY_NM) fails a test. Exact for input '57344.0125'; LIKE for input '57344-0125' (normalised
// to 573440125).
const SPOKANE_COUNTY_WHERE = "(FIPS_NR='063' OR FIPS_NR='63' OR COUNTY_NM='Spokane' OR COUNTY_NM='63' OR COUNTY_NM='063')";
const SPOKANE_EXACT_WHERE = `${SPOKANE_COUNTY_WHERE} AND (UPPER(ORIG_PARCEL_ID)='57344.0125' OR UPPER(PARCEL_ID_NR)='57344.0125' OR UPPER(PARCEL_ID_NR)='06357344.0125')`;
const SPOKANE_LIKE_WHERE = `${SPOKANE_COUNTY_WHERE} AND (UPPER(ORIG_PARCEL_ID) LIKE '%573440125%' OR UPPER(PARCEL_ID_NR) LIKE '%573440125%')`;

const runWa = (entry = { parcelId: '57344.0125' }, county = 'Spokane') => validateParcel(entry, { state: 'WA', county, baseUrl: BASE, requestDelayMs: 0 });

test('Washington parcels: Spokane asks /api/parcel-search first; with no parcel there, /api/arcgis like findParcel', async () => {
  // The stub has no /api/parcel-search answer (HTTP 404), so the statewide lookup runs.
  globalThis.fetch = stubFetch(waResponses());
  const result = await runWa();
  for (const [key, layer] of Object.entries(result.layers)) assert.equal(layer.status, 'ok', `${key}: ${layer.detail}`);
  const routes = calls.map(c => (c.route === '/api/arcgis' ? `arcgis:${c.body.service}` : c.route === '/api/hazards' ? `hazards:${c.body.kind}` : c.route));
  assert.deepEqual(calls[0].body, { state: 'WA', county: 'Spokane', parcelId: '57344.0125' });
  assert.deepEqual(routes, [
    '/api/parcel-search', 'arcgis:parcel', 'arcgis:wells', '/api/utility-territory', 'hazards:flood', 'hazards:wetlands', '/api/zoning-permits',
    '/api/public-utilities', '/api/land-analysis', '/api/existing-well', '/api/property-assessment', '/api/reso-listings', '/api/power-intelligence',
    '/api/zoning-rules', '/api/slope-grid'
  ]);
  const parcelParams = calls[1].body.params;
  assert.equal(parcelParams.outFields, WA_PARCEL_FIELDS);
  assert.equal(parcelParams.f, 'geojson');
  assert.equal(parcelParams.where, SPOKANE_EXACT_WHERE);
  assert.equal(waParcelWhere('Spokane', '57344.0125').exactWhere, SPOKANE_EXACT_WHERE);
  assert.match(parcelParams.where, /FIPS_NR='063'/);

  const geometry = fixture.parcel.features[0].geometry;
  const { lat, lon } = centroid(geometry);
  const body = route => calls.find(c => c.route === route).body;
  assert.deepEqual(body('/api/utility-territory'), { state: 'WA', county: 'Spokane', lat, lon });
  assert.equal(body('/api/zoning-permits').county, 'Spokane');
  assert.equal(body('/api/zoning-permits').dataLink, 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=57344.0125');
  assert.deepEqual(body('/api/existing-well'), { state: 'WA', county: 'Spokane', parcelId: '57344.0125', address: '14324 N MEADOW LN, NEWMAN LAKE', geometry });
  assert.deepEqual(body('/api/property-assessment'), { state: 'WA', county: 'Spokane', parcelId: '57344.0125' });
  assert.deepEqual(body('/api/power-intelligence').providers, ['INLAND POWER & LIGHT COMPANY']);

  // The statewide layer has no acreage field: acres come from the outline (live run: 0.45 ac).
  assert.equal(result.layers.parcel.values.acres, 0.45);
  assert.equal(result.layers.parcel.values.acresSource, 'mapped outline');
  assert.match(result.layers.parcel.detail, /0\.45 ac \(mapped\)/);
  assert.equal(result.layers.assessment.values.landValue, 120000);
  assert.equal(result.layers.wells.values.wellCount, 8);
  // No request names an owner field.
  for (const c of calls) assert.doesNotMatch(JSON.stringify(c.body), /owner|taxpayer/i);
});

test('the well search widens from 2 miles until 5 wells with a depth are found, like findWells', async () => {
  const responses = waResponses();
  const few = clone(fixture.wells);
  few.features = few.features.slice(0, 2).concat([{ type: 'Feature', geometry: { type: 'Point', coordinates: [-117.1, 47.79] }, properties: { CompletedDepth: 0 } }]);
  responses.wells = (body, n) => (n === 1 ? few : clone(fixture.wells));
  globalThis.fetch = stubFetch(responses);
  const result = await runWa();
  const wellCalls = calls.filter(c => c.body?.service === 'wells');
  assert.equal(wellCalls.length, 2);
  const width = c => { const e = JSON.parse(c.body.params.geometry); return e.ymax - e.ymin; };
  assert.ok(Math.abs(width(wellCalls[0]) - 4 / 69) < 1e-9);
  assert.ok(Math.abs(width(wellCalls[1]) - 8 / 69) < 1e-9);
  for (const c of wellCalls) {
    assert.equal(c.body.params.outFields, WA_WELL_FIELDS);
    assert.equal(c.body.params.where, "WellProjectType <> 'Decommission'");
  }
  assert.equal(result.layers.wells.status, 'ok');
  assert.equal(result.layers.wells.values.wellCount, 8);
});

test('no well with a depth within 64 miles is unavailable; a failed well query is an error', async () => {
  const responses = waResponses();
  responses.wells = { type: 'FeatureCollection', features: [] };
  globalThis.fetch = stubFetch(responses);
  let result = await runWa();
  assert.equal(calls.filter(c => c.body?.service === 'wells').length, 6);
  assert.equal(result.layers.wells.status, 'unavailable');

  responses.wells = () => new Response(JSON.stringify({ error: 'Government data service returned 500.' }), { status: 502 });
  globalThis.fetch = stubFetch(responses);
  result = await runWa();
  assert.equal(result.layers.wells.status, 'error');
  assert.match(result.layers.wells.detail, /HTTP 502: Government data service returned 500/);
});

test('the LIKE fallback runs when the exact query finds nothing, and keeps only matching ids', async () => {
  const responses = waResponses();
  const feature = clone(fixture.parcel.features[0]);
  const other = clone(feature); other.properties.ORIG_PARCEL_ID = '57344.01250'; other.properties.PARCEL_ID_NR = '063-57344.01250';
  responses.parcel = (body, n) => (n === 1 ? { type: 'FeatureCollection', features: [] } : { type: 'FeatureCollection', features: [feature, other] });
  globalThis.fetch = stubFetch(responses);
  const result = await runWa({ parcelId: '57344-0125' });
  const parcelCalls = calls.filter(c => c.body?.service === 'parcel');
  assert.equal(parcelCalls.length, 2);
  assert.equal(parcelCalls[0].body.params.where, SPOKANE_EXACT_WHERE.replaceAll("'57344.0125'", "'57344-0125'").replace("'06357344.0125'", "'06357344-0125'"));
  assert.equal(parcelCalls[1].body.params.where, SPOKANE_LIKE_WHERE);
  assert.equal(waParcelWhere('Spokane', '57344-0125').likeWhere, SPOKANE_LIKE_WHERE);
  assert.equal(parcelCalls[1].body.params.resultRecordCount, '100');
  assert.equal(result.layers.parcel.status, 'ok');
  assert.equal(result.layers.parcel.values.parcelId, '57344.0125');
});

test('no match or several matches fail the parcel layer with the browser message and skip the rest', async () => {
  const responses = waResponses();
  responses.parcel = { type: 'FeatureCollection', features: [] };
  globalThis.fetch = stubFetch(responses);
  let result = await runWa();
  assert.equal(result.layers.parcel.status, 'error');
  assert.match(result.layers.parcel.detail, /Parcel not found/);
  assert.equal(result.layers.wells.status, 'skipped');
  assert.deepEqual(calls.map(c => c.route), ['/api/parcel-search', '/api/arcgis', '/api/arcgis']);

  const feature = fixture.parcel.features[0];
  responses.parcel = { type: 'FeatureCollection', features: [clone(feature), clone(feature)] };
  globalThis.fetch = stubFetch(responses);
  result = await runWa();
  assert.match(result.layers.parcel.detail, /Multiple parcel matches found \(2\)/);
});

test('a slow statewide layer (Worker 502 timeout) is a parcel error, not a retry', async () => {
  const responses = waResponses();
  responses.parcel = () => new Response(JSON.stringify({ error: 'services.arcgis.com timed out after 25s' }), { status: 502 });
  globalThis.fetch = stubFetch(responses);
  const result = await runWa();
  assert.equal(result.layers.parcel.status, 'error');
  assert.match(result.layers.parcel.detail, /timed out after 25s/);
  assert.deepEqual(calls.map(c => c.route), ['/api/parcel-search', '/api/arcgis']);
});

// The answers src/counties/spokane-parcels.js and spokane-assessor.js give for 57344.0125
// (values from the live layers, 2026-11-10).
const spokaneCountyParcel = () => {
  const feature = clone(fixture.parcel.features[0]);
  feature.properties = {
    FIPS_NR: '063', COUNTY_NM: 'Spokane', ORIG_PARCEL_ID: '57344.0125', PARCEL_ID_NR: '063-57344.0125', _countyDisplay: 'Spokane', _stateCode: 'WA', _stateDisplay: 'Washington',
    SITUS_ADDRESS: '14324 N MEADOW LN', SITUS_CITY_NM: 'NEWMAN LAKE', SITUS_ZIP_NR: '', DATA_LINK: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=57344.0125', ACRES: 0.35
  };
  return { available: true, state: 'WA', county: 'Spokane', source: 'Spokane County GIS (Assessor/Parcels layer)', parcel: feature };
};
const spokaneAssessment = {
  available: true, state: 'WA', county: 'Spokane', parcelId: '57344.0125', source: 'Spokane County Assessor (assessor parcel table, Spokane County GIS)',
  records: [{ PID_NUM: '57344.0125', tax_year: 2026, asmt_year: 2027, land_value: 387870 }],
  countyRecords: [{ parcelNumber: '57344.0125', landValue: 387870, improvementValue: 0, totalValue: 387870, taxableValue: 387870, netValue: 387870, taxYear: 2027, taxAmount: null, assessorAcres: 0.35, taxCodeArea: '2240', propertyClass: '91', propertyClassDescription: 'Vacant Land' }]
};

test('Spokane: a county-layer parcel is used as is (no statewide query); the assessment reads countyRecords first', async () => {
  const responses = waResponses();
  responses['/api/parcel-search'] = spokaneCountyParcel();
  responses['/api/property-assessment'] = spokaneAssessment;
  globalThis.fetch = stubFetch(responses);
  const result = await runWa({ parcelId: '573440125' });
  assert.deepEqual(calls[0], { route: '/api/parcel-search', body: { state: 'WA', county: 'Spokane', parcelId: '573440125' } });
  assert.equal(calls.filter(c => c.body?.service === 'parcel').length, 0);
  assert.equal(result.layers.parcel.status, 'ok');
  assert.equal(result.layers.parcel.values.parcelId, '57344.0125');
  // The county layer carries the assessor acreage.
  assert.equal(result.layers.parcel.values.acres, 0.35);
  assert.equal(body('/api/zoning-permits').dataLink, 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=57344.0125');
  const a = result.layers.assessment;
  assert.equal(a.status, 'ok');
  assert.equal(a.values.propertyClass, '91');
  assert.equal(a.values.assessedValue, 387870);
  assert.equal(a.values.taxYear, 2027);
  assert.equal(a.values.taxPresent, false);
  assert.match(a.detail, /assessed \$387,870, class 91 Vacant Land, no tax amount/);

  // An answer without a parcel (a miss or an error) goes on to the statewide layer.
  for (const answer of [{ available: false, state: 'WA', county: 'Spokane', parcel: null, note: 'No match' }, { available: false, parcel: null, error: 'Spokane County parcel layer timed out' }]) {
    responses['/api/parcel-search'] = answer;
    globalThis.fetch = stubFetch(responses);
    const r = await runWa();
    assert.equal(r.layers.parcel.status, 'ok');
    assert.deepEqual(calls.slice(0, 2).map(c => c.route), ['/api/parcel-search', '/api/arcgis']);
  }
});
const body = route => calls.find(c => c.route === route).body;

test('Stevens: an assessment answer of "currently supports" is unavailable; other HTTP 400s stay errors', async () => {
  const responses = waResponses();
  const unsupported = { error: 'Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.' };
  responses['/api/property-assessment'] = () => new Response(JSON.stringify(unsupported), { status: 400 });
  globalThis.fetch = stubFetch(responses);
  let result = await runWa({ parcelId: '57344.0125' }, 'Stevens');
  assert.match(calls[0].body.params.where, /FIPS_NR='065'/);
  assert.equal(result.layers.assessment.status, 'unavailable');
  assert.match(result.layers.assessment.detail, /no assessment source for this county/);
  assert.ok(isUnsupportedAssessment({ httpStatus: 400, data: unsupported }));
  assert.ok(!isUnsupportedAssessment({ httpStatus: 400, data: { error: 'parcelId is required' } }));

  responses['/api/property-assessment'] = () => new Response(JSON.stringify({ error: 'parcelId is required' }), { status: 400 });
  globalThis.fetch = stubFetch(responses);
  result = await runWa({ parcelId: '57344.0125' }, 'Stevens');
  assert.equal(result.layers.assessment.status, 'error');
});

test('/api/arcgis is allowed only for parcel and wells, with listed non-owner fields', () => {
  assert.doesNotThrow(() => assertReadOnly('/api/arcgis', { service: 'parcel', params: { outFields: WA_PARCEL_FIELDS } }));
  assert.doesNotThrow(() => assertReadOnly('/api/arcgis', { service: 'wells', params: { outFields: WA_WELL_FIELDS } }));
  assert.throws(() => assertReadOnly('/api/arcgis', { service: 'utility', params: { outFields: 'NAME' } }), /only parcel, wells/);
  assert.throws(() => assertReadOnly('/api/arcgis', { service: 'parcel', params: {} }), /explicit outFields/);
  assert.throws(() => assertReadOnly('/api/arcgis', { service: 'parcel', params: { outFields: '*' } }), /outFields \*/);
  assert.throws(() => assertReadOnly('/api/arcgis', { service: 'parcel', params: { outFields: 'ORIG_PARCEL_ID,OWNER_NAME' } }), /OWNER_NAME/);
  assert.throws(() => assertNoOwnerFields(['PIN', 'taxpayer_name', 'MAIL_ADDR']), /taxpayer_name, MAIL_ADDR/);
});

test('mapped acreage uses the turf.area formula', () => {
  // A 1 x 1 degree cell at the equator: R^2 * dLon * (sin(1 deg) - sin(0)) with R = 6378137.
  const cell = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  const want = 6378137 ** 2 * (Math.PI / 180) * Math.sin(Math.PI / 180);
  assert.ok(Math.abs(geodesicAreaSqM(cell) - want) / want < 1e-9);
  // Holes are subtracted; MultiPolygons add.
  const hole = [[0.25, 0.25], [0.25, 0.75], [0.75, 0.75], [0.75, 0.25], [0.25, 0.25]];
  const holed = { type: 'Polygon', coordinates: [cell.coordinates[0], hole] };
  assert.ok(geodesicAreaSqM(holed) < geodesicAreaSqM(cell) * 0.76);
  assert.ok(Math.abs(geodesicAreaSqM({ type: 'MultiPolygon', coordinates: [cell.coordinates, cell.coordinates] }) - 2 * want) / want < 1e-9);
  assert.equal(mappedAcres(null), null);
  assert.equal(Math.round(mappedAcres(fixture.parcel.features[0].geometry) * 100) / 100, 0.45);
});

test('WA discovery: Shape__Area bands in square feet, the FIPS filter and city/unincorporated strata', async () => {
  const config = readConfig('spokane');
  assert.equal(unitsPerAcre(config.discover), 43560);
  const strata = buildDiscoveryStrata(config.discover);
  assert.equal(strata.length, 8);
  for (const s of strata) assert.match(s.where, /FIPS_NR='063'/);
  assert.match(strata.find(s => s.id === '1-5 ac | city-named locality').where, /Shape__Area >= 43560\) AND|Shape__Area >= 43560 AND Shape__Area < 217800/);
  assert.match(strata.find(s => s.id === '40+ ac | other/blank locality').where, /Shape__Area >= 1742400/);
  assert.match(strata.find(s => s.id === 'under 1 ac | city-named locality').where, /UPPER\(SITUS_CITY_NM\) IN \(.*'SPOKANE VALLEY'/);

  const requests = [];
  const fetchImpl = async url => {
    const u = new URL(url);
    requests.push(u);
    if (!u.pathname.endsWith('/query')) return new Response(JSON.stringify({ fields: fixture.layerFields.map(name => ({ name })) }));
    assert.doesNotMatch(u.searchParams.get('outFields') || '', /owner|\*/i);
    if (u.searchParams.get('returnCountOnly')) return new Response(JSON.stringify({ count: 10 }));
    const n = requests.length;
    const city = /IN \(/.test(u.searchParams.get('where')) && !/NOT IN/.test(u.searchParams.get('where')) ? 'SPOKANE' : 'MEAD';
    return new Response(JSON.stringify({ features: [{ attributes: { ORIG_PARCEL_ID: `P${n}`, Shape__Area: 43560 * 2.5, SITUS_CITY_NM: city, SITUS_ADDRESS: `${n} Test Rd` } }] }));
  };
  const { parcels, diagnostics } = await discoverParcels({ ...config, discover: { ...config.discover, delayMs: 0 } }, { count: 8, seed: 7, fetchImpl });
  assert.equal(diagnostics[0].ok, true, diagnostics[0].error);
  assert.equal(parcels.length, 8);
  assert.equal(parcels[0].countyAttributes.acres, 2.5);
  assert.match(parcels[0].label, /2\.5 ac/);
  assert.ok(parcels.some(p => p.countyAttributes.city === 'SPOKANE') && parcels.some(p => p.countyAttributes.city === 'MEAD'));
  assert.equal(requests.filter(u => u.pathname.endsWith('/query')).length, 16);
});

test('discovery refuses owner fields and unknown area units', async () => {
  const config = readConfig('stevens');
  await assert.rejects(discoverParcels({ ...config, discover: { ...config.discover, addressField: 'OWNER_ADDR' } }, { fetchImpl: async () => { throw new Error('should not fetch'); } }), /OWNER_ADDR/);
  await assert.rejects(discoverParcels({ ...config, discover: { ...config.discover, acresUnit: 'hectares' } }, { fetchImpl: async () => { throw new Error('should not fetch'); } }), /Unknown acresUnit hectares/);
});

test('saved WA configs: about 12 parcels, every acreage band, city and unincorporated, hand-checked expected values', () => {
  const band = label => { const ac = Number(/([\d.]+) ac/.exec(label)?.[1]); return ac < 1 ? 'small' : ac < 5 ? '1-5' : ac < 40 ? '5-40' : '40+'; };
  for (const [name, fips] of [['spokane', '063'], ['stevens', '065']]) {
    const config = readConfig(name);
    assert.equal(config.state, 'WA');
    assert.match(config.discover.where, new RegExp(`FIPS_NR='${fips}'`));
    assert.ok(config.parcels.length >= 10 && config.parcels.length <= 14, `${name}: ${config.parcels.length} parcels`);
    assert.equal(new Set(config.parcels.map(p => p.parcelId)).size, config.parcels.length);
    assert.deepEqual([...new Set(config.parcels.map(p => band(p.label)))].sort(), ['1-5', '40+', '5-40', 'small']);
    assert.ok(config.parcels.some(p => /^City of /.test(p.label)), `${name}: no city parcel`);
    assert.ok(config.parcels.some(p => /unincorporated/i.test(p.why)), `${name}: no unincorporated parcel`);
    assert.ok(config.parcels.some(p => /wetlands/.test(p.label)), `${name}: no wetland parcel`);
    const checked = config.parcels.filter(p => p.expected?.['zoning.code']);
    assert.ok(checked.length >= 3, `${name}: ${checked.length} parcels with expected zoning`);
    for (const p of checked) assert.match(p.why, /https:\/\/\S+\/query\?f=json/, `${p.parcelId}: no source URL in why`);
  }
  // Spokane has a FEMA AE parcel. Stevens has no FEMA NFHL panels; its A/AE parcels come from the
  // county's digitized FEMA FIRM (src/counties/stevens-flood.js).
  assert.ok(readConfig('spokane').parcels.some(p => p.expected?.['flood.zones'] === 'AE' && p.expected['flood.high'] === true));
  assert.ok(readConfig('stevens').parcels.some(p => p.expected?.['flood.high'] === true && /MapServer\/19\/query\?f=json/.test(p.why)));
});
