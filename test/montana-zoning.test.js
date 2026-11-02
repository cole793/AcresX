// Offline tests for the Montana zoning adapters (src/counties/gallatin.js and
// src/counties/yellowstone.js). fetch is stubbed with canned or recorded ArcGIS answers; nothing
// touches the county or city servers. The recorded fixtures
// (test/fixtures/{gallatin,yellowstone}-zoning-<PARCELID>.json) were captured live on 2026-11-02;
// editor user names were replaced with placeholders, and no owner field was requested.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { getGallatinCountyIntelligence, districtLabel, GALLATIN_ZONING_LAYER, GALLATIN_CITY_LIMITS, BOZEMAN_ZONING } from '../src/counties/gallatin.js';
import { getYellowstoneCountyIntelligence, jurisdictionFromEntity, parseZone } from '../src/counties/yellowstone.js';
import { ringsFromGeometry, pointInRings } from '../src/shared/polygon-coverage.js';
import { zoningPoint as validatorZoningPoint } from '../scripts/validate-county.mjs';
import { configureUpstream } from '../src/shared/upstream.js';

const G_ZONING = `${GALLATIN_ZONING_LAYER}/query`;
const G_CITY = `${GALLATIN_CITY_LIMITS}/query`;
const BOZ = `${BOZEMAN_ZONING}/query`;
const YS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer';

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

// ---------------------------------------------------------------- Yellowstone

test('Yellowstone 03103333215010000 (recorded): a Billings parcel shows "City of Billings" and the zone covering the outline (P1), not the neighbour at its vertex average (NX3)', async () => {
  const f = fixture('yellowstone-zoning-03103333215010000');
  globalThis.fetch = f.fetch;
  const r = await getYellowstoneCountyIntelligence(f.data.request);
  assert.equal(r.jurisdiction, 'City of Billings');
  assert.equal(r.permitJurisdiction.name, 'City of Billings');
  assert.equal(r.zoning.code, 'P1');
  assert.equal(r.zoning.otherZones, undefined, 'NX2 only touches the edge');
  assert.equal(r.source.matchMethod, 'parcel area (sampled)');
  // The request's vertex average lies outside this curved outline (that point hit NX3 before).
  const rings = ringsFromGeometry(f.data.request.geometry);
  assert.equal(pointInRings(f.data.request.lon, f.data.request.lat, rings), false);
  // Every layer is read with the outline and named fields only.
  const zoningCalls = calls.filter(c => c.base.startsWith(YS));
  assert.equal(zoningCalls.length, 6);
  for (const c of zoningCalls) { assert.equal(c.params.get('geometryType'), 'esriGeometryPolygon'); assert.notEqual(c.params.get('outFields'), '*'); }
});

test('Yellowstone 03072527101010000 (recorded): a county special district reads "Special Zoning District 16", not "D16 — 16"', async () => {
  const f = fixture('yellowstone-zoning-03072527101010000');
  globalThis.fetch = f.fetch;
  const r = await getYellowstoneCountyIntelligence(f.data.request);
  assert.equal(r.jurisdiction, 'Yellowstone County');
  assert.equal(r.zoning.code, 'D16');
  assert.equal(r.zoning.name, 'Special Zoning District 16');
  assert.equal(r.zoning.label, 'Special Zoning District 16');
  assert.equal(r.zoning.url, 'https://www.billingsmt.gov/755/Zoning-Information');
});

test('Yellowstone 03113520290010000 (recorded): a rural parcel outside every zoning layer reads as unzoned', async () => {
  const f = fixture('yellowstone-zoning-03113520290010000');
  globalThis.fetch = f.fetch;
  const r = await getYellowstoneCountyIntelligence(f.data.request);
  assert.equal(r.available, true);
  assert.equal(r.jurisdiction, 'Yellowstone County');
  assert.equal(r.zoning.status, 'unzoned');
  assert.equal(r.zoning.code, 'UNZONED');
  assert.match(r.zoning.note, /^No county zoning district is mapped here; much of rural Yellowstone County is unzoned\. Verify with Yellowstone County Planning\./);
  assert.equal(r.zoning.url, 'https://www.billingsmt.gov/184/CityCounty-Planning');
});

// layerHits maps "layerId:point|polygon" to attributes; failing names layers that answer 500.
function yellowstoneLayers(hits = {}, failing = new Set()) {
  calls = [];
  return async (input, init) => {
    const { base, params } = await record(input, init);
    const m = base.match(/\/Zoning\/MapServer\/(\d+)\/query$/);
    if (!m) throw new Error(`unexpected request ${base}`);
    const key = `${m[1]}:${params.get('geometryType') === 'esriGeometryPolygon' ? 'polygon' : 'point'}`;
    if (failing.has(key)) return reply('upstream down', 500);
    return reply({ features: hits[key] ? [{ attributes: { VALIDATIONSTATUS: 2, ...hits[key] } }] : [] });
  };
}
const ysBody = { lat: 45.67, lon: -108.77, geometry: { type: 'Polygon', coordinates: [square(-108.771, 45.669, -108.769, 45.671)] } };

