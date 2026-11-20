// /api/utility-territory never marks a failed lookup cacheable, and keeps an empty ("no mapped
// territory") answer for 5 minutes at most (2026-11-20: Stevens 0434200 once showed "Utility
// territory not identified" in the browser while 15/15 direct calls and 4/4 page loads named
// AVISTA CORP). The route has no cache of its own; these are the headers it sends. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleUtilityTerritory, EMPTY_ANSWER_CACHE } from '../src/services/utility-territory.js';
import { configureUpstream } from '../src/shared/upstream.js';

const post = body => new Request('https://acresx.test/api/utility-territory', { method: 'POST', body: JSON.stringify(body) });
// Montana point: outside Avista's layer, so HIFLD is the only request.
const MT = { state: 'MT', county: 'Gallatin', lat: 45.68, lon: -111.04 };

async function withHifld(answer, fn) {
  const real = globalThis.fetch;
  const restore = configureUpstream({ backoffMs: 0 });
  globalThis.fetch = async () => answer();
  try { return await fn(); } finally { globalThis.fetch = real; restore?.(); }
}
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('a failed HIFLD lookup is answered no-store', async () => {
  for (const answer of [() => new Response('down', { status: 503 }), () => ok({ error: { code: 500, message: 'Unable to complete operation.' } })]) {
    const res = await withHifld(answer, () => handleUtilityTerritory(post(MT)));
    const body = await res.json();
    assert.equal(body.available, false);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
});

test('an empty answer is kept 5 minutes at most; a named territory keeps the long cache', async () => {
  const empty = await withHifld(() => ok({ features: [] }), () => handleUtilityTerritory(post(MT)));
  assert.deepEqual((await empty.json()).providers, []);
  assert.equal(empty.headers.get('Cache-Control'), EMPTY_ANSWER_CACHE);
  assert.match(EMPTY_ANSWER_CACHE, /max-age=300\b/);
  const named = await withHifld(() => ok({ features: [{ attributes: { NAME: 'NORTHWESTERN ENERGY LLC - (MT)', TYPE: 'INVESTOR OWNED', STATE: 'MT' } }] }), () => handleUtilityTerritory(post(MT)));
  assert.deepEqual((await named.json()).providers, ['NORTHWESTERN ENERGY LLC - (MT)']);
  assert.equal(named.headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=86400');
});
