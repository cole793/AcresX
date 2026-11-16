// UI gaps found driving the live site (2026-11-14): Montana overview acreage/address/record link,
// Kootenai county record link, one state-following beta label, the "No Listing Match" card
// collapsing to a one-line note, /api/listing-search-status (listing evidence 503 skipped), and
// the phone layout rules. Offline: fake DOMs from test/ui-harness.js, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { listingSearchProviders } from '../src/services/listing-search-status.js';
import { mapKootenaiParcel, KC_PROPERTY_SEARCH } from '../src/counties/kootenai-parcels.js';
import { El, makeLazyContext, makeContext, makeClock, makeFetch, readPublic, acresToSqm } from './ui-harness.js';

const square = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
const CADASTRAL = 'https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=03072527101010000';

// Recorded 2026-11-15 from the live /api/property-assessment for Yellowstone 03072527101010000
// (the statewide record, trimmed to the fields read here).
const yellowstoneAssessment = (extra = {}) => ({
  available: true, state: 'MT', county: 'Yellowstone', parcelId: '03072527101010000',
  statewideRecords: [{ PARCELID: '03072527101010000', TaxYear: 2026, AddressLine1: '', AddressLine2: '', CityStateZip: null, TotalAcres: 280, TotalBuildingValue: 0, TotalLandValue: 16479, TotalValue: 16479, PropertyCardLink: CADASTRAL, ...extra }]
});
// The Yellowstone tax-parcel layer record as /api/parcel-search returns it: no acres, no address.
const yellowstoneParcel = () => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '03072527101010000', PARCEL_ID_NR: '03072527101010000', _countyDisplay: 'Yellowstone', _stateCode: 'MT', _stateDisplay: 'Montana', SITUS_ADDRESS: '', SITUS_CITY_NM: '', SITUS_ZIP_NR: '', DATA_LINK: 'https://www.yellowstonecountymt.gov/Treasurer/PropertySearch/' } });

function overview(parcel, mappedAcres) {
  const h = makeLazyContext({ mappedSqm: acresToSqm(mappedAcres), last: { parcel, wells: [], utility: [] } });
  h.run('function renderSummary(){}');
  h.run(readPublic('acreage.js'));
  h.run(readPublic('parcel-preview.js'));
  h.run('renderSummary()');
  h.context.URL = URL;
  h.run(readPublic('property-assessment.js'));
  let refreshed = 0;
  h.context.AcresXQuickActions = { refresh: () => { refreshed++; } };
  const read = () => ({ heading: h.el('overviewAddress').textContent, noAddress: !h.el('overviewNoAddress').hidden, acres: h.el('overviewAcres').textContent, detail: h.el('overviewSqFt').textContent });
  return { h, read, refreshed: () => refreshed, A: h.context.AcresXAssessment };
}

test('Montana assessment: TotalAcres, situs address and the cadastral record link are read', () => {
  const { A } = overview(yellowstoneParcel(), 280.65);
  const r = A.normalize(yellowstoneAssessment({ AddressLine1: '1234 ROAD 5', CityStateZip: 'BILLINGS, MT 59101' }));
  assert.equal(r.assessorAcres, 280);
  assert.equal(r.situsAddress, '1234 ROAD 5');
  assert.equal(r.situsCity, 'BILLINGS, MT 59101');
  assert.equal(r.propertySearchUrl, CADASTRAL);
  assert.match(r.propertySearchLabel, /Montana Cadastral/);
  assert.ok(Number.isNaN(A.normalize(yellowstoneAssessment({ TotalAcres: null })).assessorAcres), 'missing acres stay missing');
});

test('Montana cadastral link: only svc.mt.gov PropertyDetails for the same 17-digit geocode', () => {
  const { A } = overview(yellowstoneParcel(), 1);
  const id = '03072527101010000';
  assert.equal(A.cadastralUrl(CADASTRAL, id), CADASTRAL);
  assert.equal(A.cadastralUrl('https://svc.mt.gov/msl/cadastral/?page=PropertyDetails&geocode=03-0725-27-1-01-01-0000', id), CADASTRAL, 'formatted geocode');
  for (const bad of [
    CADASTRAL.replace('svc.mt.gov', 'evil.example'), CADASTRAL.replace('https:', 'http:'), CADASTRAL.replace('/msl/cadastral/', '/other/'),
    `${CADASTRAL}&redirect=https://evil.example`, CADASTRAL.replace('PropertyDetails', 'Search'), CADASTRAL.replace('03072527101010000', '03072527101010001'),
    'javascript:alert(1)', '', null
  ]) assert.equal(A.cadastralUrl(bad, id), '', String(bad));
  assert.equal(A.cadastralUrl(CADASTRAL, 'D03781'), '', 'not a geocode');
});

