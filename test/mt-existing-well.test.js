// Montana existing-well match (POST /api/existing-well with state MT,
// src/services/existing-well-montana.js; owner request 2026-11-18, Yellowstone
// 03113503101110000). Offline: fetch is stubbed with answers recorded from MBMG GWIC, DNRC water
// rights and the MT cadastral on 2026-11-18, owner names replaced with fake names
// (test/fixtures/mt-existing-well-03113503101110000.json), plus small synthetic parcels.
// Also: the dashboard card (public/existing-well.js) and the report line
// (public/property-report-v2.js) for that answer, and that owner names never reach either.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { gwicPrecision, podPrecision, MT_EXISTING_WELL_CACHE_PREFIX } from '../src/services/existing-well-montana.js';
import { makeClock, makeContext, makeFetch, readPublic, renderReport } from './ui-harness.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/mt-existing-well-03113503101110000.json', import.meta.url), 'utf8'));
const FAKE_NAMES = /FAKEOWNER|TESTER SAM|SAMPLE RIVER|EXAMPLE PAT|PLACEHOLDER LEE|DUMMY ROWAN|MOCK AVERY|FICTION QUINN|NOBODY KAI|ALEX|JORDAN/;
const PERSONAL_KEYS = /^(site_name|OWNERS|OwnerName|owner|ownerName|currentOwner)$/i;

const realFetch = globalThis.fetch, realCaches = globalThis.caches;
let restoreUpstream, calls, store;

beforeEach(() => { restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} }); calls = []; store = null; });
afterEach(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; restoreUpstream(); });

const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
// routes: { gwic, rights, owner, yield } -> array of features, a Response, or a function(url).
function stub(routes) {
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url);
    const pick = /GWIC_Database\/FeatureServer\/4\//.test(url.pathname) ? routes.gwic
      : /GWIC_Database\/FeatureServer\/11\//.test(url.pathname) ? routes.yield
      : /WRD\/WRQS\/MapServer\/1\//.test(url.pathname) ? routes.rights
      : /DNRALL\/Cadastral\/FeatureServer\/0\//.test(url.pathname) ? routes.owner
      : null;
    if (pick == null) throw new Error(`unexpected request ${url.host}${url.pathname}`);
    const value = typeof pick === 'function' ? pick(url) : pick;
    return value instanceof Response ? value : json({ features: value });
  };
}
const ownerRow = (name, parcelId = FX.parcelId) => [{ attributes: { PARCELID: parcelId, OwnerName: name } }];
const fixtureRoutes = (extra = {}) => ({
  gwic: FX.gwic, rights: FX.waterRights, owner: ownerRow(FX.cadastralOwner),
  yield: url => (/gwicid = 161578/.test(url.searchParams.get('where')) ? [{ attributes: { gwicid: 161578, yield_gpm: FX.gwicYield['161578'] } }] : []),
  ...extra
});
const down = () => new Response('down', { status: 500 });

async function post(body) {
  const response = await worker.fetch(new Request('https://acresx.test/api/existing-well', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {}, { waitUntil() {} });
  return { response, body: await response.json() };
}
const fixtureRequest = () => post({ state: 'MT', county: 'Yellowstone', parcelId: FX.parcelId, geometry: FX.geometry });

function keysDeep(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => keysDeep(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); keysDeep(v, out); }
  return out;
}
function assertNoOwner(value, where) {
  assert.deepEqual(keysDeep(value).filter(k => PERSONAL_KEYS.test(k)), [], `${where}: no owner keys`);
  assert.doesNotMatch(JSON.stringify(value), FAKE_NAMES, `${where}: no owner names`);
}

// A ~200 m square parcel near Worden, MT, and points relative to it.
const LON = -108.2, LAT = 45.95, D = 0.0026;
const square = { type: 'Polygon', coordinates: [[[LON, LAT], [LON + D, LAT], [LON + D, LAT + D], [LON, LAT + D], [LON, LAT]]] };
const PID = '03000000000000000';
const gwicWell = (id, x, y, extra = {}) => ({ attributes: { gwicid: id, site_name: 'NOBODY KAI * WORDEN MT', geomethod: 'NAV-GPS', qsection: 'ABAA', geocode: null, total_depth_ft_bgs: 180, static_water_level_ft_bgs: 40, date_completed: Date.UTC(2004, 5, 1), status: 'NEW WELL', site_type: 'WELL', abandoned_flag: null, ...extra }, geometry: { x, y } });
const squareRequest = () => post({ state: 'MT', county: 'Gallatin', parcelId: PID, geometry: square });
const centre = [LON + D / 2, LAT + D / 2];

// ---- Location precision

