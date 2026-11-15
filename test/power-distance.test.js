// Offline tests for the distance to the nearest mapped power line (/api/power-intelligence):
// OpenStreetMap lines from Overpass, HIFLD transmission lines, a utility's own published line map
// (Flathead Electric), the browser fallback when Overpass rate-limits the Worker (kind
// 'osm-power', public/browser-fallback.js), and the power card text (public/ui-polish.js).
// Fetch is stubbed; nothing touches the network.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureUpstream } from '../src/shared/upstream.js';
import { distanceToParcelFt } from '../src/shared/line-distance.js';
import { classifyPowerElement } from '../src/utilities/osm-power.js';
import { handlePowerIntelligence } from '../src/services/power-intelligence.js';

const realFetch = globalThis.fetch;
let restoreUpstream;
before(() => { restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restoreUpstream(); });
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A 0.002 x 0.002 degree parcel (about 490 x 730 ft) in rural Spokane County.
const LAT = 47.85, LON = -117.25;
const square = (lon, lat, d) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const PARCEL = square(LON, LAT, 0.002);
const CENTER = { lat: LAT + 0.001, lon: LON + 0.001 };
const FT_PER_DEG_LAT = 364000;

// OSM: a 13.2 kV minor_line 0.001 deg north of the parcel's top edge (364 ft), a pole on it, and a
// 115 kV line further away. HIFLD: one 115 kV line 0.01 deg east (about 2,440 ft).
const top = LAT + 0.002;
const OSM_ELEMENTS = [
  { type: 'way', id: 101, tags: { power: 'minor_line', voltage: '13200', operator: 'Inland Power', name: 'dropped' }, geometry: [{ lat: top + 0.001, lon: LON - 0.003 }, { lat: top + 0.001, lon: LON + 0.005 }] },
  { type: 'node', id: 102, lat: top + 0.001, lon: LON + 0.001, tags: { power: 'pole' } },
  { type: 'way', id: 103, tags: { power: 'line', voltage: '115000' }, geometry: [{ lat: LAT - 0.01, lon: LON - 0.01 }, { lat: LAT - 0.01, lon: LON + 0.01 }] }
];
const HIFLD_FEATURES = [{ attributes: { VOLTAGE: 115, VOLT_CLASS: '100-161', TYPE: 'AC; OVERHEAD' }, geometry: { paths: [[[LON + 0.012, LAT - 0.02], [LON + 0.012, LAT + 0.02]]] } }];
const FEC_OVERHEAD = [{ attributes: { OBJECTID: 1 }, geometry: { paths: [[[LON - 0.001, LAT - 0.0005], [LON + 0.003, LAT - 0.0005]]] } }];

// Routes by host/path. overpass: 'answer' | 'empty' | number (HTTP status) | 'network'.
function stub({ overpass = 'answer', hifld = 'answer', fec = 'answer', avista = 'empty' } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({ host: url.hostname, path: url.pathname, body: typeof init.body === 'string' ? init.body : '' });
    const fail = mode => (mode === 'network' ? Promise.reject(new TypeError('fetch failed')) : jsonResponse({ error: 'x' }, mode));
    if (/overpass/.test(url.hostname)) {
      if (overpass === 'answer') return jsonResponse({ elements: OSM_ELEMENTS });
      if (overpass === 'empty') return jsonResponse({ elements: [] });
      return fail(overpass);
    }
    if (url.pathname.includes('US_Electric_Power_Transmission_Lines')) return hifld === 'answer' ? jsonResponse({ features: HIFLD_FEATURES }) : hifld === 'empty' ? jsonResponse({ features: [] }) : fail(hifld);
    if (url.pathname.includes('Public_Basic_FEC_System')) return fec === 'answer' ? jsonResponse({ features: url.pathname.endsWith('/14/query') ? FEC_OVERHEAD : [] }) : fail(fec);
    if (url.pathname.includes('DER_Hosting_Capacity_PRD')) return avista === 'empty' ? jsonResponse({ features: [] }) : fail(avista);
    return fail('network');
  };
  return calls;
}

