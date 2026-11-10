// Offline tests for the Spokane County parcel lookup behind /api/parcel-search
// (src/counties/spokane-parcels.js). Upstream answers are recorded from the live
// Assessor/Parcels layer on 2026-11-10 (test/fixtures/spokane-parcels.json; the layer has no owner
// fields); fetch is stubbed, no network. The browser side is test/spokane-parcel-ui.test.js.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { PERSONAL_FIELD } from '../src/shared/personal-fields.js';
import { SPOKANE_PARCEL_LAYER, SPOKANE_PARCEL_FIELDS, situs } from '../src/counties/spokane-parcels.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const recordedParcels = fixture('spokane-parcels.json').answers;
const env = { ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
const ctx = { waitUntil() {} };
const PARCEL_QUERY = `${SPOKANE_PARCEL_LAYER}/query`;
const SCOUT = pid => `https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=${pid}`;

const realFetch = globalThis.fetch, realWarn = console.warn;
let requested = [], restoreUpstream;
function stubFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requested.push(url);
    return handler(url, init);
  };
}
beforeEach(() => {
  requested = [];
  globalThis.fetch = async () => { throw new Error('network disabled in tests'); };
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0 });
});
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

const arcgisJson = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const askedPid = url => /PID_NUM='([^']+)'/.exec(url.searchParams.get('where'))?.[1];
const recordedLayer = url => {
  assert.equal(url.origin + url.pathname, PARCEL_QUERY);
  return arcgisJson(recordedParcels[askedPid(url)] || recordedParcels.miss);
};
async function post(path, body) {
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env, ctx);
  return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
}

test('spokane parcel search: a county-layer hit maps to the statewide property names, with assessor acres and the SCOUT link', async () => {
  stubFetch(recordedLayer);
  const { status, body, cache } = await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '57344.0125' });
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(cache, 'public, max-age=300, s-maxage=3600');
  const p = body.parcel.properties;
  assert.deepEqual(p, {
    FIPS_NR: '063', COUNTY_NM: 'Spokane', ORIG_PARCEL_ID: '57344.0125', PARCEL_ID_NR: '063-57344.0125',
    _countyDisplay: 'Spokane', _stateCode: 'WA', _stateDisplay: 'Washington',
    SITUS_ADDRESS: '14324 N MEADOW LN', SITUS_CITY_NM: 'NEWMAN LAKE', SITUS_ZIP_NR: '',
    DATA_LINK: SCOUT('57344.0125'), ACRES: 0.35,
    _source: { name: 'Spokane County GIS (Assessor/Parcels layer)', url: SPOKANE_PARCEL_LAYER }
  });
  // GeoJSON polygon, outer ring counter-clockwise (RFC 7946), closed, lon/lat.
  assert.equal(body.parcel.geometry.type, 'Polygon');
  const ring = body.parcel.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  let area = 0; for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(area > 0, 'counter-clockwise');
  assert.ok(ring.every(([x, y]) => x > -118 && x < -116.9 && y > 47.2 && y < 48.1));
  const q = requested[0].searchParams;
  assert.equal(requested[0].origin + requested[0].pathname, PARCEL_QUERY);
  assert.equal(q.get('where'), "PID_NUM='57344.0125'");
  assert.equal(q.get('outFields'), SPOKANE_PARCEL_FIELDS);
  assert.equal(q.get('outSR'), '4326');
  assert.deepEqual(SPOKANE_PARCEL_FIELDS.split(',').filter(f => PERSONAL_FIELD.test(f)), []);
});

test('spokane parcel search: ID formats (dots, dashes, no dots) reach the same parcel; a multipart parcel stays multipart', async () => {
  stubFetch(recordedLayer);
  for (const typed of ['573440125', '57344-0125', '063-57344.0125']) {
    const { body } = await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: typed });
    assert.equal(body.parcel.properties.ORIG_PARCEL_ID, '57344.0125', typed);
  }
  const forest = (await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '48121.9001' })).body.parcel;
  assert.equal(forest.geometry.type, 'MultiPolygon');
  assert.equal(forest.properties.ACRES, 158.65);
  // Placeholder situs values are dropped, like the statewide layer has them.
  assert.equal(forest.properties.SITUS_ADDRESS, '');
  assert.equal(forest.properties.SITUS_CITY_NM, 'ELK');
  const unknown = (await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '46301.9025' })).body.parcel.properties;
  assert.equal(unknown.SITUS_ADDRESS, '');
  assert.equal(unknown.SITUS_CITY_NM, '');
  assert.deepEqual(situs({ site_address: '0 UNKNOWN BABB RD', site_city: 'Spokane', site_zip: '00000' }), { SITUS_ADDRESS: '', SITUS_CITY_NM: 'SPOKANE', SITUS_ZIP_NR: '' });
  assert.deepEqual(situs({ site_address: '1317 E 12TH AVE', site_city: 'SPOKANE', site_zip: '99202' }), { SITUS_ADDRESS: '1317 E 12TH AVE', SITUS_CITY_NM: 'SPOKANE', SITUS_ZIP_NR: '99202' });
});

test('spokane parcel search: a miss, an id it cannot read, or a failure answers available:false (the browser then uses the statewide layer)', async () => {
  stubFetch(recordedLayer);
  let r = await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '99999.9999' });
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.equal(r.body.parcel, null);
  assert.equal(r.cache, 'no-store');
  requested = [];
  r = await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '1317 E 12TH AVE' });
  assert.equal(r.body.available, false);
  assert.equal(requested.length, 0, 'no request for an id that cannot be a Spokane PID');
  for (const handler of [() => new Response('down', { status: 503 }), () => { throw new TypeError('fetch failed'); }, () => arcgisJson({ error: { code: 400, message: 'Invalid query' } })]) {
    stubFetch(handler);
    r = await post('/api/parcel-search', { state: 'WA', county: 'Spokane', parcelId: '57344.0125' });
    assert.equal(r.status, 200);
    assert.equal(r.body.available, false);
    assert.match(r.body.error, /Spokane County parcel layer|fetch failed/);
  }
});

test('spokane parcel search: other WA counties still get the "not supported" answer', async () => {
  const r = await post('/api/parcel-search', { state: 'WA', county: 'Stevens', parcelId: '0231200' });
  assert.equal(r.status, 400);
});
