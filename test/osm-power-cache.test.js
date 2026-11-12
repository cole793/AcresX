// Offline tests for the OpenStreetMap power-proximity cache and mirror order
// (src/utilities/osm-power.js): a complete Overpass answer is cached per ~1 km grid cell for 30
// days and answers every parcel in that cell; an incomplete answer is used but not cached; a 429
// from the main instance falls through to the private.coffee mirror. Fetch and the Cache API are
// stubbed; nothing touches Overpass.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureUpstream } from '../src/shared/upstream.js';
import { getOsmPowerProximity, osmCell, OSM_POWER_CACHE_TTL_SECONDS } from '../src/utilities/osm-power.js';

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let restore, store, puts;
before(() => { restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restore(); globalThis.fetch = realFetch; if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches; });
beforeEach(() => {
  store = new Map(); puts = [];
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? new Response(hit.body, { headers: hit.headers }) : undefined; },
    async put(req, res) { const body = await res.text(); store.set(req.url, { body, headers: Object.fromEntries(res.headers) }); puts.push({ url: req.url, cacheControl: res.headers.get('Cache-Control') }); }
  } };
});

// A pole about 0.002 deg of longitude (~490 ft at 47.85 N) east of the test point.
const LAT = 47.8512, LON = -117.2537;
const pole = { type: 'node', id: 1, lat: LAT, lon: LON + 0.002, tags: { power: 'pole', operator: 'Inland Power', name: 'dropped' } };
const answer = (extra = {}) => new Response(JSON.stringify({ elements: [pole], ...extra }), { status: 200, headers: { 'Content-Type': 'application/json' } });
function stubOverpass(route) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = typeof init?.body === 'string' ? decodeURIComponent(init.body.replace(/^data=/, '')) : '';
    calls.push({ host: url.hostname, body });
    return route(url, body);
  };
  return calls;
}

test('a complete answer is cached per grid cell for 30 days and answers the next parcel in the cell', async () => {
  const calls = stubOverpass(() => answer());
  const first = await getOsmPowerProximity({ lat: LAT, lon: LON, provider: 'Inland Power' });
  assert.equal(first.available, true);
  assert.equal(first.cached, false);
  assert.ok(Math.abs(first.estimatedDistanceFt - 490) < 10, `about 490 ft, got ${first.estimatedDistanceFt}`);
  assert.equal(calls.length, 1);
  // The query is centred on the cell with the radius widened to cover the whole cell.
  const cell = osmCell(LAT, LON);
  assert.match(calls[0].body, new RegExp(`around:5800,${cell.lat},${cell.lon}`));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].cacheControl, `public, max-age=${OSM_POWER_CACHE_TTL_SECONDS}`);
  assert.equal(OSM_POWER_CACHE_TTL_SECONDS, 30 * 86400);
  // Only the needed tags are stored.
  assert.doesNotMatch([...store.values()][0].body, /dropped/);
  // Another point in the same cell: no Overpass call.
  const second = await getOsmPowerProximity({ lat: LAT + 0.001, lon: LON + 0.001, provider: 'Inland Power' });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.ok(second.estimatedDistanceFt < first.estimatedDistanceFt);
  assert.equal(second.cacheCell, first.cacheCell);
});

test('an answer Overpass marks as timed out is used but not cached', async () => {
  const calls = stubOverpass(() => answer({ remark: 'runtime error: Query timed out in "query" at line 1 after 8 seconds.' }));
  const r = await getOsmPowerProximity({ lat: LAT, lon: LON });
  assert.equal(r.available, true);
  assert.equal(puts.length, 0);
  await getOsmPowerProximity({ lat: LAT, lon: LON });
  assert.equal(calls.length, 2, 'asked again');
});

test('a 429 from overpass-api.de falls through to private.coffee within the budget; failures are not cached', async () => {
  const calls = stubOverpass(url => (url.hostname === 'overpass-api.de' ? new Response('rate limited', { status: 429 }) : answer()));
  const r = await getOsmPowerProximity({ lat: LAT, lon: LON });
  assert.equal(r.available, true);
  assert.deepEqual(calls.map(c => c.host), ['overpass-api.de', 'overpass.private.coffee']);
  stubOverpass(() => new Response('rate limited', { status: 429 }));
  store.clear(); puts = [];
  const down = await getOsmPowerProximity({ lat: LAT, lon: LON });
  assert.deepEqual([down.available, down.status, puts.length], [false, 'source_unavailable', 0]);
});

test('points far apart fall in different cells', () => {
  assert.notEqual(osmCell(LAT, LON).key, osmCell(LAT + 0.02, LON).key);
  assert.equal(osmCell(LAT, LON).key, osmCell(LAT + 0.0005, LON + 0.0005).key);
});