const post = body => new Request('https://acresx.test/api/power-intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function power(body) {
  const res = await handlePowerIntelligence(post(body));
  return { res, body: await res.clone().json() };
}
const inland = { state: 'WA', providers: ['INLAND POWER & LIGHT COMPANY', 'BONNEVILLE POWER ADMINISTRATION'], ...CENTER, geometry: PARCEL, parcelId: '23123.9051' };

// ---- Geometry

test('line distance: crossing or inside is 0 ft; otherwise segment to parcel edge', () => {
  const crossing = [[LON - 0.001, LAT + 0.001], [LON + 0.003, LAT + 0.001]];
  assert.equal(distanceToParcelFt([crossing], { ...CENTER, geometry: PARCEL }), 0);
  assert.equal(distanceToParcelFt([[[LON + 0.001, LAT + 0.001]]], { ...CENTER, geometry: PARCEL }), 0, 'a pole inside the parcel');
  // 0.001 deg north of the top edge, running past both corners: 364 ft.
  const north = [[LON - 0.003, top + 0.001], [LON + 0.005, top + 0.001]];
  assert.ok(Math.abs(distanceToParcelFt([north], { ...CENTER, geometry: PARCEL }) - 0.001 * FT_PER_DEG_LAT) < 1);
  // No outline: measured from the point (0.002 deg north of the centre).
  assert.ok(Math.abs(distanceToParcelFt([north], CENTER) - 0.002 * FT_PER_DEG_LAT) < 1);
  assert.equal(distanceToParcelFt([], CENTER), Infinity);
});

test('OSM classification: minor_line is distribution, power=line by voltage, no voltage is "unknown"', () => {
  assert.equal(classifyPowerElement({ power: 'minor_line' }).lineType, 'distribution');
  assert.equal(classifyPowerElement({ power: 'line', voltage: '14400' }).lineType, 'distribution');
  assert.equal(classifyPowerElement({ power: 'line', voltage: '115000;13200' }).lineType, 'transmission');
  assert.equal(classifyPowerElement({ power: 'line' }).lineType, 'unknown');
  assert.equal(classifyPowerElement({ power: 'cable', location: 'underground' }).infrastructureClass, 'underground_distribution');
  assert.equal(classifyPowerElement({ power: 'cable', voltage: '230000' }).lineType, 'transmission');
});

// ---- The route

test('distance found: the nearest OSM distribution line feeds the distance, the card line and the cost model input', async () => {
  const calls = stub();
  const { res, body } = await power(inland);
  assert.equal(res.status, 200);
  assert.equal(body.provider, 'INLAND POWER & LIGHT COMPANY');
  assert.equal(body.distribution.status, 'osm_mapped_proximity');
  assert.ok(Math.abs(body.distribution.estimatedDistanceFt - 364) <= 1, `about 364 ft, got ${body.distribution.estimatedDistanceFt}`);
  assert.equal(body.distribution.lineType, 'distribution');
  assert.deepEqual({ ...body.nearestLine, note: undefined, confidence: undefined }, {
    distanceFt: body.distribution.estimatedDistanceFt, lineType: 'distribution', infrastructure: 'overhead_distribution',
    source: 'OpenStreetMap', sourceLabel: 'OSM', sourceUrl: 'https://www.openstreetmap.org', note: undefined, confidence: undefined
  });
  assert.match(body.nearestLine.note, /not a service connection/);
  // The 115 kV OSM line is "other", HIFLD is reported separately and never as the distance.
  assert.equal(body.proximity.nearestOtherLine.lineType, 'transmission');
  assert.equal(body.transmissionLine.lineType, 'transmission');
  assert.equal(body.transmissionLine.usableForResidentialExtensionCost, false);
  assert.ok(body.transmissionLine.distanceFt > 2000 && body.transmissionLine.distanceFt < 2600, String(body.transmissionLine.distanceFt));
  assert.equal(body.fallback, undefined);
  // Existing fields keep their shape.
  for (const key of ['available', 'adapter', 'territory', 'proximity', 'distribution', 'costEstimate', 'verification', 'alsoListed']) assert.ok(key in body, key);
  // One Overpass request: the first endpoint answered.
  assert.deepEqual(calls.filter(c => /overpass/.test(c.host)).map(c => c.host), ['overpass-api.de']);
});