test('Yellowstone: Laurel and Broadview parcels name their city or town', async () => {
  globalThis.fetch = yellowstoneLayers({ '7:polygon': { ZoningJurisdictions_Entity: 'LAUREL' }, '8:polygon': { ZONE_CODE: 'CBD', ZONE_NAME: 'CBD', City: 'LAUREL' } });
  let r = await getYellowstoneCountyIntelligence(ysBody);
  assert.equal(r.jurisdiction, 'City of Laurel');
  assert.equal(r.zoning.code, 'CBD');
  assert.equal(r.zoning.label, 'CBD');

  // Broadview has no polygon in layer 7; its zoning layer names it.
  globalThis.fetch = yellowstoneLayers({ '0:polygon': { ZONE_CODE: 'CC', ZONE_NAME: 'Community Commercial', City: 'BROADVIEW' } });
  r = await getYellowstoneCountyIntelligence({ ...ysBody, lat: 46.098, lon: -108.877 });
  assert.equal(r.jurisdiction, 'Town of Broadview');
  assert.equal(r.zoning.code, 'CC');
});

test('Yellowstone: the zone covering most of the parcel wins and the others are noted', async () => {
  // N3 covers the west 70% of the parcel (-108.771 to -108.769), NX2 the east 30%.
  calls = [];
  globalThis.fetch = async (input, init) => {
    const { base } = await record(input, init);
    const id = base.match(/\/MapServer\/(\d+)\/query$/)?.[1];
    if (id === '7') return reply({ features: [feature({ ZoningJurisdictions_Entity: 'BILLINGS' }, square(-108.78, 45.66, -108.76, 45.68))] });
    if (id === '4') return reply({ features: [
      feature({ ZONE_CODE: 'NX2', ZONE_NAME: 'NX2 - Mixed Residential 2' }, square(-108.7696, 45.66, -108.76, 45.68)),
      feature({ ZONE_CODE: 'N3', ZONE_NAME: 'N3 - Suburban Neighborhood' }, square(-108.78, 45.66, -108.7696, 45.68))
    ] });
    return reply(empty);
  };
  const r = await getYellowstoneCountyIntelligence({ ...ysBody, lat: 45.6702 });
  assert.equal(r.jurisdiction, 'City of Billings');
  assert.equal(r.zoning.code, 'N3');
  assert.equal(r.zoning.otherZones.length, 1);
  assert.equal(r.zoning.otherZones[0].code, 'NX2');
  assert.ok(r.zoning.otherZones[0].share > 0.2 && r.zoning.otherZones[0].share < 0.4, String(r.zoning.otherZones[0].share));
  assert.match(r.zoning.note, /Covers about (6|7)\d% of the parcel; also partly NX2 \(about (2|3)\d%\)/);
});

test('Yellowstone: special district labels', () => {
  assert.deepEqual(parseZone({ CODE: 'D16', DIST_NO: 16, Name: '16' }, { special: true }), { code: 'D16', name: 'Special Zoning District 16', label: 'Special Zoning District 16' });
  assert.deepEqual(parseZone({ CODE: 'D12', Name: '12' }, { special: true }), { code: 'D12', name: 'Special Zoning District 12', label: 'Special Zoning District 12' });
  assert.deepEqual(parseZone({ ZONE_CODE: 'NX3', ZONE_NAME: 'NX3 - Mixed Residential 3' }, {}), { code: 'NX3', name: 'NX3 - Mixed Residential 3', label: 'NX3 — NX3 - Mixed Residential 3' });
});

// An L-shaped parcel whose vertex average (-108.76833, 45.67167) lies outside it, in the notch.
const lParcel = { type: 'Polygon', coordinates: [[[-108.77, 45.67], [-108.766, 45.67], [-108.766, 45.671], [-108.769, 45.671], [-108.769, 45.674], [-108.77, 45.674], [-108.77, 45.67]]] };

test('Validator: the zoning lookup point is inside the parcel even when the vertex average is not', () => {
  const p = validatorZoningPoint(lParcel);
  const rings = ringsFromGeometry(lParcel);
  assert.equal(pointInRings(-108.76833, 45.67167, rings), false, 'vertex average is outside');
  assert.equal(pointInRings(p.lon, p.lat, rings), true);
  // A square keeps its centroid.
  assert.deepEqual(validatorZoningPoint({ type: 'Polygon', coordinates: [square(0, 0, 2, 2)] }), { lon: 1, lat: 1 });
});