test('Yellowstone overview: acres not square feet, "No situs address on record", then assessor acres and the cadastral link', () => {
  const o = overview(yellowstoneParcel(), 280.66);
  assert.deepEqual(o.read(), { heading: 'Parcel 03072527101010000', noAddress: true, acres: '280.7', detail: '280.7 ac mapped' });
  const result = o.A.normalize(yellowstoneAssessment());
  o.A.shareAssessorAcres(result);
  o.A.shareRecordDetails(result);
  assert.deepEqual(o.read(), { heading: 'Parcel 03072527101010000', noAddress: true, acres: '280.0', detail: '280.0 ac (assessor) · 280.7 ac mapped' });
  const props = o.h.context.last.parcel.properties;
  assert.equal(props.DATA_LINK, CADASTRAL, 'the generic Treasurer search gives way to the parcel record');
  assert.equal(o.refreshed(), 1, 'quick actions redrawn');
});

test('Montana situs address from the cadastral record fills an empty parcel address', () => {
  const o = overview(yellowstoneParcel(), 280.65);
  o.A.shareRecordDetails(o.A.normalize(yellowstoneAssessment({ AddressLine1: '1234 ROAD 5', CityStateZip: 'BILLINGS, MT 59101' })));
  assert.deepEqual(o.read().heading, '1234 ROAD 5, BILLINGS, MT 59101');
  assert.equal(o.read().noAddress, false);
});

