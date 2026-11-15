// Offline tests for the owner bug of 2026-11-15, backend side (src/services/public-utilities.js,
// src/counties/yellowstone-utilities.js): Yellowstone parcel 03092732390050000 (Harvey Subd, about
// 2-3 km outside Billings) came back "likely" for City of Billings water and sewer because the
// city-limits check read Zoning/MapServer/7 "Zoning Jurisdictions", the City of Billings ZONING
// jurisdiction (about 144 sq mi, three times the 46 sq mi city). It now reads the county's City
// Limits layer (Yellowstone/MapServer/30), and a city system's main within 30 m is "served" only
// inside that city's limits. Recorded live answers (test/fixtures/public-utilities-yellowstone-*.json,
// 2026-11-15, named non-contact fields only) replay through a stubbed fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { lookupPublicUtilities, cityLimitsRule } from '../src/services/public-utilities.js';
import { YELLOWSTONE_CITY_LIMITS } from '../src/counties/yellowstone-utilities.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/public-utilities-${name}.json`, import.meta.url), 'utf8'));
const OWNER_PARCEL = 'yellowstone-03092732390050000';
const IN_BILLINGS = 'yellowstone-03103233201230000';
const OLD_JURISDICTIONS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/7/query';

let restore;
const realFetch = globalThis.fetch;
before(() => { restore = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restore(); globalThis.fetch = realFetch; });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function replay(fx, override) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const p = new URLSearchParams(url.search);
    if (typeof init?.body === 'string') for (const [k, v] of new URLSearchParams(init.body)) p.set(k, v);
    const layer = `${url.origin}${url.pathname}`;
    calls.push({ layer, outFields: p.get('outFields') });
    const forced = override?.(layer);
    if (forced) return forced;
    const hit = fx.responses.find(r => r.url === layer);
    if (!hit) throw new Error(`no recorded answer for ${layer}`);
    return json(hit.body, hit.status);
  };
  return calls;
}

test('owner parcel 03092732390050000 (outside Billings): not_found for water and sewer, from the county city-limits layer', async () => {
  const fx = fixture(OWNER_PARCEL);
  const calls = replay(fx);
  const r = await lookupPublicUtilities(fx.request);
  assert.deepEqual([r.water.status, r.sewer.status], ['not_found', 'not_found']);
  assert.ok(r.sources.every(s => s.ok));
  assert.ok(!calls.some(c => c.layer === OLD_JURISDICTIONS), 'the Billings zoning-jurisdiction layer is no longer asked');
  const limits = calls.find(c => c.layer === `${YELLOWSTONE_CITY_LIMITS}/query`);
  assert.equal(limits?.outFields, 'Name');
  assert.match(r.water.basis, /Yellowstone County city limits \(Billings, Laurel, Broadview\)/);
});

test('the pre-fix answer is reproduced when the parcel reads as inside Billings (what layer 7 said); county islands are skipped', async () => {
  const fx = fixture(OWNER_PARCEL);
  const limits = body => () => json({ features: body.map(Name => ({ attributes: { Name } })) });
  replay(fx, layer => (layer === `${YELLOWSTONE_CITY_LIMITS}/query` ? limits(['BILLINGS'])() : null));
  let r = await lookupPublicUtilities(fx.request);
  assert.deepEqual([r.water.status, r.water.provider, r.water.cityLimits], ['likely', 'City of Billings', 'inside']);
  assert.equal(r.water.basis, 'inside City of Billings limits; no water utility map published');
  replay(fx, layer => (layer === `${YELLOWSTONE_CITY_LIMITS}/query` ? limits(['COUNTY'])() : null));
  r = await lookupPublicUtilities(fx.request);
  assert.deepEqual([r.water.status, r.sewer.status], ['not_found', 'not_found'], "a 'COUNTY' island polygon is not a city");
});

test('in-city Billings 03103233201230000 stays likely for both (no Billings utility map), inside city limits', async () => {
  const fx = fixture(IN_BILLINGS);
  replay(fx);
  const r = await lookupPublicUtilities(fx.request);
  assert.deepEqual([r.water.status, r.sewer.status, r.water.provider, r.water.cityLimits], ['likely', 'likely', 'City of Billings', 'inside']);
});

const main = (provider, extra = {}) => ({ service: 'water', status: 'served', provider, basis: `${provider} water main 7 m from the parcel`, distanceM: 7, ...extra });
const city = name => ({ service: null, inCity: name });

test('a city system main within 30 m is served only inside that city; outside it is likely with the annexation wording', () => {
  const [inside] = cityLimitsRule([main('City of Spokane', { citySystem: true }), city('City of Spokane')]);
  assert.deepEqual([inside.status, inside.cityLimits], ['served', 'inside']);
  const [cda] = cityLimitsRule([main("City of Coeur d'Alene (CDA Water)", { citySystem: true }), city("City of Coeur d'Alene")]);
  assert.equal(cda.status, 'served', 'the provider label in brackets still matches the city');
  const [outside] = cityLimitsRule([main('City of Spokane', { citySystem: true })]);
  assert.deepEqual([outside.status, outside.cityLimits], ['likely', 'outside']);
  assert.equal(outside.basis, 'City of Spokane water main 7 m from the parcel; outside City of Spokane limits, so city service usually needs annexation or an extension agreement');
  const [other] = cityLimitsRule([main('City of Spokane', { citySystem: true }), city('City of Spokane Valley')]);
  assert.equal(other.status, 'likely', 'inside a different city');
  const [unknown] = cityLimitsRule([main('City of Spokane', { citySystem: true })], { citiesChecked: false });
  assert.deepEqual([unknown.status, unknown.cityLimits], ['likely', 'unknown']);
  const [county] = cityLimitsRule([main('Spokane County Utilities')]);
  assert.deepEqual([county.status, county.cityLimits], ['served', 'outside'], 'a county or district main is not tied to city limits');
});

