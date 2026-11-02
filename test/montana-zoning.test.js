// Offline tests for the Montana zoning adapters (src/counties/gallatin.js). fetch is stubbed with canned or recorded ArcGIS answers; nothing
// touches the county or city servers. The recorded fixtures
// (test/fixtures/{gallatin,yellowstone}-zoning-<PARCELID>.json) were captured live on 2026-11-02;
// editor user names were replaced with placeholders, and no owner field was requested.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { getGallatinCountyIntelligence, districtLabel, GALLATIN_ZONING_LAYER, GALLATIN_CITY_LIMITS, BOZEMAN_ZONING } from '../src/counties/gallatin.js';
import { configureUpstream } from '../src/shared/upstream.js';

const G_ZONING = `${GALLATIN_ZONING_LAYER}/query`;
const G_CITY = `${GALLATIN_CITY_LIMITS}/query`;
const BOZ = `${BOZEMAN_ZONING}/query`;

let calls;
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function record(input, init) {
  const url = new URL(String(input));
  const base = url.origin + url.pathname;
  const params = new URLSearchParams(url.search);
  if (init?.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
  calls.push({ base, params });
  return { base, params, n: calls.filter(c => c.base === base).length };
}
// Canned answers per layer URL; each is a body, or a function (params, n) => body | Response.
function stub(answers) {
  calls = [];
  return async (input, init) => {
    const { base, params, n } = await record(input, init);
    if (!(base in answers)) throw new Error(`unexpected request ${base}`);
    const a = typeof answers[base] === 'function' ? answers[base](params, n) : answers[base];
    return a instanceof Response ? a : reply(a);
  };
}
// Replays a recorded live run: answers for each layer URL in the order they were recorded.
function fixture(name, overrides = {}) {
  const data = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  calls = [];
  return {
    data,
    fetch: async (input, init) => {
      const { base, n } = await record(input, init);
      if (base in overrides) return overrides[base]();
      const recorded = data.responses.filter(r => r.url === base);
      if (!recorded.length) throw new Error(`no recorded answer for ${base}`);
      const r = recorded[Math.min(n, recorded.length) - 1];
      return reply(r.body, r.status);
    }
  };
}
const down = () => reply('Service Unavailable', 503);
const callsTo = base => calls.filter(c => c.base === base);

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

const env = { ASSETS: { fetch: async () => new Response('') } };
async function api(path, body) {
  const response = await worker.fetch(new Request(`https://acresx.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// A test parcel near Bozeman: 0.01 x 0.01 degrees, centered on (-111.105, 45.705).
const parcelRing = square(-111.11, 45.70, -111.10, 45.71);
const parcelBody = { county: 'Gallatin', lat: 45.705, lon: -111.105, geometry: { type: 'Polygon', coordinates: [parcelRing] } };
const feature = (attributes, ring) => ({ attributes, geometry: { rings: [ring] } });
const empty = { features: [] };
const bearCanyonR5 = { INNERZONE: 'R-5', DISTRICT_N: 'BEAR CANYON', LANDUSE: 'RURAL RESIDENTIAL', ZONED: 'R-5 RESIDENTIAL' };

// ---------------------------------------------------------------- Gallatin, recorded

test('Gallatin 06033804413010000 (recorded): zone code, name, district and land use come from INNERZONE, ZONED, DISTRICT_N and LANDUSE', async () => {
  const f = fixture('gallatin-zoning-06033804413010000');
  globalThis.fetch = f.fetch;
  const r = await getGallatinCountyIntelligence(f.data.request);
  assert.equal(r.available, true);
  assert.equal(r.jurisdiction, 'Gallatin County');
  assert.equal(r.zoning.status, 'gis_match');
  assert.equal(r.zoning.code, 'RC-SF-10');
  assert.equal(r.zoning.name, 'RESIDENTIAL CLUSTER SINGLE FAMILY 10');
  assert.equal(r.zoning.label, 'RC-SF-10 — RESIDENTIAL CLUSTER SINGLE FAMILY 10');
  assert.equal(r.zoning.district, 'Big Sky zoning district');
  assert.equal(r.zoning.landUse, 'Rural Residential');
  assert.equal(r.source.matchMethod, 'parcel area (sampled)');
  // The parcel outline is sent (not only its center) and only named, non-personal fields are asked for.
  const [zoningCall] = callsTo(G_ZONING);
  assert.equal(zoningCall.params.get('geometryType'), 'esriGeometryPolygon');
  assert.equal(zoningCall.params.get('outFields'), 'INNERZONE,DISTRICT_N,LANDUSE,ZONED');
  assert.equal(callsTo(G_CITY)[0].params.get('outFields'), 'NAME,TYPE');
});

test('Gallatin 06079801358210000 (recorded): a small Bozeman lot gets City of Bozeman zoning, never county zoning or "no zoning found"', async () => {
  const f = fixture('gallatin-zoning-06079801358210000');
  globalThis.fetch = f.fetch;
  const r = await getGallatinCountyIntelligence(f.data.request);
  assert.equal(r.jurisdiction, 'City of Bozeman');
  assert.equal(r.permitJurisdiction.name, 'City of Bozeman');
  assert.equal(r.zoning.status, 'gis_match');
  assert.equal(r.zoning.code, 'R-3');
  assert.equal(r.zoning.sourceUrl, BOZEMAN_ZONING);
  assert.match(r.zoning.url, /bozemanmt\.gov/);
  assert.match(r.zoning.note, /City zoning applies inside city limits/);
  assert.equal(r.source.jurisdictionSource.city, 'BOZEMAN');
  assert.equal(callsTo(BOZ)[0].params.get('outFields'), 'ZONING');
});

test('Gallatin 06069624301010000 (recorded): the county unzoned polygon (INNERZONE UNZ) still reads as unzoned', async () => {
  const f = fixture('gallatin-zoning-06069624301010000');
  globalThis.fetch = f.fetch;
  const r = await getGallatinCountyIntelligence(f.data.request);
  assert.equal(r.available, true);
  assert.equal(r.zoning.status, 'unzoned');
  assert.equal(r.zoning.code, 'UNZONED');
  assert.equal(r.zoning.label, 'Unzoned');
  assert.equal(r.jurisdiction, 'Gallatin County');
});

// ---------------------------------------------------------------- Gallatin, canned

test('Gallatin: the zone covering most of the parcel is reported and the others are noted', async () => {
  // R-5 covers the west 70% of the parcel, R-5s the east 30%.
  globalThis.fetch = stub({
    [G_CITY]: empty,
    [G_ZONING]: { features: [
      feature(bearCanyonR5, square(-111.12, 45.69, -111.103, 45.72)),
      feature({ ...bearCanyonR5, INNERZONE: 'R-5s', ZONED: 'R-5s RESIDENTIAL (slopes > 15%)' }, square(-111.103, 45.69, -111.09, 45.72))
    ] }
  });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.zoning.code, 'R-5');
  assert.equal(r.zoning.name, 'R-5 RESIDENTIAL');
  assert.equal(r.zoning.district, 'Bear Canyon zoning district');
  assert.equal(r.zoning.otherZones.length, 1);
  assert.equal(r.zoning.otherZones[0].code, 'R-5s (Bear Canyon)');
  // The share is sampled on a grid, so it is close to 30%, not exact.
  assert.ok(r.zoning.otherZones[0].share > 0.25 && r.zoning.otherZones[0].share < 0.4, String(r.zoning.otherZones[0].share));
  assert.match(r.zoning.note, /Covers about (6|7)\d% of the parcel; also partly R-5s \(Bear Canyon\) \(about (2|3)\d%\)/);
});

test('Gallatin: a parcel whose center sits in a ROAD polygon still gets the district zone around it', async () => {
  globalThis.fetch = stub({
    [G_CITY]: empty,
    [G_ZONING]: { features: [
      feature({ INNERZONE: 'ROAD', DISTRICT_N: 'BIG SKY', LANDUSE: ' ', ZONED: ' ROAD' }, square(-111.1055, 45.69, -111.1045, 45.72)),
      feature({ INNERZONE: 'RC-SF-5', DISTRICT_N: 'BIG SKY', LANDUSE: 'RURAL RESIDENTIAL', ZONED: 'RESIDENTIAL CLUSTER SINGLE FAMILY 5' }, square(-111.12, 45.69, -111.09, 45.72))
    ] }
  });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.zoning.code, 'RC-SF-5');
  assert.equal(r.zoning.otherZones, undefined);
});

for (const [name, type, expected, url] of [
  ['Belgrade', 'City', 'City of Belgrade', /belgrademt\.gov/],
  ['Three Forks', 'City', 'City of Three Forks', /threeforksmontana\.us/],
  ['West Yellowstone', 'Town', 'Town of West Yellowstone', /westyellowstone\.gov/],
  ['Manhattan', 'Town', 'Town of Manhattan', null]
]) {
  test(`Gallatin: inside ${name}, "${expected} zoning applies" is shown instead of county zoning`, async () => {
    globalThis.fetch = stub({
      [G_CITY]: { features: [feature({ NAME: name, TYPE: type }, square(-111.2, 45.6, -111.0, 45.8))] },
      [G_ZONING]: empty
    });
    const r = await getGallatinCountyIntelligence(parcelBody);
    assert.equal(r.jurisdiction, expected);
    assert.equal(r.zoning.status, 'city_jurisdiction');
    assert.equal(r.zoning.label, `${expected} zoning applies`);
    assert.equal(r.zoning.code, undefined, 'no county zone code');
    assert.match(r.zoning.note, new RegExp(`inside ${expected} limits, so ${expected} zoning applies, not Gallatin County zoning`));
    if (url) assert.match(r.zoning.url, url); else { assert.equal(r.zoning.url, undefined); assert.match(r.zoning.note, /Contact Town of Manhattan/); }
    assert.equal(callsTo(BOZ).length, 0);
  });
}

test('Gallatin: a parcel mostly outside a city keeps county zoning; one mostly inside notes the straddle', async () => {
  // The city covers the east 20% of the parcel: county zoning applies.
  const cityEast = feature({ NAME: 'Belgrade', TYPE: 'City' }, square(-111.102, 45.69, -111.09, 45.72));
  globalThis.fetch = stub({ [G_CITY]: { features: [cityEast] }, [G_ZONING]: { features: [feature(bearCanyonR5, square(-111.12, 45.69, -111.09, 45.72))] } });
  let r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.jurisdiction, 'Gallatin County');
  assert.equal(r.zoning.code, 'R-5');

  // The city covers the east 80%: city zoning applies, with a note about the rest.
  const cityMost = feature({ NAME: 'Belgrade', TYPE: 'City' }, square(-111.108, 45.69, -111.09, 45.72));
  globalThis.fetch = stub({ [G_CITY]: { features: [cityMost] }, [G_ZONING]: empty });
  r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.jurisdiction, 'City of Belgrade');
  assert.match(r.zoning.note, /About (7|8)\d% of the parcel is inside City of Belgrade limits/);
});

test('Gallatin: Bozeman zoning down degrades to "City of Bozeman zoning lookup unavailable", still naming the city', async () => {
  globalThis.fetch = stub({
    [G_CITY]: { features: [feature({ NAME: 'Bozeman', TYPE: 'City' }, square(-111.2, 45.6, -111.0, 45.8))] },
    [G_ZONING]: empty,
    [BOZ]: down
  });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.available, false);
  assert.equal(r.jurisdiction, 'City of Bozeman');
  assert.equal(r.zoning.status, 'unavailable');
  assert.match(r.zoning.label, /City of Bozeman zoning lookup unavailable/);
  assert.match(r.zoning.url, /bozemanmt\.gov/);
});

test('Gallatin: inside Bozeman with no Bozeman zone mapped still says city zoning applies', async () => {
  globalThis.fetch = stub({
    [G_CITY]: { features: [feature({ NAME: 'Bozeman', TYPE: 'City' }, square(-111.2, 45.6, -111.0, 45.8))] },
    [G_ZONING]: empty,
    [BOZ]: empty
  });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.jurisdiction, 'City of Bozeman');
  assert.equal(r.zoning.status, 'no_mapped_result');
  assert.match(r.zoning.label, /City of Bozeman zoning applies/);
  assert.match(r.zoning.note, /may be newly annexed/);
});

test('Gallatin: city limits down falls back to county zoning with a note that the parcel may be in a city', async () => {
  globalThis.fetch = stub({ [G_CITY]: down, [G_ZONING]: { features: [feature(bearCanyonR5, square(-111.12, 45.69, -111.09, 45.72))] } });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.zoning.code, 'R-5');
  assert.match(r.zoning.note, /city-limits layer did not answer/);

  globalThis.fetch = stub({ [G_CITY]: down, [G_ZONING]: empty });
  const none = await getGallatinCountyIntelligence({ ...parcelBody, lat: 45.7051 });
  assert.equal(none.zoning.status, 'no_mapped_result');
  assert.match(none.zoning.label, /may be inside a city — city limits lookup unavailable/);
});

test('Gallatin: a gap in the county map (no district, no unzoned polygon) says so honestly', async () => {
  globalThis.fetch = stub({ [G_CITY]: empty, [G_ZONING]: empty });
  const r = await getGallatinCountyIntelligence(parcelBody);
  assert.equal(r.available, false);
  assert.equal(r.zoning.status, 'no_mapped_result');
  assert.match(r.zoning.note, /maps neither a zoning district nor its unzoned area at this parcel/);
});

test('Gallatin: county zoning down outside a city answers 502 "unavailable" through /api/zoning-permits', async () => {
  globalThis.fetch = stub({ [G_CITY]: empty, [G_ZONING]: down });
  const { status, body } = await api('/api/zoning-permits', parcelBody);
  assert.equal(status, 502);
  assert.equal(body.zoning.status, 'unavailable');
  assert.match(body.zoning.note, /Gallatin zoning service returned 503/);
});

test('Gallatin: without a parcel outline the parcel point is used', async () => {
  globalThis.fetch = stub({ [G_CITY]: empty, [G_ZONING]: { features: [{ attributes: bearCanyonR5 }] } });
  const r = await getGallatinCountyIntelligence({ lat: 45.705, lon: -111.105 });
  assert.equal(r.zoning.code, 'R-5');
  assert.equal(r.source.matchMethod, 'parcel location');
  assert.equal(callsTo(G_ZONING)[0].params.get('geometryType'), 'esriGeometryPoint');
});

test('Gallatin district labels read naturally', () => {
  assert.equal(districtLabel('BEAR CANYON'), 'Bear Canyon zoning district');
  assert.equal(districtLabel('GALLATIN COUNTY / BOZEMAN AREA'), 'Gallatin County / Bozeman Area zoning district');
  assert.equal(districtLabel('ZONING DISTRICT 1'), 'Zoning District 1');
  assert.equal(districtLabel(''), '');
});