test('a parcel with its own address and county record keeps them', () => {
  const parcel = { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: '23123.9051', _countyDisplay: 'Spokane', SITUS_ADDRESS: '', SITUS_CITY_NM: 'CHENEY', SITUS_ZIP_NR: '99004', DATA_LINK: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051', ACRES: 20.48 } };
  const o = overview(parcel, 20.63);
  assert.deepEqual(o.read(), { heading: 'CHENEY, 99004', noAddress: false, acres: '20.48', detail: '20.48 ac (assessor) · 20.63 ac mapped' });
  o.A.shareRecordDetails({ situsAddress: 'X', propertySearchUrl: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051' });
  assert.equal(o.read().heading, 'CHENEY, 99004');
  assert.equal(o.refreshed(), 0);
});

test('Kootenai parcels link the county assessor property search; quick action says "property search"', () => {
  const p = mapKootenaiParcel({ PIN: '50N04W323200', Acres: 11.703 }, square).properties;
  assert.equal(p.DATA_LINK, KC_PROPERTY_SEARCH);
  assert.equal(new URL(KC_PROPERTY_SEARCH).protocol, 'https:');
  const fallback = readPublic('browser-fallback.js');
  assert.ok(fallback.includes(`DATA_LINK: '${KC_PROPERTY_SEARCH}'`), 'browser fallback answers the same link (parity)');
  const scoreCost = readPublic('score-cost.js');
  assert.match(scoreCost, /propertysearch\/i\.test\(assessor\) \? 'Open county property search ↗' : 'Open county record ↗'/);
});

// ---- One beta label that follows the selected state ----
function labelPage(state) {
  const clock = makeClock();
  const page = makeContext({ clock, fetch: () => Promise.reject(new Error('offline')), body: [
    ['aside', { class: 'sidebar' }, '', [['div', { class: 'side-note' }, '', [['strong', {}, 'Washington beta']]], ['div', { class: 'version' }, 'AcresX v0.13 Feasibility Engine']]],
    ['header', { class: 'topbar' }, '', [['div', { class: 'eyebrow' }, 'Washington beta']]],
    ['select', { id: 'state' }]
  ] });
  page.document.title = 'AcresX | Washington Land Intelligence';
  page.document.getElementById('state').value = state;
  page.run(readPublic('beta-labels.js'), 'beta-labels.js');
  const q = s => page.document.querySelector(s).textContent;
  return { page, read: () => ({ note: q('.side-note strong'), version: q('.version'), eyebrow: q('.topbar .eyebrow'), title: page.document.title }) };
}

test('beta label: Montana selected -> every label says Montana', () => {
  assert.deepEqual(labelPage('MT').read(), { note: 'Montana beta', version: 'AcresX Montana beta', eyebrow: 'Montana beta', title: 'AcresX | Montana Land Intelligence' });
});

test('beta label: no state yet -> Northwest; follows a later state change', () => {
  const { page, read } = labelPage('');
  assert.deepEqual(read(), { note: 'Northwest beta', version: 'AcresX Northwest beta', eyebrow: 'Northwest beta', title: 'AcresX | Northwest Land Intelligence' });
  const select = page.document.getElementById('state');
  select.value = 'ID';
  select.listeners.change.forEach(fn => fn());
  assert.equal(read().version, 'AcresX Idaho beta');
});

test('beta label: leaves the page title alone while the report view is open (html.arv-open), so the PDF keeps the report name', () => {
  const { page, read } = labelPage('MT');
  page.document.documentElement = new El('html', page.document);
  page.document.documentElement.classList.add('arv-open');
  page.document.title = 'Parcel 1 — AcresX Property Report';
  page.ctx.AcresXBetaLabel.apply();
  assert.equal(read().title, 'Parcel 1 — AcresX Property Report');
  assert.equal(read().version, 'AcresX Montana beta', 'the other labels still update');
  page.document.documentElement.classList.remove('arv-open');
  page.ctx.AcresXBetaLabel.apply();
  assert.equal(read().title, 'AcresX | Montana Land Intelligence');
});

test('no script writes its own version label any more', () => {
  for (const name of ['score-cost.js', 'parcel-preview.js', 'ui-polish.js']) {
    assert.doesNotMatch(readPublic(name), /\.version'\)[\s\S]{0,80}textContent\s*=/, name);
  }
});

// ---- Listing Context card collapses when nothing matched ----
async function listingPage(reso, evidence) {
  const clock = makeClock();
  const { fetch } = makeFetch(clock, { '/api/reso-listings': { body: reso } });
  const page = makeContext({ clock, fetch, body: [
    ['section', { id: 'dashboard', class: 'dashboard show' }, '', [
      ['div', { class: 'snapshot-grid' }, '', [
        ['button', { class: 'card snapshot-card', 'data-detail': 'wells' }],
        ['button', { class: 'card snapshot-card', 'data-detail': 'listing' }]
      ]]
    ]]
  ] });
  page.ctx.last = { parcel: { parcelId: '23123.9051', lat: 47.49, lon: -117.45 }, evidence };
  // lookup() is scheduled by renderSummary / the dashboard observer; the test calls it directly.
  page.run(readPublic('reso-listing-context.js').replace('wireDetails();', 'wireDetails(); window.__lookup = lookup;'), 'reso-listing-context.js');
  const done = page.ctx.__lookup();
  await clock.advance(10);
  await done;
  const card = page.document.querySelector('.snapshot-card[data-detail="listing"]');
  return { card, note: page.document.getElementById('listingNoMatchNote'), style: page.document.getElementById('listingCollapseStyles') };
}

test('listing: no RESO match and no web match -> card hidden, one-line note under the grid', async () => {
  const { card, note, style } = await listingPage({ available: true, best: null }, { status: 'unavailable', configured: false });
  assert.ok(card.classList.contains('listing-collapsed'));
  assert.match(note.textContent, /Listing context:No matching listing found in the connected listing dataset\. This does not mean the property is not listed\./);
  assert.ok(style.textContent.includes('.listing-collapsed{display:none!important}'));
  assert.ok(style.textContent.includes('repeat(4,1fr)'), 'desktop grid closes the gap');
});

test('listing: RESO source not configured -> the note says listings were not checked', async () => {
  const { note } = await listingPage({ available: false, configured: false }, null);
  assert.match(note.textContent, /No listing dataset is connected/);
});

test('listing: a RESO match keeps the full card', async () => {
  const { card, note } = await listingPage({ available: true, best: { status: 'Active', listPrice: 250000 } }, null);
  assert.equal(card.classList.contains('listing-collapsed'), false);
  assert.equal(note, null);
});

test('listing: a web listing match keeps the full card', async () => {
  const { card, note } = await listingPage({ available: true, best: null }, { status: 'found', claims: [] });
  assert.equal(card.classList.contains('listing-collapsed'), false);
  assert.equal(note, null);
});

// ---- /api/listing-search-status and the page skipping /api/listing-evidence ----
test('listing search status: configured only with a provider secret; never returns a secret', async () => {
  assert.deepEqual(listingSearchProviders({}), []);
  assert.deepEqual(listingSearchProviders({ SERPER_API_KEY: '  ' }), []);
  assert.deepEqual(listingSearchProviders({ GOOGLE_SEARCH_API_KEY: 'g' }), [], 'Google needs the engine id too');
  assert.deepEqual(listingSearchProviders({ SERPER_API_KEY: 's', GOOGLE_SEARCH_API_KEY: 'g', GOOGLE_SEARCH_ENGINE_ID: 'e' }), ['Serper', 'Google Custom Search']);
  const env = { SERPER_API_KEY: 'secret-value-123', ASSETS: { fetch: () => new Response('') } };
  const res = await worker.fetch(new Request('https://acresx.test/api/listing-search-status'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { configured: true, providers: ['Serper'] });
  assert.ok(!text.includes('secret-value-123'));
  const none = await worker.fetch(new Request('https://acresx.test/api/listing-search-status'), { ASSETS: env.ASSETS }, { waitUntil() {} });
  assert.deepEqual(await none.json(), { configured: false, providers: [] });
});

function listingEvidencePage(routes) {
  const lines = readPublic('index.html').split('\n');
  const start = lines.findIndex(l => l.startsWith('let listingSearchReady='));
  const end = lines.findIndex((l, i) => i > start && l === '}');
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(String(url));
    const r = routes[String(url)];
    if (!r) throw new Error(`no stub for ${url}`);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const clock = makeClock();
  const page = makeContext({ clock, fetch, extra: { turf: { centroid: () => ({ geometry: { coordinates: [-117.4, 47.5] } }) } } });
  page.run(`${lines.slice(start, end + 1).join('\n')}\nwindow.find = findListingEvidence;`, 'index.html');
  const parcel = { properties: { ORIG_PARCEL_ID: '23123.9051', SITUS_ADDRESS: '1 MAIN ST' } };
  return { calls, find: () => page.ctx.find(parcel) };
}

test('listing evidence: no provider configured -> no /api/listing-evidence call, quiet "not configured" answer', async () => {
  const p = listingEvidencePage({ '/api/listing-search-status': { status: 200, body: { configured: false, providers: [] } } });
  const a = await p.find();
  const b = await p.find();
  assert.equal(a.status, 'unavailable');
  assert.equal(a.configured, false);
  assert.equal(a.error, undefined, 'not reported as an error');
  assert.deepEqual(b, a);
  assert.deepEqual(p.calls, ['/api/listing-search-status'], 'status asked once per page load');
});

test('listing evidence: configured -> calls the endpoint; a 503 "unavailable" stops later calls', async () => {
  const p = listingEvidencePage({
    '/api/listing-search-status': { status: 200, body: { configured: true, providers: ['Serper'] } },
    '/api/listing-evidence': { status: 503, body: { status: 'unavailable', error: 'Set SERPER_API_KEY …', claims: [], matches: [] } }
  });
  assert.equal((await p.find()).configured, false);
  await p.find();
  assert.deepEqual(p.calls, ['/api/listing-search-status', '/api/listing-evidence']);
});

test('listing evidence: an older Worker without the status route still searches', async () => {
  const p = listingEvidencePage({
    '/api/listing-search-status': { status: 404, body: { error: 'API route not found' } },
    '/api/listing-evidence': { status: 200, body: { status: 'none', claims: [], matches: [] } }
  });
  assert.equal((await p.find()).status, 'none');
});

// ---- Phone layout ----
test('phone layout: static top bar, bottom nav padding with safe area, 44px targets, phone-only', () => {
  const css = readPublic('mobile-layout.js');
  const phone = css.slice(css.indexOf('@media(max-width:700px)'));
  assert.ok(css.indexOf('@media(max-width:700px)') > 0);
  assert.match(phone, /\.topbar\{position:relative!important/);
  assert.match(phone, /\.app\{padding-bottom:calc\(\$\{NAV \+ 16\}px \+ env\(safe-area-inset-bottom, 0px\)\)!important\}/);
  assert.match(phone, /\.sidebar\{height:calc\(\$\{NAV\}px \+ env\(safe-area-inset-bottom/);
  assert.match(phone, /\.property-quick-action,\.snapshot-details-btn,\.map-tool[^{]*\{min-height:44px\}/);
  assert.match(phone, /\.top-actions \.ghost,\.top-actions \.primary\{min-height:44px/);
  assert.doesNotMatch(css, /search-form|#parcel|#county|#state/, 'search form untouched');
  // Every rule is inside a phone media query: no rule before the first one, and each block is a
  // max-width query of 700px or less.
  const body = css.slice(css.indexOf('textContent = `') + 15, css.lastIndexOf('`'));
  assert.doesNotMatch(body.slice(0, body.indexOf('@media')), /\{/);
  const queries = [...body.matchAll(/@media\(([^)]*)\)/g)].map(m => m[1]);
  assert.ok(queries.length >= 1 && queries.every(q => /^max-width:\d+px$/.test(q) && Number(q.match(/\d+/)[0]) <= 700), queries.join(' | '));
});

test('new modules are injected into the page', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const name of ['beta-labels', 'mobile-layout']) assert.ok(index.includes(`'${name}'`), name);
});