test('GWIC location precision: GPS and map points are precise; TRS-SEC is a tract from qsection; no qsection = section centre', () => {
  assert.equal(gwicPrecision('NAV-GPS', 'AB').kind, 'precise');
  assert.equal(gwicPrecision('MAP', '').kind, 'precise');
  assert.deepEqual([gwicPrecision('TRS-SEC', 'ABA').kind, gwicPrecision('TRS-SEC', 'ABA').tractAcres], ['tract', 10]);
  assert.equal(gwicPrecision('TRS-SEC', 'AC').tractAcres, 40);
  assert.deepEqual([gwicPrecision('TRS-SEC', null).kind, gwicPrecision('TRS-SEC', null).tractAcres], ['section', 640]);
  assert.equal(gwicPrecision('TRS-TWN', '').kind, 'township');
  assert.equal(gwicPrecision('', '').kind, 'unknown');
  assert.equal(podPrecision('T2N R28E Sec. 3 NWNWNE').tractAcres, 10);
  assert.equal(podPrecision('T2N R28E Sec. 3').kind, 'section');
});

// ---- The owner's parcel (recorded answers)

test('Yellowstone 03113503101110000: the GWIC well in the parcel is a recorded well on this parcel, with the DNRC right as a second record', async () => {
  stub(fixtureRoutes());
  const { response, body } = await fixtureRequest();
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.status, 'strong_match');
  assert.equal(body.confidence, 'High');
  assert.equal(body.summary, 'Recorded well on this parcel (GWIC #161578, 25 ft, 1994); a state groundwater right also lists this parcel');
  const m = body.match;
  assert.equal(m.source, 'gwic');
  assert.equal(m.gwicId, '161578');
  assert.equal(m.completedDepth, 25);
  assert.equal(m.completionYear, 1994);
  assert.equal(m.staticWaterLevelFt, 6);
  assert.equal(m.yieldGpm, 20);
  assert.equal(m.locationMethod, 'TRS-SEC');
  assert.deepEqual(m.locationPrecision, { kind: 'tract', tractAcres: 10 });
  assert.match(m.recordUrl, /^https:\/\/mbmggwic\.mtech\.edu\/.*gwicid=161578/);
  assert.equal(m.evidence.onParcel, true);
  assert.equal(m.evidence.insideParcel, true);
  assert.equal(m.evidence.tractShareInParcel, 1);
  assert.equal(m.evidence.ownerChecked, true);
  assert.equal(m.evidence.ownerMatch, false, 'the 1994 well owner is not the current owner');
  assert.equal(m.evidence.addressMatch, null, 'GWIC has no well address');
  assert.ok(body.score >= 55, 'score agrees with onParcel for the score >= 55 readers');
  const wr = body.waterRight;
  assert.equal(wr.waterRightNumber, '43Q 30116514');
  assert.equal(wr.type, 'GROUND WATER CERTIFICATE');
  assert.equal(wr.evidence.geocodeListed, true);
  assert.equal(wr.evidence.onParcel, true);
  assert.equal(wr.evidence.ownerMatch, true, 'the current owner holds the water right');
  assert.match(wr.recordUrl, /^https:\/\/wrqsproxy\.dnrc\.mt\.gov\//);
  assert.deepEqual(body.sourceStatus, { gwic: 'ok', waterRights: 'ok', assessor: 'checked' });
  assertNoOwner(body, 'answer');
  // Owner fields are requested for the comparison (internal), with no other personal fields.
  const asked = name => calls.filter(u => u.pathname.includes(name)).map(u => u.searchParams.get('outFields')).join(' ');
  assert.match(asked('FeatureServer/4'), /site_name/);
  assert.match(asked('WRQS'), /OWNERS/);
  assert.equal(asked('Cadastral'), 'PARCELID,OwnerName');
});

// ---- Synthetic parcels

test('a precise (GPS) well point inside the parcel: recorded well on this parcel, high confidence', async () => {
  stub({ gwic: [gwicWell(9001, ...centre)], rights: [], owner: ownerRow('SOMEONE ELSE', PID), yield: [] });
  const { body } = await squareRequest();
  assert.equal(body.status, 'strong_match');
  assert.equal(body.confidence, 'High');
  assert.equal(body.summary, 'Recorded well on this parcel (GWIC #9001, 180 ft, 2004)');
  assert.equal(body.match.evidence.onParcel, true);
  assert.equal(body.match.evidence.ownerMatch, false);
});

