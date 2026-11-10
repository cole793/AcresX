// Offline tests for POST /api/public-utilities (src/services/public-utilities.js and the county
// tables in src/counties/*-utilities.js). Recorded live answers (test/fixtures/
// public-utilities-<county>-<parcel>.json, 2026-11-09, named non-contact fields only) replay
// through a stubbed fetch; nothing touches a county, city or state server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import {
  lookupPublicUtilities, distanceToParcelM, mainsFinding, countyConfig, COUNTY_UTILITIES, SERVED_MAX_M, LIKELY_MAX_M, PUBLIC_UTILITIES_CACHE_PREFIX
} from '../src/services/public-utilities.js';

const fixtureDir = new URL('./fixtures/', import.meta.url);
const fixture = name => JSON.parse(readFileSync(new URL(`public-utilities-${name}.json`, fixtureDir), 'utf8'));
const FIXTURES = readdirSync(fixtureDir).filter(f => f.startsWith('public-utilities-')).map(f => f.replace(/^public-utilities-|\.json$/g, ''));

let restore;
const realFetch = globalThis.fetch;
before(() => { restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restore(); globalThis.fetch = realFetch; });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function paramsOf(input, init) {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const p = new URLSearchParams(url.search);
  if (typeof init?.body === 'string') for (const [k, v] of new URLSearchParams(init.body)) p.set(k, v);
  return { url, p, layer: `${url.origin}${url.pathname}` };
}

// Replays a fixture; `override(layer)` may return a Response to send instead (failures).
function replay(fx, { override } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const { p, layer } = paramsOf(input, init);
    calls.push({ layer, outFields: p.get('outFields'), where: p.get('where'), distance: p.get('distance') });
    const forced = override?.(layer);
    if (forced) return forced;
    const hit = fx.responses.find(r => r.url === layer);
    if (!hit) throw new Error(`no recorded answer for ${layer}`);
    return json(hit.body, hit.status);
  };
  return calls;
}
const run = fx => lookupPublicUtilities(fx.request);

// ---- Recorded parcels

test('every recorded parcel gives the statuses it gave live', async () => {
  assert.ok(FIXTURES.length >= 8, `found ${FIXTURES.length} fixtures`);
  for (const name of FIXTURES) {
    const fx = fixture(name);
    replay(fx);
    const r = await run(fx);
    assert.equal(r.water.status, fx.expected.water, `${name} water`);
    assert.equal(r.sewer.status, fx.expected.sewer, `${name} sewer`);
    assert.equal(r.water.provider, fx.expected.waterProvider, `${name} water provider`);
    assert.ok(r.sources.every(s => s.ok), `${name}: every layer answered`);
  }
});

