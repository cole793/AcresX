// Electric provider ranking for overlapping HIFLD territories (src/services/provider-ranking.js)
// through /api/utility-territory, offline. globalThis.fetch replays the live HIFLD and Avista
// distribution-map answers recorded 2026-11-10 (test/fixtures/utility-territory-ranking.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleUtilityTerritory } from '../src/services/utility-territory.js';
import { rankProviders } from '../src/services/provider-ranking.js';
import { nearestDistanceFt, inAvistaLayerExtent } from '../src/utilities/avista-distribution.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/utility-territory-ranking.json', import.meta.url), 'utf8'));

async function territory(name, { avistaDown = false } = {}) {
  const { case: c, requests } = FIXTURE.cases[name];
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (avistaDown && url.includes('/DER_Hosting_Capacity_PRD/')) return new Response('busy', { status: 503 });
    const hit = requests.find(r => r.url === url);
    if (!hit) throw new Error(`unrecorded request ${url}`);
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await handleUtilityTerritory(new Request('https://acresx.test/api/utility-territory', { method: 'POST', body: JSON.stringify({ state: c.state, county: c.county, lat: c.lat, lon: c.lon }) }));
    return { status: response.status, body: await response.json(), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("Coeur d'Alene city overlap: Avista primary (Avista line 127 ft away), Kootenai Electric also listed, not resolved", async () => {
  const { status, body } = await territory('kootenai-cda-city');
  assert.equal(status, 200);
  assert.deepEqual(body.providers, ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE']);
  assert.equal(body.primary.name, 'AVISTA CORP');
  assert.equal(body.primary.basis, 'avista_line_nearby');
  assert.equal(body.primary.resolved, false);
  assert.equal(body.primary.evidence.nearestAvistaLineFt, 127);
  assert.deepEqual(body.alsoListed, ['KOOTENAI ELECTRIC COOPERATIVE']);
  assert.deepEqual(body.ranked.map(r => [r.name, r.rank]), [['AVISTA CORP', 1], ['KOOTENAI ELECTRIC COOPERATIVE', 2]]);
  assert.match(body.primary.note, /^Avista is most likely/);
  assert.match(body.primary.note, /Idaho Code 61-332C/);
  assert.match(body.primary.note, /KOOTENAI ELECTRIC COOPERATIVE also has mapped territory here — confirm with both\.$/);
  // The old fields keep their shape.
  assert.equal(body.available, true);
  assert.equal(body.source, 'DOE / ORNL HIFLD Electric Retail Service Territories');
  assert.equal(body.matches.length, 2);
});

test('C72150030040 (5811 N Christopher Dr, north Coeur d\'Alene): no Avista line within 1,320 ft, so Kootenai Electric is listed first and Avista second', async () => {
  const { body } = await territory('kootenai-C72150030040');
  assert.deepEqual(body.providers, ['KOOTENAI ELECTRIC COOPERATIVE', 'AVISTA CORP']);
  assert.equal(body.primary.basis, 'avista_line_not_nearby');
  assert.equal(body.primary.resolved, false);
  assert.equal(body.primary.evidence.nearestAvistaLineFt, null);
  assert.equal(body.primary.evidence.searchedFt, 1320);
  assert.match(body.primary.note, /Avista also has mapped territory here — confirm with both\.$/);
});

test('Spokane overlap 43341.0110: Avista line 166 ft away puts Avista before Inland Power; BPA (wholesale) goes last', async () => {
  const { body } = await territory('spokane-43341.0110');
  assert.deepEqual(body.providers, ['AVISTA CORP', 'INLAND POWER & LIGHT COMPANY', 'BONNEVILLE POWER ADMINISTRATION']);
  assert.equal(body.primary.name, 'AVISTA CORP');
  assert.equal(body.primary.evidence.nearestAvistaLineFt, 166);
  assert.deepEqual(body.alsoListed, ['INLAND POWER & LIGHT COMPANY']);
  assert.deepEqual(body.wholesale, ['BONNEVILLE POWER ADMINISTRATION']);
  assert.match(body.primary.note, /Washington has no nearest-line statute/);
});

test('Spokane overlap 57344.0125 (Newman Lake): no Avista line within 1,320 ft puts Inland Power first', async () => {
  const { body } = await territory('spokane-57344.0125');
  assert.deepEqual(body.providers, ['INLAND POWER & LIGHT COMPANY', 'AVISTA CORP', 'BONNEVILLE POWER ADMINISTRATION']);
  assert.equal(body.primary.basis, 'avista_line_not_nearby');
  assert.match(body.primary.note, /^INLAND POWER & LIGHT COMPANY is more likely/);
});

test('Spokane Valley 35234.0602: HIFLD lists only Inland Power (and BPA), but an Avista line 54 ft away adds Avista first', async () => {
  const { body } = await territory('spokane-35234.0602');
  assert.deepEqual(body.matches.map(m => m.name).sort(), ['BONNEVILLE POWER ADMINISTRATION', 'INLAND POWER & LIGHT COMPANY']);
  assert.deepEqual(body.providers, ['AVISTA CORP', 'INLAND POWER & LIGHT COMPANY', 'BONNEVILLE POWER ADMINISTRATION']);
  assert.equal(body.ranked[0].addedFrom, 'avista_distribution');
  assert.match(body.primary.note, /The federal territory layer lists only INLAND POWER & LIGHT COMPANY here\./);
});

test('single-provider rural parcels are unchanged: Stevens 2342700 (Avista) and Gallatin 06079621201790000 (NorthWestern, no Avista lookup in Montana)', async () => {
  const stevens = await territory('stevens-2342700');
  assert.deepEqual(stevens.body.providers, ['AVISTA CORP']);
  assert.equal(stevens.body.primary.basis, 'single_territory');
  assert.equal(stevens.body.primary.resolved, true);
  assert.deepEqual(stevens.body.alsoListed, []);
  assert.equal(stevens.body.confidence, 'moderate');
  const gallatin = await territory('gallatin-06079621201790000');
  assert.deepEqual(gallatin.body.providers, ['NORTHWESTERN ENERGY LLC - (MT)']);
  assert.equal(gallatin.body.primary.resolved, true);
  assert.equal(gallatin.body.primary.evidence, undefined);
  assert.equal(gallatin.asked.length, 1, 'Montana asks HIFLD only');
});

test('unresolvable overlap (Billings 03103333215010000): NorthWestern and Yellowstone Valley keep the HIFLD order, WAPA last, and the note says the order is not a likelihood', async () => {
  const { body } = await territory('yellowstone-03103333215010000');
  assert.deepEqual(body.providers, ['NORTHWESTERN ENERGY LLC - (MT)', 'YELLOWSTONE VALLEY ELEC CO-OP', 'WAPA-- WESTERN AREA POWER ADMINISTRATION']);
  assert.equal(body.primary.basis, 'unresolved_overlap');
  assert.equal(body.primary.resolved, false);
  assert.match(body.primary.note, /order shown is not a likelihood — confirm with both\.$/);
});

test("Avista's map down: the HIFLD answer still comes back, listed as an unresolved overlap", async () => {
  const { status, body } = await territory('kootenai-cda-city', { avistaDown: true });
  assert.equal(status, 200);
  assert.equal(body.available, true);
  // HIFLD's own order.
  assert.deepEqual(body.providers, body.matches.map(m => m.name));
  assert.equal(body.primary.basis, 'unresolved_overlap');
  assert.equal(body.primary.evidence, undefined);
});

test('rankProviders: the Idaho and Washington wording, dedupe, and Avista with no line nearby while it is the only retail name', () => {
  const near = { available: true, nearestFt: 400, searchedFt: 1320, source: 's', sourceUrl: 'u' };
  const far = { available: true, nearestFt: null, searchedFt: 1320, source: 's', sourceUrl: 'u' };
  const kec = [{ name: 'KOOTENAI ELECTRIC COOPERATIVE', type: 'COOPERATIVE' }, { name: 'AVISTA CORP', type: 'INVESTOR OWNED' }, { name: 'AVISTA CORP', type: 'INVESTOR OWNED' }];
  assert.deepEqual(rankProviders(kec, { avista: near, state: 'ID' }).providers, ['AVISTA CORP', 'KOOTENAI ELECTRIC COOPERATIVE']);
  assert.match(rankProviders(kec, { avista: near, state: 'ID' }).primary.note, /Idaho Code 61-332C gives a new service/);
  // Exactly 1,320 ft still counts as within (61-332C: "within ... 1,320 feet").
  assert.equal(rankProviders(kec, { avista: { ...near, nearestFt: 1320 }, state: 'ID' }).primary.name, 'AVISTA CORP');
  assert.equal(rankProviders(kec, { avista: far, state: 'ID' }).primary.name, 'KOOTENAI ELECTRIC COOPERATIVE');
  const avistaOnly = rankProviders([{ name: 'AVISTA CORP', type: 'INVESTOR OWNED' }], { avista: far, state: 'WA' });
  assert.deepEqual(avistaOnly.providers, ['AVISTA CORP']);
  assert.equal(avistaOnly.primary.basis, 'single_territory');
  // A co-op alone with no Avista line nearby is untouched.
  assert.deepEqual(rankProviders([{ name: 'INLAND POWER & LIGHT COMPANY', type: 'COOPERATIVE' }], { avista: far, state: 'WA' }).providers, ['INLAND POWER & LIGHT COMPANY']);
  // Only wholesale: no primary.
  const bpa = rankProviders([{ name: 'BONNEVILLE POWER ADMINISTRATION', type: 'FEDERAL' }]);
  assert.equal(bpa.primary, null);
  assert.deepEqual(bpa.providers, ['BONNEVILLE POWER ADMINISTRATION']);
  assert.deepEqual(rankProviders([]).providers, []);
});

test('avista-distribution: distance to the nearest section and the layer extent', () => {
  // A section running north-south 0.001 deg (about 245 ft at 47.7 N) east of the point.
  const features = [{ geometry: { paths: [[[-116.779, 47.67], [-116.779, 47.68]]] } }];
  const ft = nearestDistanceFt(features, { lat: 47.675, lon: -116.780 });
  assert.ok(ft > 240 && ft < 250, `about 245 ft, got ${ft}`);
  // Measured from the outline when one is given.
  const outline = { type: 'Polygon', coordinates: [[[-116.7805, 47.674], [-116.7795, 47.674], [-116.7795, 47.676], [-116.7805, 47.676], [-116.7805, 47.674]]] };
  assert.ok(nearestDistanceFt(features, { lat: 47.675, lon: -116.780, geometry: outline }) < 130);
  assert.equal(inAvistaLayerExtent(47.675, -116.78), true);
  assert.equal(inAvistaLayerExtent(45.78, -108.5), false, 'Billings is outside the layer');
});