test('a TRS-SEC section-centre point inside the parcel is never "on this parcel", even with an owner match', async () => {
  const sectionCentre = gwicWell(9002, ...centre, { geomethod: 'TRS-SEC', qsection: null, site_name: 'FAKEOWNER ALEX * WORDEN MT' });
  stub({ gwic: [sectionCentre], rights: [], owner: ownerRow('FAKEOWNER ALEX & JORDAN', PID), yield: [] });
  const { body } = await squareRequest();
  assert.notEqual(body.status, 'strong_match');
  assert.ok(body.score < 55);
  const e = body.match?.evidence;
  assert.ok(e, 'kept as a low-confidence possible record');
  assert.equal(e.onParcel, false);
  assert.equal(e.insideParcel, false);
  assert.equal(e.pointInParcel, true);
  assert.equal(e.sectionCentreOnly, true);
  assert.equal(e.ownerMatch, true);
  assert.doesNotMatch(body.summary, /^Recorded well/);
  assert.equal(body.summary, 'Possible well record near this parcel (low confidence)');
  assertNoOwner(body, 'section-centre answer');
});

test('owner match: a GPS well 40 m outside the parcel counts with the owner match, not without it', async () => {
  const outside = [LON + D + 0.0005, LAT + D / 2]; // ~39 m east of the east edge
  stub({ gwic: [gwicWell(9003, ...outside, { site_name: 'FAKEOWNER ALEX J * WORDEN MT' })], rights: [], owner: ownerRow('FAKEOWNER ALEX & JORDAN', PID), yield: [] });
  const matched = (await squareRequest()).body;
  assert.equal(matched.match.evidence.ownerMatch, true);
  assert.equal(matched.match.evidence.insideParcel, false);
  assert.equal(matched.match.evidence.onParcel, true);
  assert.equal(matched.status, 'strong_match');
  assertNoOwner(matched, 'owner-matched answer');

  stub({ gwic: [gwicWell(9003, ...outside)], rights: [], owner: ownerRow('FAKEOWNER ALEX & JORDAN', PID), yield: [] });
  const unmatched = (await squareRequest()).body;
  assert.equal(unmatched.match.evidence.ownerMatch, false);
  assert.equal(unmatched.status, 'possible_match');
  assert.equal(unmatched.confidence, 'Low');
  assert.equal(unmatched.summary, 'Possible well record near this parcel (low confidence)');
});

test('a GWIC geocode equal to the parcel is a parcel match', async () => {
  const far = [LON - 0.003, LAT - 0.003];
  stub({ gwic: [gwicWell(9004, ...far, { geomethod: 'TRS-SEC', qsection: '', geocode: '03-0000-00-0-00-00-0000' })], rights: [], owner: ownerRow('', PID), yield: [] });
  const { body } = await squareRequest();
  assert.equal(body.match.evidence.parcelMatch, true);
  assert.equal(body.status, 'strong_match');
});

test('nothing near the parcel: no match', async () => {
  stub({ gwic: [gwicWell(9005, LON - 0.004, LAT - 0.004)], rights: [], owner: ownerRow('SOMEONE', PID), yield: [] });
  const { body } = await squareRequest();
  assert.equal(body.available, true);
  assert.equal(body.status, 'no_match');
  assert.equal(body.match, null);
  assert.equal(body.summary, 'No recorded well matched to this parcel');
});

test('both well sources down: available false ("unavailable"), JSON 200, not cached', async () => {
  store = fakeCache();
  stub({ gwic: down, rights: down, owner: down, yield: down });
  const { response, body } = await squareRequest();
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.status, 'unavailable');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(store.size, 0);
});

test('one source down: the other still answers (partial), and a partial answer is not cached', async () => {
  store = fakeCache();
  stub({ gwic: [gwicWell(9006, ...centre)], rights: down, owner: down, yield: [] });
  const { response, body } = await squareRequest();
  assert.equal(body.available, true);
  assert.equal(body.partial, true);
  assert.equal(body.status, 'strong_match');
  assert.deepEqual(body.sourceStatus, { gwic: 'ok', waterRights: 'unavailable', assessor: 'unavailable' });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(store.size, 0);
});

test('a complete answer is cached under the versioned prefix, owner-free, and served without upstream calls', async () => {
  store = fakeCache();
  stub(fixtureRoutes());
  const first = (await fixtureRequest()).body;
  assert.equal(store.size, 1);
  const [[key, text]] = [...store.entries()];
  assert.ok(key.startsWith(MT_EXISTING_WELL_CACHE_PREFIX), key);
  assert.match(MT_EXISTING_WELL_CACHE_PREFIX, /^https:\/\/acresx\.internal\/cache\/mt-existing-well\/v\d+\/$/);
  assertNoOwner(JSON.parse(text), 'cached answer');
  const before = calls.length;
  const second = (await fixtureRequest()).body;
  assert.equal(calls.length, before, 'no upstream call on a cache hit');
  assert.deepEqual(second, first);
});