test('rate-limited: Overpass 429 on both endpoints -> browser fallback hint; HIFLD gives a labelled transmission distance only', async () => {
  stub({ overpass: 429 });
  const { res, body } = await power(inland);
  assert.equal(res.status, 200);
  assert.equal(body.proximity.status, 'source_unavailable');
  assert.deepEqual(body.proximity.attempts.map(a => [a.host, a.status]), [['overpass-api.de', 429], ['overpass.private.coffee', 429]]);
  assert.deepEqual(body.fallback, { mode: 'browser', kind: 'osm-power', input: { lat: CENTER.lat, lon: CENTER.lon, geometry: PARCEL } });
  // No distribution distance: the cost model keeps its "not mapped" range.
  assert.equal(body.distribution.estimatedDistanceFt, null);
  assert.equal(body.nearestLine.lineType, 'transmission');
  assert.equal(body.nearestLine.sourceLabel, 'HIFLD');
  assert.equal(body.nearestLine.distanceFt, body.transmissionLine.distanceFt);
  assert.match(body.nearestLine.note, /does not serve homes directly/);
});

test('nothing nearby: no OSM line and no HIFLD line -> no distance, no hint, the usual "not mapped" note', async () => {
  stub({ overpass: 'empty', hifld: 'empty' });
  const { body } = await power({ ...inland, providers: ['YELLOWSTONE VALLEY ELEC CO-OP'], state: 'MT' });
  assert.equal(body.adapter, 'generic-v2-osm');
  assert.equal(body.proximity.status, 'no_mapped_distribution_found');
  assert.equal(body.distribution.status, 'no_verified_distance');
  assert.equal(body.distribution.estimatedDistanceFt, null);
  assert.match(body.distribution.note, /does not mean power is unavailable/);
  assert.equal(body.nearestLine, null);
  assert.equal(body.transmissionLine.distanceFt, null);
  assert.equal(body.fallback, undefined);
});

test('upstream failure: every source down -> still HTTP 200 JSON, only this layer degrades, browser hint offered', async () => {
  stub({ overpass: 'network', hifld: 'network', fec: 'network', avista: 'network' });
  const { res, body } = await power(inland);
  assert.equal(res.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.provider, 'INLAND POWER & LIGHT COMPANY');
  assert.equal(body.distribution.estimatedDistanceFt, null);
  assert.equal(body.nearestLine, null);
  assert.deepEqual(body.transmissionLine, { available: false, status: 'source_unavailable', lineType: 'transmission' });
  assert.equal(body.fallback?.kind, 'osm-power');
  // A 400-class Overpass error is not one a browser would get past: no hint.
  stub({ overpass: 400 });
  assert.equal((await power(inland)).body.fallback, undefined);
});

test("Flathead Electric: the co-op's own published line map gives the distance, before OSM, and no hint is needed", async () => {
  const calls = stub({ overpass: 429 });
  const { body } = await power({ state: 'MT', providers: ['FLATHEAD ELECTRIC COOP INC', 'BONNEVILLE POWER ADMINISTRATION'], ...CENTER, geometry: PARCEL });
  assert.equal(body.distribution.status, 'utility_published_proximity');
  assert.ok(Math.abs(body.distribution.estimatedDistanceFt - 0.0005 * FT_PER_DEG_LAT) <= 1, String(body.distribution.estimatedDistanceFt));
  assert.equal(body.distribution.infrastructure, 'overhead_distribution');
  assert.equal(body.distribution.sourceLabel, 'Flathead Electric map');
  assert.match(body.distribution.note, /Flathead Electric Cooperative's published grid map/);
  assert.equal(body.nearestLine.sourceLabel, 'Flathead Electric map');
  assert.equal(body.fallback, undefined);
  // The co-op's overhead (14) and underground (15) line layers were both asked.
  const fec = calls.filter(c => c.path.includes('Public_Basic_FEC_System'));
  assert.deepEqual(fec.map(c => c.path.match(/FeatureServer\/(\d+)/)[1]).sort(), ['14', '15']);
});
