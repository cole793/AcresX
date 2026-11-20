// /api/power-intelligence answers within its time box when a source hangs, offline, with mocked
// timers. Before: Overpass was asked one endpoint after the other at 18 s each, so a hanging
// Overpass held the answer for 36 s (past the browser's 15 s and the validator's 30 s).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePowerIntelligence, POWER_BUDGET_MS, OVERPASS_SERVER_CAP_MS, POWER_ANSWER_CACHE_PREFIX, POWER_ANSWER_PARTIAL_TTL_SECONDS } from '../src/services/power-intelligence.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/utility-territory-ranking.json', import.meta.url), 'utf8'));
const cda = FIXTURE.cases['kootenai-cda-city'];
// Avista's answer for the 330 ft ring at the Coeur d'Alene city point (25 sections).
const avista330 = cda.requests.find(r => r.url.includes('/DER_Hosting_Capacity_PRD/') && r.url.includes('distance=330&')).body;
const point = { lat: cda.case.lat, lon: cda.case.lon };
const outline = { type: 'Polygon', coordinates: [[[point.lon - 0.0002, point.lat - 0.0002], [point.lon + 0.0002, point.lat - 0.0002], [point.lon + 0.0002, point.lat + 0.0002], [point.lon - 0.0002, point.lat + 0.0002], [point.lon - 0.0002, point.lat - 0.0002]]] };

