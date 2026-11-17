// Offline tests for the soil answer cache (src/services/soils.js): a USDA Soil Data Access answer
// is kept 30 days, an Esri SSURGO backup answer 1 day under its own prefix, and failures never.
// caches.default and fetch are stubbed; no network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import {
  soilAt, ESRI_SSURGO_LAYER, SDA_SOURCE, SOIL_BACKUP_SOURCE,
  SOIL_CACHE_PREFIX, SOIL_CACHE_TTL_SECONDS, SOIL_BACKUP_CACHE_PREFIX, SOIL_BACKUP_CACHE_TTL_SECONDS
} from '../src/services/soils.js';

const backupFixture = JSON.parse(readFileSync(new URL('./fixtures/esri-ssurgo-spokane-23123.9051.json', import.meta.url), 'utf8'));
const sdaTable = { Table: [['mukey', 'muname', 'compname', 'comppct_r', 'drainagecl', 'hydgrp', 'slope_r'], ['85981', 'Stutler-Springdale complex, 3 to 15 percent slopes', 'Stutler', '55', 'Well drained', 'B', '4']] };
const CENTER = [-117.44865899017529, 47.49467375246862];

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls, restore, store;
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const badGateway = () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
const isSda = url => url.startsWith('https://sdmdataaccess.sc.egov.usda.gov/');
const isBackup = url => url.startsWith(`${ESRI_SSURGO_LAYER}/query`);
const count = pred => calls.filter(url => pred(url)).length;
function stubFetch({ sda, backup }) {
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (isSda(url)) return sda();
    if (isBackup(url)) return backup();
    return new Response('down', { status: 503 });
  };
}
function fakeCache({ throws = false } = {}) {
  store = new Map();
  globalThis.caches = { default: {
    async match(req) { if (throws) throw new Error('cache down'); const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { if (throws) throw new Error('cache down'); store.set(req.url, res.clone()); }
  } };
}
const keys = prefix => [...store.keys()].filter(k => k.startsWith(prefix));
const maxAge = key => Number(/max-age=(\d+)/.exec(store.get(key).headers.get('Cache-Control'))[1]);

beforeEach(() => { calls = []; restore = configureUpstream({ backoffMs: 0, log: () => {} }); fakeCache(); });
afterEach(() => {
  restore();
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
});

test('soil cache: an SDA answer is kept 30 days and reused for the same (rounded) point', async () => {
  stubFetch({ sda: () => jsonResponse(sdaTable), backup: () => { throw new Error('backup must not be called'); } });
  const first = await soilAt(...CENTER);
  assert.equal(first.source, SDA_SOURCE);
  assert.equal(keys(SOIL_CACHE_PREFIX).length, 1);
  assert.equal(keys(SOIL_BACKUP_CACHE_PREFIX).length, 0);
  assert.equal(maxAge(keys(SOIL_CACHE_PREFIX)[0]), SOIL_CACHE_TTL_SECONDS);
  assert.equal(SOIL_CACHE_TTL_SECONDS, 30 * 24 * 60 * 60);

  calls = [];
  assert.deepEqual(await soilAt(...CENTER), first);
  assert.deepEqual(await soilAt(CENTER[0] + 2e-6, CENTER[1] - 2e-6), first, 'under 1 m away: same key');
  assert.equal(calls.length, 0, 'cache hits make no request');

  await soilAt(CENTER[0] + 1e-3, CENTER[1]);
  assert.equal(count(isSda), 1, 'a different point asks SDA');
  assert.equal(keys(SOIL_CACHE_PREFIX).length, 2);
});

test('soil cache: SDA failures are never cached ("no map unit", 4xx, outage with the backup down)', async () => {
  stubFetch({ sda: () => jsonResponse({}), backup: () => jsonResponse(backupFixture) });
  await assert.rejects(soilAt(...CENTER), /No USDA soil map unit was returned/);
  stubFetch({ sda: () => jsonResponse({ Message: 'Invalid query' }, 400), backup: () => jsonResponse(backupFixture) });
  await assert.rejects(soilAt(...CENTER), /USDA soil service returned 400/);
  stubFetch({ sda: badGateway, backup: badGateway });
  await assert.rejects(soilAt(...CENTER), /backup \(Esri SSURGO copy\)/);
  stubFetch({ sda: badGateway, backup: () => jsonResponse({ features: [] }) });
  await assert.rejects(soilAt(...CENTER), /No SSURGO map unit was returned/);
  assert.equal(store.size, 0);
});

test('soil cache: a backup answer is kept 1 day under its own prefix; SDA is still asked first', async () => {
  stubFetch({ sda: badGateway, backup: () => jsonResponse(backupFixture) });
  const first = await soilAt(...CENTER);
  assert.equal(first.source, SOIL_BACKUP_SOURCE);
  assert.equal(keys(SOIL_CACHE_PREFIX).length, 0, 'a backup answer never goes in the 30-day SDA cache');
  assert.equal(keys(SOIL_BACKUP_CACHE_PREFIX).length, 1);
  assert.equal(maxAge(keys(SOIL_BACKUP_CACHE_PREFIX)[0]), SOIL_BACKUP_CACHE_TTL_SECONDS);
  assert.equal(SOIL_BACKUP_CACHE_TTL_SECONDS, 24 * 60 * 60);

  // Still down: SDA is asked again (and retried), the backup comes from the cache.
  calls = [];
  const again = await soilAt(...CENTER);
  assert.equal(again.backup, true);
  assert.equal(again.septicRating, first.septicRating);
  assert.equal(count(isSda), 2);
  assert.equal(count(isBackup), 0, 'backup answer served from the cache');

  // SDA recovers: its answer shows at once and is cached for 30 days.
  calls = [];
  stubFetch({ sda: () => jsonResponse(sdaTable), backup: () => { throw new Error('backup must not be called'); } });
  const recovered = await soilAt(...CENTER);
  assert.equal(recovered.source, SDA_SOURCE);
  assert.equal(recovered.backup, undefined);
  assert.equal(keys(SOIL_CACHE_PREFIX).length, 1);
});

test('soil cache: a cache that throws does not fail the lookup', async () => {
  fakeCache({ throws: true });
  stubFetch({ sda: () => jsonResponse(sdaTable), backup: () => jsonResponse(backupFixture) });
  assert.equal((await soilAt(...CENTER)).source, SDA_SOURCE);
  stubFetch({ sda: badGateway, backup: () => jsonResponse(backupFixture) });
  assert.equal((await soilAt(...CENTER)).backup, true);
});