test("Coeur d'Alene C72150030040: water served (CDA Water area, main 13 m), sewer served (main 7 m)", async () => {
  const fx = fixture('kootenai-C72150030040');
  replay(fx);
  const r = await run(fx);
  assert.equal(r.water.status, 'served');
  assert.equal(r.water.distanceM, 13);
  assert.match(r.water.provider, /Coeur d'Alene/);
  assert.ok(r.water.others.some(o => o.provider === 'CDA Water' && o.status === 'served'), 'the water-district polygon is kept as a second source');
  assert.equal(r.sewer.status, 'served');
  assert.equal(r.sewer.distanceM, 7);
  assert.match(r.sewer.basis, /^City of Coeur d'Alene sewer main 7 m from the parcel$/);
  assert.equal(r.sewer.source.url, 'https://gis.cdaid.org/server/rest/services/CityUtilities/Public_Wastewater/MapServer/3');
});

test('rural Kootenai 0L8210010030 and rural Spokane 43341.0110: not_found for both, naming what was checked', async () => {
  for (const name of ['kootenai-0L8210010030', 'spokane-43341.0110']) {
    const fx = fixture(name);
    replay(fx);
    const r = await run(fx);
    assert.equal(r.water.status, 'not_found');
    assert.equal(r.sewer.status, 'not_found');
    assert.match(r.sewer.basis, /^No public sewer service area, district or main found near the parcel \(checked: /);
  }
});

test('City of Spokane 35204.2729: served by city mains (7 m water, 9 m sewer)', async () => {
  const fx = fixture('spokane-35204.2729');
  replay(fx);
  const r = await run(fx);
  assert.deepEqual([r.water.status, r.water.distanceM, r.water.provider], ['served', 7, 'City of Spokane']);
  assert.deepEqual([r.sewer.status, r.sewer.distanceM, r.sewer.provider], ['served', 9, 'City of Spokane']);
});

test('Spokane Valley 35234.0602: water served by the county district layer (DOH row is Inactive); sewer only likely from the 2021 county map', async () => {
  const fx = fixture('spokane-35234.0602');
  replay(fx);
  const r = await run(fx);
  assert.equal(r.water.status, 'served');
  assert.equal(r.water.provider, 'Spokane County Water District #3 System #1');
  assert.equal(r.sewer.status, 'likely', 'a main 5 m away on a 2021 map is capped at likely');
  assert.equal(r.sewer.distanceM, 5);
  assert.equal(r.sewer.asOf, '2021-10-12');
  assert.match(r.sewer.basis, /map as of 2021-10-12; older map, so not counted as served/);
});

test('independent services: Colville has public water (DOH) but sewer only from city limits; Billings is likely for both', async () => {
  let fx = fixture('stevens-0000500');
  replay(fx);
  let r = await run(fx);
  assert.equal(r.water.status, 'served');
  assert.equal(r.water.provider, 'Colville Water Department');
  assert.equal(r.water.asOf, '2008-07-09');
  assert.equal(r.sewer.status, 'likely');
  assert.equal(r.sewer.basis, 'inside City of Colville limits; no sewer utility map published');
  fx = fixture('yellowstone-03103233201230000');
  replay(fx);
  r = await run(fx);
  assert.deepEqual([r.water.status, r.sewer.status, r.water.provider], ['likely', 'likely', 'City of Billings']);
});

// ---- Status tiers and distance thresholds (synthetic geometry)

// A 50 m x 50 m parcel near 47.7 N and a main running north-south `offsetM` east of it.
const LAT = 47.7, LON = -116.8, M_LON = 1 / (111320 * Math.cos(LAT * Math.PI / 180)), M_LAT = 1 / 110540;
const square = [[LON, LAT], [LON + 50 * M_LON, LAT], [LON + 50 * M_LON, LAT + 50 * M_LAT], [LON, LAT + 50 * M_LAT], [LON, LAT]];
const mainAt = offsetM => ({ attributes: {}, geometry: { paths: [[[LON + (50 + offsetM) * M_LON, LAT - 0.001], [LON + (50 + offsetM) * M_LON, LAT + 0.001]]] } });
const SOURCE = { services: ['sewer'], provider: 'Test City', mainLabel: 'Test City sewer main', name: 'Test mains', url: 'https://example.test/0' };

test('distance is measured from the parcel outline: 0 inside or crossing, metres outside', () => {
  const target = { rings: [square] };
  assert.equal(distanceToParcelM(mainAt(-25).geometry.paths, target), 0, 'a main through the parcel');
  assert.ok(Math.abs(distanceToParcelM(mainAt(12).geometry.paths, target) - 12) < 0.5);
  assert.ok(Math.abs(distanceToParcelM(mainAt(80).geometry.paths, target) - 80) < 0.5);
  // From the center point the same main would read 25 m farther: the outline is what counts.
  const center = { point: [LON + 25 * M_LON, LAT + 25 * M_LAT] };
  assert.ok(Math.abs(distanceToParcelM(mainAt(12).geometry.paths, center) - 37) < 0.5);
});

test(`mains: served within ${SERVED_MAX_M} m, likely to ${LIKELY_MAX_M} m, nothing beyond`, () => {
  const target = { rings: [square] };
  const at = d => mainsFinding(SOURCE, [mainAt(d)], target);
  assert.equal(at(10)[0].status, 'served');
  assert.equal(at(29)[0].status, 'served');
  assert.equal(at(31)[0].status, 'likely');
  assert.equal(at(99)[0].status, 'likely');
  assert.equal(at(31)[0].distanceM, 31);
  assert.deepEqual(at(101), []);
  assert.deepEqual(mainsFinding(SOURCE, [mainAt(150), mainAt(20)], target).map(f => f.distanceM), [20], 'the nearest main decides');
  assert.equal(mainsFinding({ ...SOURCE, maxStatus: 'likely', asOf: '2021-10-12' }, [mainAt(5)], target)[0].status, 'likely');
});

// A one-layer-per-service county to drive the decision rules directly.
const TIER_CONFIG = {
  state: 'WA', county: 'Test',
  sources: [
    { id: 'area', name: 'Water areas', url: 'https://example.test/area/0', services: ['water'], kind: 'area', outFields: 'NAME', read: rows => rows.map(a => ({ service: 'water', status: 'served', provider: a.NAME, basis: `inside ${a.NAME}` })) },
    { id: 'mains', name: 'Sewer mains', url: 'https://example.test/mains/0', services: ['sewer'], kind: 'mains', outFields: 'ID', provider: 'Test City', mainLabel: 'Test City sewer main' },
    { id: 'limits', name: 'City limits', url: 'https://example.test/limits/0', services: ['water', 'sewer'], kind: 'area', outFields: 'CITY', read: rows => rows.flatMap(a => (a.CITY ? [{ service: 'sewer', status: 'likely', provider: a.CITY, basis: `inside ${a.CITY} limits; no sewer utility map published` }] : [])) }
  ]
};
function tierFetch({ area = [], mains = [], limits = [], fail = [] }) {
  globalThis.fetch = async (input, init) => {
    const { layer } = paramsOf(input, init);
    const id = /example\.test\/(\w+)\//.exec(layer)?.[1];
    if (fail.includes(id)) return json({ error: 'down' }, 503);
    return json({ features: { area, mains, limits }[id] });
  };
}
const tier = () => lookupPublicUtilities({ state: 'WA', county: 'Test', lat: LAT, lon: LON, geometry: { type: 'Polygon', coordinates: [square] } }, { config: TIER_CONFIG });

test('each status tier: served, likely, not_found, unavailable', async () => {
  tierFetch({ area: [{ attributes: { NAME: 'Test Water District' } }], mains: [mainAt(10)] });
  let r = await tier();
  assert.deepEqual([r.water.status, r.sewer.status], ['served', 'served']);
  tierFetch({ mains: [mainAt(60)] });
  r = await tier();
  assert.deepEqual([r.water.status, r.sewer.status, r.sewer.distanceM], ['not_found', 'likely', 60]);
  tierFetch({ limits: [{ attributes: { CITY: 'City of Test' } }] });
  r = await tier();
  assert.equal(r.sewer.status, 'likely');
  assert.equal(r.sewer.basis, 'inside City of Test limits; no sewer utility map published');
  tierFetch({});
  r = await tier();
  assert.deepEqual([r.water.status, r.sewer.status], ['not_found', 'not_found']);
  tierFetch({ fail: ['mains'] });
  r = await tier();
  assert.equal(r.sewer.status, 'unavailable');
  assert.match(r.sewer.basis, /Sewer mains did not answer/);
  assert.equal(r.water.status, 'not_found', 'water does not depend on the sewer layer');
});

test('a failed layer degrades only its service; a served answer stays served but is marked incomplete', async () => {
  const fx = fixture('kootenai-C72150030040');
  replay(fx, { override: layer => (layer.includes('Public_Wastewater') ? json({ error: { code: 500, message: 'Server down' } }) : null) });
  let r = await run(fx);
  assert.equal(r.water.status, 'served');
  assert.equal(r.water.incomplete, undefined);
  assert.equal(r.sewer.status, 'unavailable', "CdA is decided by its own sewer map, so city limits alone do not say likely");
  assert.equal(r.sources.find(s => s.id === 'cda-sewer-pipes').ok, false);
  replay(fx, { override: layer => (layer.includes('MapServer/11') ? new Response('bad gateway', { status: 502 }) : null) });
  r = await run(fx);
  assert.equal(r.water.status, 'served', 'the water main still answers');
  assert.equal(r.water.incomplete, true);
});

// ---- Route, caching and request hygiene

const post = body => new Request('https://acresx.test/api/public-utilities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('route: 400 without a point; unsupported counties answer unavailable for both', async () => {
  globalThis.fetch = async () => { throw new Error('no network'); };
  let res = await worker.fetch(post({ state: 'WA', county: 'Spokane' }), {}, {});
  assert.equal(res.status, 400);
  res = await worker.fetch(post({ state: 'ID', county: 'Ada', lat: 43.6, lon: -116.2 }), {}, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, false);
  assert.deepEqual([body.water.status, body.sewer.status], ['unavailable', 'unavailable']);
});

test('only fully answered lookups are cached; a partial one is not', async () => {
  const store = new Map(), realCaches = globalThis.caches;
  globalThis.caches = { default: { async match(req) { const t = store.get(req.url); return t ? new Response(t) : undefined; }, async put(req, res) { store.set(req.url, await res.text()); } } };
  try {
    const fx = fixture('kootenai-C72150030040');
    replay(fx, { override: layer => (layer.includes('Gravity_Mains') ? json({ error: { code: 500, message: 'down' } }) : null) });
    let res = await worker.fetch(post(fx.request), {}, {});
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(store.size, 0, 'partial answer not cached');
    const calls = replay(fx);
    res = await worker.fetch(post(fx.request), {}, {});
    assert.equal((await res.json()).sewer.status, 'served');
    assert.equal(store.size, 1);
    assert.ok([...store.keys()][0].startsWith(PUBLIC_UTILITIES_CACHE_PREFIX));
    const before = calls.length;
    res = await worker.fetch(post(fx.request), {}, {});
    assert.equal((await res.json()).water.status, 'served');
    assert.equal(calls.length, before, 'second lookup served from cache');
  } finally {
    if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
  }
});

// Contact, owner and address fields the utility layers carry (WA DOH, Post Falls purveyors).
const CONTACT = /contact|phone|e_?mail|owner|addr|mail|agencyurl|_city$|_zip$|_state$/i;

test('privacy: every layer is asked for named, non-contact fields only, and stays under the subrequest budget', async () => {
  for (const [key, config] of Object.entries(COUNTY_UTILITIES)) {
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const { p, layer } = paramsOf(input, init);
      calls.push({ layer, outFields: p.get('outFields') });
      // Answer with the contact fields the real layers hold; none may reach the answer.
      return json({ features: [{ attributes: { WS_Name: 'TEST CITY OF', WS_Grp: 'A', WS_Type: 'Comm', WS_Status: 'Active', Contact_F_Name: 'PLACEHOLDER', Contact_Phone: '000', EMailAddr: 'x@example.test', OwnerID: 'PLACEHOLDER', Email: 'x@example.test', Phone: '000', NAME: 'Test' } }] });
    };
    const [state] = key.split(':');
    const r = await lookupPublicUtilities({ state, county: config.county, lat: LAT, lon: LON, geometry: { type: 'Polygon', coordinates: [square] } });
    assert.equal(calls.length, config.sources.length, `${key}: one request per layer`);
    assert.ok(calls.length <= 8, `${key}: ${calls.length} layers`);
    for (const c of calls) {
      assert.ok(c.outFields && c.outFields !== '*', `${c.layer}: named outFields`);
      const bad = c.outFields.split(',').filter(f => CONTACT.test(f));
      assert.deepEqual(bad, [], `${c.layer}: no contact or owner fields requested`);
    }
    assert.doesNotMatch(JSON.stringify(r), /PLACEHOLDER|example\.test|Contact_|EMailAddr|OwnerID/, `${key}: no contact data in the answer`);
  }
});

test('county lookup is case-insensitive and accepts "County"', () => {
  assert.equal(countyConfig('wa', 'spokane county').county, 'Spokane');
  assert.equal(countyConfig('ID', 'Kootenai').county, 'Kootenai');
  assert.equal(countyConfig('ID', 'Ada'), null);
});
