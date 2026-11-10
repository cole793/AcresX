// /api/power-intelligence answers within its time box when a source hangs, offline, with mocked
// timers. Before: Overpass was asked one endpoint after the other at 18 s each, so a hanging
// Overpass held the answer for 36 s (past the browser's 15 s and the validator's 30 s).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePowerIntelligence, POWER_BUDGET_MS } from '../src/services/power-intelligence.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/utility-territory-ranking.json', import.meta.url), 'utf8'));
const cda = FIXTURE.cases['kootenai-cda-city'];
// Avista's answer for the 330 ft ring at the Coeur d'Alene city point (25 sections).
const avista330 = cda.requests.find(r => r.url.includes('/DER_Hosting_Capacity_PRD/') && r.url.includes('distance=330&')).body;
const point = { lat: cda.case.lat, lon: cda.case.lon };
const outline = { type: 'Polygon', coordinates: [[[point.lon - 0.0002, point.lat - 0.0002], [point.lon + 0.0002, point.lat - 0.0002], [point.lon + 0.0002, point.lat + 0.0002], [point.lon - 0.0002, point.lat + 0.0002], [point.lon - 0.0002, point.lat - 0.0002]]] };

// Overpass never answers (it only gives up when the request is aborted); Avista's map answers.
function stubFetch({ avista = 'answer' } = {}) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.hostname);
    if (url.pathname.includes('/DER_Hosting_Capacity_PRD/')) {
      if (avista === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      return Promise.resolve(new Response(JSON.stringify(avista330), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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
      .then(async response => { done = true; return { status: response.status, body: await response.json() }; });
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
    assert.ok(elapsed <= POWER_BUDGET_MS + 200, `answered after ${elapsed} ms`);
    assert.ok(elapsed >= 5000, 'it waited for Overpass first');
    assert.equal(POWER_BUDGET_MS, 9000);
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
    // Both Overpass endpoints were tried inside the budget.
    assert.deepEqual([...new Set(stub.asked)].sort(), ['overpass-api.de', 'overpass.private.coffee', 'services3.arcgis.com']);
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