test('owner lookup down: still answers (partial, owner not checked), and is not cached', async () => {
  store = fakeCache();
  stub(fixtureRoutes({ owner: down }));
  const { response, body } = await fixtureRequest();
  assert.equal(body.available, true);
  assert.equal(body.status, 'strong_match');
  assert.equal(body.partial, true);
  assert.equal(body.sourceStatus.assessor, 'unavailable');
  assert.equal(body.match.evidence.ownerChecked, false);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(store.size, 0);
});

test('the request\'s address is echoed to that caller only, never stored in or served from the cache', async () => {
  store = fakeCache();
  stub(fixtureRoutes());
  const first = await post({ state: 'MT', county: 'Yellowstone', parcelId: FX.parcelId, geometry: FX.geometry, address: '111 FIRST CALLER RD' });
  assert.equal(first.body.siteAddress, '111 FIRST CALLER RD');
  assert.equal(store.size, 1);
  assert.doesNotMatch([...store.values()].join(''), /FIRST CALLER/);
  const before = calls.length;
  const second = await post({ state: 'MT', county: 'Yellowstone', parcelId: FX.parcelId, geometry: FX.geometry, address: '222 SECOND CALLER RD' });
  assert.equal(calls.length, before, 'served from the cache');
  assert.equal(second.body.siteAddress, '222 SECOND CALLER RD');
  assert.doesNotMatch(JSON.stringify(second.body), /FIRST CALLER/);
  const third = await post({ state: 'MT', county: 'Yellowstone', parcelId: FX.parcelId, geometry: FX.geometry });
  assert.equal(third.body.siteAddress, '');
});

test('missing geometry: JSON 400', async () => {
  stub({ gwic: [], rights: [], owner: [], yield: [] });
  const { response, body } = await post({ state: 'MT', county: 'Yellowstone', parcelId: FX.parcelId });
  assert.equal(response.status, 400);
  assert.match(body.error, /geometry/);
});

function fakeCache() {
  const map = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = map.get(req.url); return hit ? new Response(hit) : undefined; },
    async put(req, res) { map.set(req.url, await res.text()); }
  } };
  return map;
}

// ---- Dashboard card and report

async function mtAnswer() {
  stub(fixtureRoutes());
  return (await fixtureRequest()).body;
}

test('dashboard card (public/existing-well.js): the Montana line, the record link, no owner names', async () => {
  const answer = await mtAnswer();
  const clock = makeClock();
  const { fetch, calls: browserCalls } = makeFetch(clock, { '/api/existing-well': { body: answer } });
  const h = makeContext({
    clock, fetch, extra: { console: { ...console, warn() {} } },
    body: [['div', { id: 'state' }], ['div', { id: 'county' }], ['div', { id: 'results' }],
      ['button', { class: 'card snapshot-card', 'data-detail': 'wells' }, '', [['div', { id: 'wellMetric' }, '24 ft'], ['div', { id: 'waterStatus' }], ['div', { id: 'wellNote' }]]]]
  });
  h.ctx.__parcel = { type: 'Feature', geometry: FX.geometry, properties: { ORIG_PARCEL_ID: FX.parcelId, _countyDisplay: 'Yellowstone', _stateCode: 'MT' } };
  h.run('var last = { parcel: __parcel, wells: [] }; var activeTab = "wells"; function renderSummary() {} function renderResults() {}', 'index-inline.js');
  h.run(readPublic('existing-well.js'), 'existing-well.js');
  h.run('renderSummary(last.parcel); renderResults();');
  await clock.advance(100);
  assert.equal(browserCalls.length, 1);
  assert.equal(browserCalls[0].body.state, 'MT');
  const card = h.document.querySelector('.existing-well-summary');
  assert.match(card.innerHTML, /Recorded well on this parcel \(GWIC #161578, 25 ft, 1994\)/);
  assert.match(card.innerHTML, /Mapped well location falls within parcel/);
  assert.equal(h.document.getElementById('wellMetric').textContent, 'Existing well · 25 ft');
  const detail = h.document.querySelector('.existing-well-detail');
  assert.match(detail.innerHTML, /GWIC well record/);
  assert.match(detail.innerHTML, /20 gpm/);
  assert.match(detail.innerHTML, /DNRC groundwater right 43Q 30116514 lists this parcel/);
  for (const html of [card.innerHTML, detail.innerHTML, h.document.getElementById('waterStatus').textContent]) assert.doesNotMatch(html, FAKE_NAMES);
});

test('report (public/property-report-v2.js): the water card carries the Montana line, never owner names', async () => {
  const answer = await mtAnswer();
  const data = JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
  data.existingWell = answer;
  const html = renderReport({ data });
  assert.match(html, /Recorded well on this parcel \(GWIC #161578, 25 ft, 1994\)/);
  assert.doesNotMatch(html, FAKE_NAMES);
});