test('Browser: findZoningPermits sends a point inside the parcel (zoningPoint in public/index.html)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = html.match(/function zoningPoint\(parcel\)\{.*?\n/)?.[0];
  assert.ok(source, 'zoningPoint is defined');
  assert.match(html, /async function findZoningPermits\(parcel,signal\)\{const p=parcel\.properties,\[lon,lat\]=zoningPoint\(parcel\)/);
  const rings = ringsFromGeometry(lParcel);
  const ring = lParcel.coordinates[0].slice(0, -1);
  const turf = {
    centroid: () => ({ geometry: { coordinates: [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length] } }),
    bbox: () => [-108.77, 45.67, -108.766, 45.674],
    booleanPointInPolygon: ([x, y]) => pointInRings(x, y, rings)
  };
  const zoningPoint = new Function('turf', `${source}; return zoningPoint;`)(turf);
  const [x, y] = zoningPoint({ type: 'Feature', geometry: lParcel });
  assert.equal(pointInRings(x, y, rings), true);
  // The test stubs elsewhere only provide centroid: then the centroid is used as before.
  const centroidOnly = new Function('turf', `${source}; return zoningPoint;`)({ centroid: turf.centroid });
  assert.deepEqual(centroidOnly({}), turf.centroid().geometry.coordinates);
});

test('Yellowstone: jurisdiction names come only from ZoningJurisdictions_Entity', () => {
  assert.equal(jurisdictionFromEntity('BILLINGS'), 'City of Billings');
  assert.equal(jurisdictionFromEntity(' laurel '), 'City of Laurel');
  assert.equal(jurisdictionFromEntity('BROADVIEW'), 'Town of Broadview');
  assert.equal(jurisdictionFromEntity(null), '');
});

test('Yellowstone: no zone found while a layer failed stays "No mapped zoning district found", never unzoned', async () => {
  globalThis.fetch = yellowstoneLayers({}, new Set(['2:polygon']));
  const r = await getYellowstoneCountyIntelligence({ ...ysBody, lat: 45.6701 });
  assert.equal(r.available, false);
  assert.equal(r.zoning.status, 'no_mapped_result');
  assert.match(r.zoning.note, /at least one layer did not answer/);
});

test('Yellowstone: an unzoned parcel gets no made-up zoning rules', async () => {
  const { body } = await api('/api/zoning-rules', { county: 'Yellowstone', zoneCode: 'UNZONED', jurisdiction: 'Yellowstone County' });
  assert.equal(body.available, false);
  assert.equal(body.status, 'zone_not_mapped');
});

// ---------------------------------------------------------------- validation configs

const CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
// The cadastral layer's real field list (checked 2026-11-02) includes owner and mailing fields.
const CADASTRAL_FIELDS = ['OBJECTID', 'PARCELID', 'COUNTYCD', 'GISAcres', 'AddressLine1', 'AddressLine2', 'CityStateZip', 'OwnerName', 'OwnerAddress1', 'OwnerCity', 'OwnerZipCode', 'CareOfTaxpayer'];

for (const [name, countycd] of [['yellowstone', 3], ['gallatin', 6]]) {
  test(`validation/counties/${name}.json: 12 saved parcels, at least 3 with hand-checked zoning, and discovery never asks for owner fields`, async () => {
    const { discoverParcels } = await import('../scripts/validate-county.mjs');
    const config = JSON.parse(readFileSync(new URL(`../validation/counties/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(config.state, 'MT');
    assert.equal(config.parcels.length, 12);
    for (const p of config.parcels) { assert.match(p.parcelId, new RegExp(`^0${countycd}\\d{15}$`)); assert.ok(p.why.length > 40, p.parcelId); }
    const checked = config.parcels.filter(p => p.expected['zoning.code']);
    assert.ok(checked.length >= 3, `${checked.length} parcels with expected zoning`);
    for (const p of checked) assert.match(p.why, /https:\/\/\S+\/query\?/, `${p.parcelId} quotes its source query`);
    assert.equal(config.discover.layerUrl, CADASTRAL);
    assert.equal(config.discover.where, `COUNTYCD=${countycd} AND PARCELID IS NOT NULL`);
    assert.equal(config.discover.cityField, undefined);

    const urls = [];
    const fetchImpl = async input => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith('/FeatureServer/0')) return reply({ fields: CADASTRAL_FIELDS.map(n => ({ name: n })) });
      if (url.searchParams.get('returnCountOnly')) return reply({ count: 3 });
      return reply({ features: [{ attributes: { PARCELID: `0${countycd}0000000000000001`, GISAcres: 2, AddressLine1: '1 TEST RD' } }] });
    };
    const { parcels } = await discoverParcels({ ...config, discover: { ...config.discover, delayMs: 0 } }, { fetchImpl });
    assert.ok(parcels.length >= 1);
    const asked = urls.map(u => u.searchParams.get('outFields')).filter(Boolean);
    assert.ok(asked.length > 0);
    for (const fields of asked) {
      assert.equal(fields, 'PARCELID,GISAcres,AddressLine1');
      assert.doesNotMatch(fields, /owner|mail|taxpayer|\*/i);
    }
  });
}
