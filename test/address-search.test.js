// Offline tests for address search: /api/address-search (src/services/address-search.js and the
// address sources), the Kootenai browser path (public/browser-fallback.js kind 'kootenai-address')
// and the search-form module (public/address-search.js). Upstream answers are recorded fixtures
// (test/fixtures/address-search/, recorded 2026-11-15); fetch is stubbed, no live network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { situsWhere, normalizeStreet, bestCandidate, resolveAddress, parcelsAt, suggestAddresses } from '../src/shared/address-locator.js';
import { kootenaiAddressSource } from '../src/counties/kootenai-address.js';
import { montanaAddressSource, montanaCountyName } from '../src/states/montana/address.js';
import { censusAddress } from '../src/services/census-geocoder.js';
import { makeContext, makeClock, readPublic } from './ui-harness.js';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/address-search/${name}.json`, import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const PERSONAL = /^(owner\w*|taxpayer\w*|name|recipient\w*|mail\w*|public_std|file_as\w*|(first|last)_name|addr_\w*|careof\w*)$/i;

const SP = 'https://gismo.spokanecounty.org/arcgis/rest/services';
const KC = 'https://map.kcgov.us/arcgis/rest/services';
const MT_LOC = 'https://gisservice.mt.gov/arcgis/rest/services/msdi_address_locator_geocode_v1/GeocodeServer';
const MT_CAD = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0/query';
const STV = 'https://gis.stevenscountywa.gov/server/rest/services';
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// A recording fetch: handler({ base, params, n }) returns a body (or throws).
function recorder(handler) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const base = url.origin + url.pathname;
    const params = new URLSearchParams(url.search);
    if (init.body && typeof init.body === 'string') new URLSearchParams(init.body).forEach((v, k) => params.set(k, v));
    calls.push({ base, host: url.hostname, params, credentials: init.credentials, redirect: init.redirect });
    const n = calls.filter(c => c.base === base).length;
    const body = await handler({ base, params, n });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}
function noOwnerFields(calls) {
  for (const c of calls) {
    const outFields = c.params.get('outFields');
    if (!/\/query$/.test(c.base)) continue;
    assert.ok(outFields && outFields.trim() !== '*', `${c.base} must name its outFields`);
    for (const f of outFields.split(',')) assert.doesNotMatch(f.trim(), PERSONAL, `${c.base} asked for ${f}`);
  }
}

const env = { ASSETS: { fetch: async () => new Response('') } };
async function api(body, fetchImpl) {
  globalThis.fetch = fetchImpl;
  const r = await worker.fetch(new Request('https://acresx.test/api/address-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}

const realFetch = globalThis.fetch, realWarn = console.warn;
let restoreUpstream;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; console.warn = () => {}; restoreUpstream = configureUpstream({ backoffMs: 0 }); });
afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

// ---- Text helpers

test('address text: situs LIKE drops directionals and street types; too-thin text is not searched', () => {
  assert.equal(situsWhere('Loc_Addr', '3572 S Moose Canyon Rd'), "UPPER(Loc_Addr) LIKE '3572 %MOOSE%CANYON%'");
  assert.equal(situsWhere('AddressLine1', '510 Fairmont Road, Kalispell, MT'), "UPPER(AddressLine1) LIKE '510 %FAIRMONT%'");
  assert.equal(situsWhere('x', "12 O'Brien Ln"), "UPPER(x) LIKE '12 %BRIEN%'");
  assert.equal(situsWhere('x', 'moose canyon'), "UPPER(x) LIKE '%MOOSE CANYON%'");
  assert.equal(situsWhere('x', '3572'), null);
  assert.equal(situsWhere('x', 'N Rd'), null);
  assert.equal(normalizeStreet('3572 South Moose Canyon Road, Coeur d Alene'), '3572 S MOOSE CANYON RD');
  assert.equal(normalizeStreet('3572 S MOOSE CANYON RD '), '3572 S MOOSE CANYON RD');
});

test('candidates: a point address beats an interpolated one with the same score; street names are not used', () => {
  const best = bestCandidate(fx('kootenai-find').candidates);
  assert.equal(best.type, 'PointAddress');
  assert.equal(best.interpolated, false);
  assert.deepEqual(best.point, { lat: 47.643135416943615, lon: -116.87164285331077 });
  assert.equal(bestCandidate([{ address: 'S MOOSE CANYON RD', score: 100, attributes: { Addr_type: 'StreetName' }, location: { x: -116.8, y: 47.6 } }]), null);
  assert.equal(bestCandidate([{ address: 'x', score: 60, attributes: { Addr_type: 'PointAddress' }, location: { x: 1, y: 1 } }]), null);
});

// ---- Worker: suggest, resolve, point

test('suggest: Spokane asks the county locator and returns text + magicKey', async () => {
  const rec = recorder(({ base }) => { assert.equal(base, `${SP}/Locators/AddrComposite/GeocodeServer/suggest`); return fx('spokane-suggest'); });
  const { status, body } = await api({ action: 'suggest', state: 'WA', county: 'Spokane', text: '7911 W Ridg' }, rec.fetch);
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.suggestions[0].text, '7911 W Ridgeway Rd, Deer Park, WA, 99006');
  assert.match(body.suggestions[0].magicKey, /^[A-Za-z0-9+/=]+$/);
  assert.equal(rec.calls[0].params.get('text'), '7911 W Ridg');
  assert.ok(body.suggestions.length <= 6);
});

test('resolve: Spokane address point -> parcel under it (27081.9058), sure match', async () => {
  const rec = recorder(({ base }) => {
    if (base.endsWith('/findAddressCandidates')) return fx('spokane-find');
    if (base === `${SP}/Assessor/Parcels/MapServer/0/query`) return fx('spokane-point');
    throw new Error(`unexpected ${base}`);
  });
  const { body } = await api({ action: 'resolve', state: 'WA', county: 'Spokane', text: '7911 W Ridgeway Rd, Deer Park, WA, 99006', magicKey: fx('spokane-suggest').suggestions[0].magicKey }, rec.fetch);
  assert.equal(body.method, 'address-point');
  assert.equal(body.exact, true);
  assert.deepEqual(body.parcels, [{ parcelId: '27081.9058', address: '7911 W RIDGEWAY RD', city: 'DEER PARK', county: 'Spokane', state: 'WA' }]);
  const pointQuery = rec.calls.find(c => c.base.endsWith('/query')).params;
  assert.equal(pointQuery.get('geometryType'), 'esriGeometryPoint');
  assert.equal(pointQuery.get('inSR'), '4326');
  assert.equal(pointQuery.get('returnGeometry'), 'false');
  assert.ok(rec.calls.find(c => c.base.endsWith('/findAddressCandidates')).params.get('magicKey'));
  noOwnerFields(rec.calls);
});

test('resolve: Stevens address point -> PARCELN 0434200 (the statewide ORIG_PARCEL_ID)', async () => {
  const rec = recorder(({ base }) => (base.endsWith('/findAddressCandidates') ? fx('stevens-find') : fx('stevens-point')));
  const { body } = await api({ action: 'resolve', state: 'WA', county: 'Stevens', text: '2436 Flowery Trail, Chewelah, WA, 99109' }, rec.fetch);
  assert.ok(rec.calls.every(c => c.base.startsWith(STV)));
  assert.deepEqual(body.parcels, [{ parcelId: '0434200', address: '2436 FLOWERY TRAIL RD', city: 'CHEWELAH', county: 'Stevens', state: 'WA' }]);
  assert.equal(rec.calls.find(c => c.base.endsWith('/query')).params.get('outFields'), 'PARCELN,situs_disp,situs_city');
  noOwnerFields(rec.calls);
});

test('resolve: Montana statewide locator -> cadastral parcel, county read from COUNTYCD', async () => {
  const rec = recorder(({ base }) => (base.endsWith('/findAddressCandidates') ? fx('mt-find') : fx('mt-point')));
  const { body } = await api({ action: 'resolve', state: 'MT', county: 'Gallatin', text: '4740 Blue Creek Road, Billings, MT, 59101' }, rec.fetch);
  assert.equal(rec.calls[0].base, `${MT_LOC}/findAddressCandidates`);
  assert.equal(body.parcels[0].parcelId, '03082303410010000');
  assert.equal(body.parcels[0].county, 'Yellowstone', 'the parcel layer, not the chosen county, names the county');
  assert.equal(body.exact, true);
  assert.equal(rec.calls.find(c => c.base === MT_CAD).params.get('outFields'), 'PARCELID,COUNTYCD,AddressLine1,CityStateZip');
  noOwnerFields(rec.calls);
});

test('Montana: road right-of-way polygons (PARCELID 99999999999999999) are never a parcel', async () => {
  const row = fx('mt-point-row');
  const near = { features: [...row.features, ...fx('mt-point').features] };
  const rec = recorder(({ base, params }) => {
    assert.equal(base, MT_CAD);
    return params.get('distance') ? near : row;
  });
  const { body } = await api({ action: 'point', state: 'MT', county: 'Yellowstone', lat: 45.685258, lon: -108.490066 }, rec.fetch);
  assert.equal(body.near, true, 'the point fell only in right-of-way: nearby parcels, to confirm');
  assert.deepEqual(body.parcels.map(p => p.parcelId), ['03082303410010000']);
  assert.equal(rec.calls[1].params.get('distance'), '30');
  // resolve with a point that falls only in right-of-way is not a sure match
  const rec2 = recorder(({ base, params }) => (base.endsWith('/findAddressCandidates') ? fx('mt-find') : params.get('distance') ? near : row));
  const r2 = await api({ action: 'resolve', state: 'MT', county: 'Yellowstone', text: '4740 Blue Creek Road' }, rec2.fetch);
  assert.equal(r2.body.method, 'address-near');
  assert.equal(r2.body.exact, false);
  assert.equal(montanaCountyName(7), 'Flathead');
  assert.equal(montanaAddressSource('Gallatin').scopeWhere, 'COUNTYCD=6', 'COUNTYCD is an integer');
  assert.equal(montanaAddressSource('Gallatin').idWhere('99999999999999999'), null);
});

test('resolve: no locator match -> situs LIKE; one parcel with the typed street is a sure match, several are a choice', async () => {
  const situs = { features: [{ attributes: { PARCELID: '07396611101010000', COUNTYCD: 7, AddressLine1: '510 FAIRMONT RD ', CityStateZip: 'KALISPELL, MT 59901' } }, { attributes: { PARCELID: '07396611101020000', COUNTYCD: 7, AddressLine1: '510 FAIRMONT VIEW LN ', CityStateZip: 'KALISPELL, MT 59901' } }] };
  const rec = recorder(({ base }) => (base.endsWith('/findAddressCandidates') ? { candidates: [] } : situs));
  const { body } = await api({ action: 'resolve', state: 'MT', county: 'Flathead', text: '510 Fairmont Road' }, rec.fetch);
  assert.equal(body.method, 'situs');
  assert.equal(body.exact, true);
  assert.deepEqual(body.parcels.map(p => p.parcelId), ['07396611101010000']);
  const where = rec.calls.find(c => c.base === MT_CAD).params.get('where');
  assert.equal(where, "(COUNTYCD=7) AND UPPER(AddressLine1) LIKE '510 %FAIRMONT%'");
  const rec2 = recorder(({ base }) => (base.endsWith('/findAddressCandidates') ? { candidates: [] } : situs));
  const loose = await api({ action: 'resolve', state: 'MT', county: 'Flathead', text: '510 Fairmont' }, rec2.fetch);
  assert.equal(loose.body.exact, false);
  assert.equal(loose.body.parcels.length, 2);
});

test('suggest: a county with no locator suggests parcels from the statewide situs field', async () => {
  const rec = recorder(() => ({ features: [{ attributes: { ORIG_PARCEL_ID: '1-0001', COUNTY_NM: '75', SITUS_ADDRESS: '1200 NE STADIUM WAY', SITUS_CITY_NM: 'PULLMAN' } }] }));
  const { body } = await api({ action: 'suggest', state: 'WA', county: 'Whitman', text: '1200 NE Stadium' }, rec.fetch);
  assert.deepEqual(body.suggestions, [{ text: '1200 NE STADIUM WAY, PULLMAN', parcelId: '1-0001' }]);
  assert.match(rec.calls[0].params.get('where'), /^\(COUNTY_NM='75'\) AND UPPER\(SITUS_ADDRESS\) LIKE '1200 %STADIUM%'$/);
  noOwnerFields(rec.calls);
});

test('census: approximate point only, labelled, never a parcel; state appended', async () => {
  const rec = recorder(({ base }) => { assert.equal(base, CENSUS); return fx('census'); });
  const { body } = await api({ action: 'census', state: 'WA', county: 'Spokane', text: '7911 W Ridgeway Rd, Deer Park' }, rec.fetch);
  assert.equal(body.approximate, true);
  assert.equal(body.label, 'Approximate location — confirm the parcel');
  assert.equal(body.parcels, undefined);
  assert.deepEqual(body.point, { lat: 47.859956183523, lon: -117.525604849649 });
  assert.equal(rec.calls[0].params.get('address'), '7911 W Ridgeway Rd, Deer Park, WA');
  assert.equal(censusAddress('1 Main St, Boise, ID 83702', 'ID'), '1 Main St, Boise, ID 83702');
  // a match in another state is not used
  const other = recorder(() => fx('census'));
  assert.equal((await api({ action: 'census', state: 'MT', county: 'Gallatin', text: '7911 W Ridgeway Rd' }, other.fetch)).body.point, null);
});

test('bad input is a 400 and never reaches the network', async () => {
  const rec = recorder(() => { throw new Error('no network'); });
  for (const body of [
    { action: 'suggest', state: 'WA', county: 'Spokane', text: "1' OR 1=1; --<script>" },
    { action: 'resolve', state: 'WA', county: 'Spokane', text: '7911 W Ridgeway', magicKey: 'bad key!' },
    { action: 'point', state: 'MT', county: 'Gallatin', lat: 95, lon: -110 },
    { action: 'other-counties', state: 'WA', county: 'Spokane', parcelId: '' },
    { action: 'drop', state: 'WA', county: 'Spokane' },
    { action: 'suggest', state: 'OR', county: 'Lane', text: '1 Main St' }
  ]) assert.equal((await api(body, rec.fetch)).status, 400, JSON.stringify(body));
  assert.equal(rec.calls.length, 0);
});

test('an upstream failure is a 502 for address search only', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('busy', { status: 503 }); };
  const r = await worker.fetch(new Request('https://acresx.test/api/address-search', { method: 'POST', body: JSON.stringify({ action: 'point', state: 'WA', county: 'Spokane', lat: 47.8, lon: -117.5 }) }), env, {});
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.available, false);
  assert.match(body.error, /Spokane County GIS unavailable/);
  assert.ok(calls >= 1);
});

// ---- Not found: other counties

test('other-counties: a Flathead geocode typed under Gallatin is offered as "Flathead"', async () => {
  const rec = recorder(({ base, params }) => { assert.equal(base, MT_CAD); assert.equal(params.get('where'), "PARCELID='07396611101010000'"); return { features: [{ attributes: { PARCELID: '07396611101010000', COUNTYCD: 7, AddressLine1: '510 FAIRMONT RD ', CityStateZip: 'KALISPELL, MT 59901' } }] }; });
  const { body } = await api({ action: 'other-counties', state: 'MT', county: 'Gallatin', parcelId: '07396611101010000' }, rec.fetch);
  assert.deepEqual(body.matches, [{ county: 'Flathead', parcelId: '07396611101010000', address: '510 FAIRMONT RD', city: 'KALISPELL, MT 59901' }]);
  assert.equal(body.example, '06090630401080000');
  noOwnerFields(rec.calls);
});

test('other-counties: a Spokane number under Stevens checks the Spokane parcel layer', async () => {
  const rec = recorder(({ base, params }) => { assert.equal(base, `${SP}/Assessor/Parcels/MapServer/0/query`); assert.equal(params.get('where'), "PID_NUM='27081.9058'"); return fx('spokane-point'); });
  const { body } = await api({ action: 'other-counties', state: 'WA', county: 'Stevens', parcelId: '27081.9058' }, rec.fetch);
  assert.equal(body.matches[0].county, 'Spokane');
  assert.equal(body.example, '0434200');
});

// ---- Kootenai: browser only

function browserFallback(fetchImpl) {
  const clock = makeClock();
  const h = makeContext({ body: [], clock, fetch: fetchImpl });
  const timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
  Object.assign(h.ctx, { URL, URLSearchParams, AbortController, Response, Headers, fetch: fetchImpl, setTimeout: timer, clearTimeout });
  h.run(readPublic('browser-fallback.js'));
  return h.ctx.AcresXFallback;
}
const kcRoutes = ({ base, params }) => {
  if (base === `${KC}/GISAPP22_COMP_LOC/GeocodeServer/suggest`) return fx('kootenai-suggest');
  if (base === `${KC}/GISAPP22_COMP_LOC/GeocodeServer/findAddressCandidates`) return fx('kootenai-find');
  if (base === `${KC}/NewServices/Ownership_Display/MapServer/0/query`) return params.get('geometry') ? fx('kootenai-point') : fx('kootenai-situs');
  throw new Error(`unexpected ${base}`);
};

test('Kootenai: the Worker never calls map.kcgov.us and answers with a browser hint', async () => {
  const rec = recorder(() => { throw new Error('the Worker must not call upstream'); });
  for (const body of [
    { action: 'suggest', state: 'ID', county: 'Kootenai', text: '3572 S MOO' },
    { action: 'resolve', state: 'ID', county: 'Kootenai', text: '3572 S MOOSE CANYON RD', magicKey: 'GST7YMc0AM9UOsE4AYEqEYAcI1c915EtQMn11NFF' },
    { action: 'point', state: 'ID', county: 'Kootenai', lat: 47.6431, lon: -116.8716 },
    { action: 'other-counties', state: 'ID', county: 'Bonner', parcelId: '50N04W323200' }
  ]) {
    const { status, body: answer } = await api(body, rec.fetch);
    assert.equal(status, 200);
    assert.equal(answer.fallback.mode, 'browser');
    assert.equal(answer.fallback.kind, 'kootenai-address');
    assert.equal(answer.fallback.input.action, body.action);
  }
  assert.equal(rec.calls.length, 0);
});

test('Kootenai browser path: same answer as the Worker steps on the same fixtures (3572 S Moose Canyon Rd -> 50N04W323200)', async () => {
  const browserRec = recorder(kcRoutes);
  const fb = browserFallback(browserRec.fetch);
  const input = { action: 'resolve', text: '3572 S MOOSE CANYON RD', magicKey: fx('kootenai-suggest').suggestions[1].magicKey };
  const fromBrowser = plain(await fb.run('kootenai-address', input));
  const workerRec = recorder(kcRoutes);
  globalThis.fetch = workerRec.fetch;
  const fromWorker = await resolveAddress(kootenaiAddressSource, input);
  assert.deepEqual(fromBrowser, { available: true, state: 'ID', county: 'Kootenai', action: 'resolve', example: '50N04W323200', ...fromWorker, source: { agency: 'Kootenai County GIS' } });
  assert.deepEqual(fromBrowser.parcels, [{ parcelId: '50N04W323200', address: '3572 S MOOSE CANYON RD', city: 'COEUR D ALENE', county: 'Kootenai', state: 'ID' }]);
  assert.equal(fromBrowser.exact, true);
  // same requests, allowlisted, no cookies or redirects, no owner field
  assert.deepEqual(browserRec.calls.map(c => `${c.base} ${c.params.get('outFields')}`), workerRec.calls.map(c => `${c.base} ${c.params.get('outFields')}`));
  for (const c of browserRec.calls) { assert.equal(c.host, 'map.kcgov.us'); assert.equal(c.credentials, 'omit'); assert.equal(c.redirect, 'error'); }
  noOwnerFields(browserRec.calls);
  // suggest and point match too
  const sb = plain(await fb.run('kootenai-address', { action: 'suggest', text: '3572 S MOO' }));
  globalThis.fetch = recorder(kcRoutes).fetch;
  assert.deepEqual(sb.suggestions, (await suggestAddresses(kootenaiAddressSource, '3572 S MOO')).suggestions);
  const pb = plain(await fb.run('kootenai-address', { action: 'point', lat: 47.643135416943615, lon: -116.87164285331077 }));
  globalThis.fetch = recorder(kcRoutes).fetch;
  const pw = await parcelsAt(kootenaiAddressSource, { lat: 47.643135416943615, lon: -116.87164285331077 });
  assert.deepEqual(pb.parcels, pw.parcels);
});

test('Kootenai browser path: the page fetch picks up the hint and gets the browser answer', async () => {
  const kc = recorder(kcRoutes);
  const page = async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/address-search') || url.startsWith('https://acresx.test/api/')) {
      globalThis.fetch = async () => { throw new Error('the Worker must not call upstream'); };
      return worker.fetch(new Request('https://acresx.test/api/address-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init.body }), env, {});
    }
    return kc.fetch(input, init);
  };
  const clock = makeClock();
  const h = makeContext({ body: [], clock, fetch: page });
  const timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
  Object.assign(h.ctx, { URL, URLSearchParams, AbortController, Response, Headers, fetch: page, setTimeout: timer, clearTimeout, location: { href: 'https://acresx.test/' } });
  h.run(readPublic('browser-fallback.js'));
  const r = await h.ctx.fetch('/api/address-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'point', state: 'ID', county: 'Kootenai', lat: 47.643135416943615, lon: -116.87164285331077 }) });
  const body = await r.json();
  assert.equal(body.available, true);
  assert.equal(body.parcels[0].parcelId, '50N04W323200');
});

test('Kootenai browser path: bad input never reaches the network; other-counties checks the PIN', async () => {
  const rec = recorder(({ params }) => { assert.equal(params.get('where'), "PIN='50N04W323200' OR PID='50N04W323200'"); return fx('kootenai-point'); });
  const fb = browserFallback(rec.fetch);
  await assert.rejects(fb.run('kootenai-address', { action: 'suggest', text: "x'; DROP" }), /bad address text/);
  await assert.rejects(fb.run('kootenai-address', { action: 'resolve', text: '3572 S Moose', magicKey: 'no spaces allowed' }), /bad suggestion key/);
  await assert.rejects(fb.run('kootenai-address', { action: 'point', lat: 'x', lon: 1 }), /bad point/);
  await assert.rejects(fb.run('kootenai-address', { action: 'other-counties', parcelId: "1' OR 1=1" }), /bad parcel number/);
  await assert.rejects(fb.run('kootenai-address', { action: 'erase' }), /unknown address action/);
  assert.equal(rec.calls.length, 0);
  const answer = plain(await fb.run('kootenai-address', { action: 'other-counties', parcelId: '50N04W323200', county: 'Bonner' }));
  assert.deepEqual(answer.matches, [{ county: 'Kootenai', parcelId: '50N04W323200', address: '3572 S MOOSE CANYON RD', city: 'COEUR D ALENE' }]);
  noOwnerFields(rec.calls);
});

// ---- The search form (public/address-search.js)

function page({ routes = {}, state = 'WA', county = 'Spokane', findParcel } = {}) {
  const clock = makeClock();
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const route = routes[body?.action];
    const answer = typeof route === 'function' ? route(body) : route;
    if (!answer) throw new Error(`no stub for ${body?.action}`);
    return { ok: true, status: 200, json: async () => answer };
  };
  const winListeners = {};
  const h = makeContext({
    clock, fetch,
    body: [['section', { class: 'search-card' }, '', [
      ['form', { id: 'searchForm', class: 'search-form' }, '', [['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }]]],
      ['div', { class: 'helper' }, 'Spaces, dashes, and periods are ignored.']
    ]], ['div', { id: 'status' }]],
    extra: {
      addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
      Event: class { constructor(type, o = {}) { this.type = type; this.bubbles = o.bubbles; } }
    }
  });
  const doc = h.document;
  doc.getElementById('state').value = state;
  const countyEl = doc.getElementById('county');
  countyEl.value = county;
  countyEl.options = ['Spokane', 'Stevens', 'Gallatin', 'Flathead', 'Yellowstone', 'Kootenai', 'Bonner'].map(value => ({ value }));
  countyEl.dispatchEvent = () => true;
  const form = doc.getElementById('searchForm');
  let submits = 0;
  form.requestSubmit = () => {
    submits++;
    const ev = { target: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
    (winListeners.submit || []).forEach(fn => fn(ev));
  };
  if (findParcel) h.ctx.findParcel = findParcel;
  h.run(readPublic('address-search.js'));
  const input = doc.getElementById('parcel');
  const submit = () => { const ev = { target: form, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; (winListeners.submit || []).forEach(fn => fn(ev)); return ev; };
  const type = text => { input.value = text; (input.listeners.input || []).forEach(fn => fn({})); };
  return { h, doc, clock, calls, input, countyEl, submit, type, submits: () => submits, api: h.ctx.AcresXAddress };
}

test('form: parcel numbers keep the existing search; addresses are recognised', () => {
  const { api } = page();
  for (const id of ['27081.9058', '50N04W323200', '0L8210010030', '03082303410010000', '0434200', '27081 9058', '03 0823 0341 0010000', '50N04W 32 3200']) assert.equal(api.looksLikeAddress(id), false, id);
  for (const a of ['3572 S Moose Canyon Rd', '510 Fairmont Rd Kalispell', 'moose canyon', '7911 W Ridg']) assert.equal(api.looksLikeAddress(a), true, a);
});

test('form: submitting a parcel number is not intercepted (no address calls)', () => {
  const p = page();
  p.input.value = '27081.9058';
  const ev = p.submit();
  assert.equal(ev.defaultPrevented, false);
  assert.equal(ev.stopped, false);
  assert.equal(p.calls.length, 0);
  assert.equal(p.input.placeholder, 'Parcel number or address');
});

test('form: suggestions after a 250 ms pause and 4+ characters; picking one resolves and runs the parcel search', async () => {
  const p = page({ routes: {
    suggest: { available: true, suggestions: [{ text: '7911 W Ridgeway Rd, Deer Park, WA, 99006', magicKey: 'abc' }], source: { agency: 'Spokane County GIS' } },
    resolve: b => { assert.equal(b.magicKey, 'abc'); return { available: true, method: 'address-point', exact: true, matchedAddress: '7911 W Ridgeway Rd, Deer Park, WA, 99006', parcels: [{ parcelId: '27081.9058', address: '7911 W RIDGEWAY RD', city: 'DEER PARK', county: 'Spokane', state: 'WA' }], source: { agency: 'Spokane County GIS' } }; }
  } });
  p.type('791');
  await p.clock.advance(300);
  assert.equal(p.calls.length, 0, 'under 4 characters');
  p.type('7911 W R');
  await p.clock.advance(200);
  p.type('7911 W Ridg');
  await p.clock.advance(249);
  assert.equal(p.calls.length, 0, 'debounced');
  await p.clock.advance(10);
  assert.deepEqual(p.calls.map(c => c.body), [{ action: 'suggest', state: 'WA', county: 'Spokane', text: '7911 W Ridg' }]);
  const list = p.doc.getElementById('axAddrList');
  assert.equal(list.hidden, false);
  const option = list.querySelector('.ax-addr-item');
  assert.match(option.textContent, /7911 W Ridgeway Rd/);
  option.listeners.click[0]();
  await p.clock.advance(0);
  assert.equal(p.input.value, '27081.9058');
  assert.equal(p.submits(), 1, 'the normal parcel search ran once');
  assert.match(p.doc.getElementById('axAddrNote').textContent, /parcel 27081\.9058.*Verify with the county assessor/);
});

test('form: Enter on an address resolves it; a Montana match in another county switches the county', async () => {
  const p = page({ state: 'MT', county: 'Gallatin', routes: {
    resolve: { available: true, method: 'address-point', exact: true, matchedAddress: '510 Fairmont Road, Kalispell, MT, 59901', parcels: [{ parcelId: '07396611101010000', address: '510 FAIRMONT RD', city: 'KALISPELL, MT 59901', county: 'Flathead', state: 'MT' }] }
  } });
  p.input.value = '510 Fairmont Rd Kalispell';
  const ev = p.submit();
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.stopped, true, 'the loading modal and the parcel search do not see the address');
  await p.clock.advance(0);
  assert.equal(p.countyEl.value, 'Flathead');
  assert.equal(p.input.value, '07396611101010000');
  assert.equal(p.submits(), 1);
});

test('form: several parcels are a choice, never auto-selected', async () => {
  const p = page({ routes: { resolve: { available: true, method: 'situs', exact: false, parcels: [{ parcelId: '27081.9058', address: '7911 W RIDGEWAY RD' }, { parcelId: '27081.9061', address: '7911 W RIDGEWAY RD' }] } } });
  p.input.value = '7911 W Ridgeway Rd';
  p.submit();
  await p.clock.advance(0);
  assert.equal(p.submits(), 0);
  const options = p.doc.getElementById('axAddrList').querySelectorAll('.ax-addr-item');
  assert.equal(options.length, 2);
  options[1].listeners.click[0]();
  assert.equal(p.input.value, '27081.9061');
  assert.equal(p.submits(), 1);
});

test('form: no county match -> Census, labelled approximate, map picker opened, no parcel selected', async () => {
  const markers = [];
  const L = {
    map: () => ({ setView() { return this; }, on() {}, getZoom: () => 17, invalidateSize() {}, closePopup() {} }),
    tileLayer: () => ({ addTo() { return this; } }),
    control: { layers: () => ({ addTo() {} }) },
    marker: () => { const m = { content: null, addTo() { return m; }, bindPopup(c) { m.content = c; return m; }, setPopupContent(c) { m.content = c; return m; }, openPopup() { return m; }, remove() {} }; markers.push(m); return m; }
  };
  const p = page({ state: 'ID', county: 'Bonner', routes: {
    resolve: { available: true, method: 'none', exact: false, parcels: [], point: null },
    census: { available: true, approximate: true, label: 'Approximate location — confirm the parcel', point: { lat: 48.27, lon: -116.55 }, matchedAddress: '100 MAIN ST, SANDPOINT, ID, 83864' },
    point: { available: true, parcels: [{ parcelId: 'RPS0129012004BA', address: '', county: 'Bonner', state: 'ID' }], near: false }
  } });
  p.h.ctx.L = L;
  p.input.value = '100 Main St Sandpoint';
  p.submit();
  await p.clock.advance(100);
  assert.deepEqual(p.calls.map(c => c.body.action), ['resolve', 'census', 'point']);
  assert.match(p.doc.getElementById('axAddrNote').textContent, /^Approximate location — confirm the parcel/);
  assert.equal(p.doc.getElementById('axAddrPicker').hidden, false);
  assert.equal(p.submits(), 0, 'a Census point never selects a parcel');
  const popup = markers.at(-1).content;
  assert.match(popup.textContent, /Approximate location — confirm the parcel.*Parcel RPS0129012004BA/);
  popup.querySelector('.ax-addr-pop-go').listeners.click[0]();
  assert.equal(p.input.value, 'RPS0129012004BA');
  assert.equal(p.submits(), 1, 'only after the user confirms');
});

test('form: Parcel not found -> format example, "Did you mean <county>?" and address search', async () => {
  const p = page({ state: 'MT', county: 'Gallatin', routes: {
    'other-counties': b => { assert.deepEqual(b, { action: 'other-counties', state: 'MT', county: 'Gallatin', parcelId: '07396611101010000' }); return { available: true, example: '06090630401080000', checked: ['statewide'], matches: [{ county: 'Flathead', parcelId: '07396611101010000', address: '510 FAIRMONT RD' }] }; }
  }, findParcel: async () => { throw new Error('Parcel not found in the Montana statewide cadastral database.'); } });
  p.input.value = '07396611101010000';
  await assert.rejects(p.h.ctx.findParcel('Gallatin', '07396611101010000'), /Parcel not found/);
  await p.clock.advance(10);
  const help = p.doc.getElementById('axParcelHelp');
  assert.ok(help, 'help panel shown');
  assert.match(help.textContent, /Gallatin County parcel numbers look like 06090630401080000/);
  assert.match(help.textContent, /Did you mean Flathead County\? Parcel 07396611101010000, 510 FAIRMONT RD/);
  assert.match(help.textContent, /Search by address/);
  const go = help.querySelectorAll('.ax-help-btn').find(b => /Search Flathead/.test(b.textContent));
  go.listeners.click[0]();
  assert.equal(p.countyEl.value, 'Flathead');
  assert.equal(p.submits(), 1);
});

test('form: other errors and saved-property lookups do not show the not-found help', async () => {
  const p = page({ routes: {}, findParcel: async () => { throw new Error('Parcel service returned 502'); } });
  p.input.value = '27081.9058';
  await assert.rejects(p.h.ctx.findParcel('Spokane', '27081.9058'));
  await p.clock.advance(10);
  assert.equal(p.doc.getElementById('axParcelHelp'), null);
  const q = page({ routes: {}, findParcel: async () => { throw new Error('Parcel not found.'); } });
  q.input.value = '27081.9058';
  await assert.rejects(q.h.ctx.findParcel('Spokane', '11111.1111'));
  await q.clock.advance(10);
  assert.equal(q.doc.getElementById('axParcelHelp'), null, 'a different number (a saved property) is not the form search');
  assert.equal(q.calls.length, 0);
});

test('the module is injected after state-selector and before browser-fallback', async () => {
  const html = await (await worker.fetch(new Request('https://acresx.test/'), { ASSETS: { fetch: async () => new Response(readPublic('index.html'), { headers: { 'Content-Type': 'text/html' } }) } }, {})).text();
  const scripts = [...html.matchAll(/<script src="\/([\w-]+)\.js"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('state-selector') < scripts.indexOf('address-search'));
  assert.ok(scripts.indexOf('address-search') < scripts.indexOf('browser-fallback'));
  assert.equal(scripts.at(-1), 'browser-fallback');
});
