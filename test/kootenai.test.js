// Offline tests for the Kootenai site adapter (src/counties/kootenai.js). fetch is stubbed with
// canned ArcGIS answers; nothing touches the county servers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { getKootenaiCountyIntelligence } from '../src/counties/kootenai.js';

const PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query';
const ZONING = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query';

const ring = [[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]];
const parcelAnswer = { features: [{ attributes: { PIN: 'P50N04W123456', Acres: 10, Loc_Addr: '1 Test Rd', Loc_City: 'Athol' }, geometry: { rings: [ring] } }] };
const zoningAnswer = { features: [{ attributes: { ZONE_NAME: 'Rural', LABEL: 'Rural', ACRES: 120 } }] };
// What the Ownership_Display layer actually returns when outFields names a field it lacks.
const arcgisError = { error: { code: 400, message: 'Failed to execute query.', details: [] } };

let calls;
function stub({ parcel = () => parcelAnswer } = {}) {
  calls = [];
  return async input => {
    const url = new URL(String(input));
    const base = url.origin + url.pathname;
    calls.push({ base, params: url.searchParams });
    const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (base === PARCELS) return reply(parcel(url.searchParams, calls.filter(c => c.base === PARCELS).length));
    if (base === ZONING) return reply(zoningAnswer);
    throw new Error(`unexpected request ${base}`);
  };
}
const parcelCalls = () => calls.filter(c => c.base === PARCELS);

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let warnings;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; warnings = []; console.warn = (...args) => warnings.push(args.map(String).join(' ')); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

const env = { ASSETS: { fetch: async () => new Response('') } };
async function zoningPermits(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/zoning-permits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  return response.json();
}

test('Kootenai parcel query does not request the missing ZONING field', async () => {
  globalThis.fetch = stub();
  await zoningPermits({ county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 1);
  const outFields = parcelCalls()[0].params.get('outFields').split(',');
  assert.ok(!outFields.includes('ZONING'), `outFields was ${outFields}`);
  assert.deepEqual(outFields, ['PIN', 'PID', 'Acres', 'Legal', 'Loc_Addr', 'Loc_City', 'Ex_Value', 'Net_Val', 'Gross_Val', 'TCA']);
  assert.deepEqual(warnings, []);
});

test('Kootenai parcel query retries once with minimal fields after an ArcGIS error', async () => {
  globalThis.fetch = stub({ parcel: (params, n) => (n === 1 ? arcgisError : parcelAnswer) });
  // No lat/lon: the parcel geometry from the retry is what locates the zoning point query.
  const result = await getKootenaiCountyIntelligence({ parcelId: 'p50n04w123456' });
  assert.equal(parcelCalls().length, 2);
  assert.equal(parcelCalls()[1].params.get('outFields'), 'PIN,Acres,Loc_Addr,Loc_City');
  assert.equal(parcelCalls()[1].params.get('where'), "UPPER(PIN)='P50N04W123456'");
  assert.equal(parcelCalls()[1].params.get('returnGeometry'), 'true');
  const point = JSON.parse(calls.find(c => c.base === ZONING).params.get('geometry'));
  assert.ok(Math.abs(point.x - -116.796) < 1e-9 && Math.abs(point.y - 47.704) < 1e-9);
  assert.equal(result.available, true);
  assert.equal(result.zoning.code, 'Rural');
  assert.equal(result.source.parcelAttributes.PIN, 'P50N04W123456');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /retrying with minimal fields/);
  assert.match(warnings[0], /Failed to execute query/);
});

test('Kootenai zoning still comes from the point query when both parcel queries fail', async () => {
  globalThis.fetch = stub({ parcel: () => arcgisError });
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 2, 'one retry only');
  assert.equal(result.available, true);
  assert.equal(result.zoning.code, 'Rural');
  assert.deepEqual(result.source.parcelAttributes, {});
});

test('Kootenai parcel query is not retried after an HTTP failure', async () => {
  calls = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push({ base: url.origin + url.pathname, params: url.searchParams });
    if (url.origin + url.pathname === PARCELS) return new Response('Service Unavailable', { status: 503 });
    return new Response(JSON.stringify(zoningAnswer), { status: 200 });
  };
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P1', lat: 47.705, lon: -116.795 });
  assert.equal(parcelCalls().length, 1);
  assert.equal(result.available, true);
});

test('/api/zoning-permits Kootenai success response keeps its shape', async () => {
  globalThis.fetch = stub();
  const result = await zoningPermits({ county: 'Kootenai', parcelId: 'P50N04W123456', lat: 47.705, lon: -116.795 });
  assert.deepEqual(Object.keys(result), ['available', 'county', 'state', 'countyStatus', 'jurisdiction', 'permitJurisdiction', 'zoning', 'allowedBuildings', 'permittedUses', 'comprehensivePlan', 'urbanGrowthArea', 'overlays', 'permits', 'permitHistory', 'permitHistoryStatus', 'source']);
  assert.deepEqual(result.zoning, { status: 'gis_match', code: 'Rural', name: 'Rural', label: 'Rural', note: 'Mapped zoning designation from Kootenai County KCEarth/Data_Layers.', sourceUrl: 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21', url: 'https://www.kcgov.us/230/Planning' });
  assert.deepEqual(Object.keys(result.source), ['agency', 'service', 'layerId', 'matchMethod', 'attributes', 'parcelAttributes']);
  assert.deepEqual(result.source.attributes, zoningAnswer.features[0].attributes);
  assert.deepEqual(result.source.parcelAttributes, parcelAnswer.features[0].attributes);
  assert.equal(result.allowedBuildings.status, 'mapped_from_county_code');
  assert.equal(result.countyStatus, 'kootenai-data-layers-v3');
});