// Overpass never answers (it only gives up when the request is aborted); Avista's map answers.
// hifld: 'answer' makes HIFLD transmission answer at once (no line nearby).
function stubFetch({ avista = 'answer', hifld = 'hang' } = {}) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.hostname);
    if (url.pathname.includes('/DER_Hosting_Capacity_PRD/')) {
      if (avista === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      return Promise.resolve(new Response(JSON.stringify(avista330), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (hifld === 'answer' && url.hostname === 'services2.arcgis.com') {
      return Promise.resolve(new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  return { asked, restore: () => { globalThis.fetch = real; } };
}

// Runs the handler under mocked setTimeout/Date, advancing the clock 100 ms at a time.
async function timed(body) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    let done = false;
    const pending = handlePowerIntelligence(new Request('https://acresx.test/api/power-intelligence', { method: 'POST', body: JSON.stringify(body) }))
      .then(async response => { done = true; return { status: response.status, body: await response.json(), timing: response.headers.get('Server-Timing') }; });
    let elapsed = 0;
    while (!done && elapsed < 60000) {
      for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
      if (done) break;
      mock.timers.tick(100);
      elapsed += 100;
    }
    assert.ok(done, 'the route answered');
    return { ...(await pending), elapsed };
  } finally {
    mock.timers.reset();
  }
}

test('Overpass hangs: an Avista parcel still answers within the budget, with the distance from Avista\'s own map', async () => {
  const stub = stubFetch();
  try {
    const { status, body, elapsed } = await timed({ providers: ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE'], providerRanking: { basis: 'avista_line_nearby', resolved: false, note: 'n' }, ...point, geometry: outline });
    assert.equal(status, 200);
    // Overpass gets only its short cap (it never answers Cloudflare; the browser fallback covers
    // it), and the hanging HIFLD its own 4 s: the answer comes back after 4 s, not the 9 s it
    // used to wait for Overpass.
    assert.equal(OVERPASS_SERVER_CAP_MS, 1500);
    assert.equal(POWER_BUDGET_MS, 6000);
    assert.ok(elapsed >= 3900 && elapsed <= 4500, `answered after ${elapsed} ms`);
    assert.equal(body.provider, 'AVISTA CORP');
    assert.equal(body.proximity.status, 'timed_out');
    assert.match(body.proximity.note, /^Distance not verified/);
    assert.equal(body.distribution.status, 'utility_published_proximity');
    assert.ok(Number.isFinite(body.distribution.estimatedDistanceFt) && body.distribution.estimatedDistanceFt < 330);
    assert.equal(body.distribution.infrastructure, 'utility_distribution_line');
    // The open overlap is passed through and the territory is not confirmed (score 70, not 78).
    assert.deepEqual(body.alsoListed, ['KOOTENAI ELECTRIC COOPERATIVE']);
    assert.equal(body.territory.confirmed, false);
    assert.equal(body.territory.basis, 'n');
    // One Overpass endpoint fits in the cap (the second is not tried), plus HIFLD (services2) and Avista (services3).
    assert.deepEqual([...new Set(stub.asked)].sort(), ['overpass-api.de', 'services2.arcgis.com', 'services3.arcgis.com']);
    assert.match(body.proximity.error, /Overpass timed out after 1\.5s/);
  } finally { stub.restore(); }
});

test('every source hangs: the answer still comes back by the budget, as "distance not verified"', async () => {
  const stub = stubFetch({ avista: 'hang' });
  try {
    const { status, body, elapsed } = await timed({ providers: ['AVISTA CORP'], ...point, geometry: outline });
    assert.equal(status, 200);
    assert.ok(elapsed <= POWER_BUDGET_MS + 200, `answered after ${elapsed} ms`);
    assert.equal(body.proximity.status, 'timed_out');
    assert.equal(body.distribution.estimatedDistanceFt, null);
    assert.match(body.distribution.note, /Distance not verified/);
    // A single provider keeps the adapter's confirmed territory.
    assert.equal(body.territory.confirmed, true);
  } finally { stub.restore(); }
});

test('Overpass hangs for a NorthWestern (generic adapter) parcel: answered in time, distance not verified', async () => {
  const stub = stubFetch();
  try {
    const { body, elapsed } = await timed({ providers: ['NORTHWESTERN ENERGY LLC - (MT)'], lat: 45.68, lon: -111.04 });
    assert.ok(elapsed <= POWER_BUDGET_MS + 200, `answered after ${elapsed} ms`);
    assert.equal(body.adapter, 'generic-v2-osm');
    assert.equal(body.distribution.status, 'no_verified_distance');
    assert.match(body.distribution.note, /^Distance not verified/);
    assert.ok(!stub.asked.includes('services3.arcgis.com'), "Avista's map is not asked for another utility");
  } finally { stub.restore(); }
});

test('wholesale names are skipped (BPA first in the raw list), and a resolved ranking keeps the territory confirmed', async () => {
  const stub = stubFetch();
  try {
    const inland = await timed({ providers: ['BONNEVILLE POWER ADMINISTRATION', 'INLAND POWER & LIGHT COMPANY'], ...point });
    assert.equal(inland.body.provider, 'INLAND POWER & LIGHT COMPANY');
    assert.deepEqual(inland.body.alsoListed, []);
    assert.equal(inland.body.distribution.status, 'no_verified_distance');
    const resolved = await timed({ providers: ['NORTHWESTERN ENERGY LLC - (MT)', 'PARK ELECTRIC COOP INC'], providerRanking: { basis: 'x', resolved: true }, lat: 45.68, lon: -111.04 });
    assert.equal(resolved.body.territory.confirmed, true);
    assert.deepEqual(resolved.body.alsoListed, ['PARK ELECTRIC COOP INC']);
  } finally { stub.restore(); }
});

test('the territory label names the parcel state (it said "Washington" for Idaho and Montana)', async () => {
  const stub = stubFetch();
  try {
    const avistaIdaho = await timed({ state: 'ID', providers: ['AVISTA CORP'], ...point });
    assert.equal(avistaIdaho.body.territory.basis, 'Idaho electric utility service-territory screening');
    const avistaWa = await timed({ state: 'WA', providers: ['AVISTA CORP'], lat: 47.66, lon: -117.41 });
    assert.equal(avistaWa.body.territory.basis, 'Washington electric utility service-territory screening');
    const montana = await timed({ state: 'MT', providers: ['NORTHWESTERN ENERGY LLC - (MT)'], lat: 45.68, lon: -111.04 });
    assert.equal(montana.body.adapter, 'generic-v2-osm');
    assert.equal(montana.body.territory.basis, 'Montana electric utility service-territory screening');
    const idahoCoop = await timed({ state: 'id', providers: ['KOOTENAI ELECTRIC COOPERATIVE'], ...point });
    assert.equal(idahoCoop.body.territory.basis, 'Idaho electric utility service-territory screening');
    // No state given: no guess.
    const unknown = await timed({ providers: ['NORTHWESTERN ENERGY LLC - (MT)'], lat: 45.68, lon: -111.04 });
    assert.equal(unknown.body.territory.basis, 'Electric utility service-territory screening');
  } finally { stub.restore(); }
});

test('Overpass short cap: a hanging Overpass is given up after the cap even when every other source is fast', async () => {
  const stub = stubFetch({ hifld: 'answer' });
  try {
    const { body, elapsed, timing } = await timed({ providers: ['NORTHWESTERN ENERGY LLC - (MT)'], lat: 45.68, lon: -111.04 });
    assert.ok(elapsed >= OVERPASS_SERVER_CAP_MS - 100 && elapsed <= OVERPASS_SERVER_CAP_MS + 500, `answered after ${elapsed} ms`);
    assert.equal(body.proximity.status, 'timed_out');
    // The browser is asked to load OpenStreetMap itself (public/browser-fallback.js osm-power).
    assert.equal(body.fallback?.kind, 'osm-power');
    // Per-source timings ride in the Server-Timing header, never in the body.
    assert.match(timing, /osm;dur=\d+/);
    assert.match(timing, /total;dur=\d+/);
    assert.equal(body.timing, undefined);
  } finally { stub.restore(); }
});

test('answers are cached under a versioned prefix: a repeat lookup is answered from the cache without asking any source', async () => {
  const realCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit ? new Response(hit.body, { headers: { 'Cache-Control': hit.cc } }) : undefined; },
    async put(req, res) { store.set(req.url, { body: await res.text(), cc: res.headers.get('Cache-Control') }); }
  } };
  const stub = stubFetch({ hifld: 'answer' });
  try {
    const request = { providers: ['AVISTA CORP'], ...point, geometry: outline };
    const first = await timed(request);
    assert.equal(first.body.distribution.status, 'utility_published_proximity');
    assert.equal(first.body.answerCache, undefined);
    assert.equal(store.size, 1);
    const [[key, entry]] = [...store.entries()];
    assert.ok(key.startsWith(POWER_ANSWER_CACHE_PREFIX), key);
    assert.match(POWER_ANSWER_CACHE_PREFIX, /\/v\d+\/$/);
    // OpenStreetMap did not answer: kept for a day only.
    assert.equal(entry.cc, `public, max-age=${POWER_ANSWER_PARTIAL_TTL_SECONDS}`);
    const askedBefore = stub.asked.length;
    const second = await timed(request);
    assert.equal(stub.asked.length, askedBefore, 'no upstream request on a cache hit');
    assert.equal(second.body.answerCache.hit, true);
    assert.equal(second.body.distribution.estimatedDistanceFt, first.body.distribution.estimatedDistanceFt);
    assert.equal(second.timing, 'cache;desc=hit');
    // A different parcel (another outline) is not served from that entry.
    const other = await timed({ ...request, geometry: { ...outline, coordinates: [outline.coordinates[0].map(([x, y]) => [x + 0.001, y])] } });
    assert.equal(other.body.answerCache, undefined);
  } finally { stub.restore(); globalThis.caches = realCaches; }
});

test('an answer whose utility map timed out is not cached', async () => {
  const realCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = { default: { async match(req) { const hit = store.get(req.url); return hit ? new Response(hit) : undefined; }, async put(req, res) { store.set(req.url, await res.text()); } } };
  const stub = stubFetch({ avista: 'hang', hifld: 'answer' });
  try {
    const { body, elapsed } = await timed({ providers: ['AVISTA CORP'], ...point, geometry: outline });
    assert.ok(elapsed <= POWER_BUDGET_MS + 200, `answered after ${elapsed} ms`);
    assert.equal(body.distribution.estimatedDistanceFt, null);
    assert.equal(store.size, 0);
  } finally { stub.restore(); globalThis.caches = realCaches; }
});
