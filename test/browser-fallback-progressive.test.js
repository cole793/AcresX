// The browser fallback inside progressive loading, end to end and offline. The real
// public/progressive-loading.js and public/browser-fallback.js run in node:vm on the fake DOM and
// manual clock from test/ui-harness.js. The page's /api/* calls go to the real Worker
// (src/index.js), whose upstream fetch fails the way it did on 2026-10-29 (map.kcgov.us and
// gis.idwr.idaho.gov time out, FEMA 525). Requests the browser module makes to government hosts
// are answered from test/fixtures/browser-fallback-50N04W323200.json, recorded live from a
// browser-like client on 2026-10-29 (IDWR WellAddress replaced with a placeholder).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { configureUpstream } from '../src/shared/upstream.js';
import { makeClock, makeContext, readPublic } from './ui-harness.js';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/browser-fallback-50N04W323200.json', import.meta.url), 'utf8'));
const PIN = '50N04W323200';
const ALLOWED = ['map.kcgov.us', 'gis.cdaid.org', 'gis.postfalls.gov', 'gis.idwr.idaho.gov', 'hazards.fema.gov'];
const IDWR_WELLS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0/query';
const KC_CITY_LIMITS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query';
const KC_PARCELS = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query';

const fact = id => ['div', { class: 'property-overview-fact' }, '', [['span', {}, id], ['strong', { id }, '—']]];
const card = (detail, metric, status, foot) => ['article', { class: 'card snapshot-card', 'data-detail': detail }, '', [
  ['div', { class: 'snapshot-value', id: metric }, '—'], ['span', { id: status }, 'Pending'], ...(foot ? [['div', { id: foot, class: 'snapshot-foot' }, '']] : [])
]];
const PAGE = [
  ['div', { id: 'status', class: 'status' }],
  ['section', { id: 'emptyState' }],
  ['section', { id: 'dashboard', class: 'dashboard' }, '', [
    ['div', { class: 'property-overview-facts' }, '', ['overviewParcelId', 'overviewAddress', 'overviewAcres', 'overviewUtility', 'overviewFlood', 'overviewWetlands', 'overviewSoil', 'overviewWellDepth', 'overviewAvgGrade'].map(fact)],
    ['div', { class: 'overview-grid' }, '', [
      ['article', { class: 'card score-card' }, '', [['div', { id: 'scoreMetric', class: 'metric-value' }, '—'], ['div', { id: 'scoreNote' }, '']]]
    ]],
    ['div', { class: 'snapshot-grid' }, '', [
      card('wells', 'wellMetric', 'waterStatus', 'wellNote'), card('power', 'utilityMetric', 'powerStatus'), card('listing', 'evidenceMetric', 'listingStatus'),
      card('soil', 'soilMetric', 'soilStatus'), card('slope', 'slopeMetric', 'slopeStatus')
    ]],
    ['div', { class: 'zoning-grid' }, '', [['article', { class: 'card snapshot-card horizontal', 'data-detail': 'zoning' }, '', [
      ['div', {}, '', [['div', { id: 'zoningMetric', class: 'snapshot-value' }, '—'], ['span', { id: 'zoningNote' }, '']]]
    ]]]],
    ['article', { id: 'detailCard' }, '', [['div', { id: 'results' }]]]
  ]],
  ['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }, 'Analyze property']
];

// Stand-in for the page's inline script. The find* functions make the same /api calls, with the
// same bodies and error handling, as index.html (findZoningPermits, hazardQuery, findFlood,
// findWetlands, findLandAnalysis) and the Idaho branches of state-selector.js (findParcel,
// findWells, findUtility). renderSummary paints what the report shows for these sections.
const PAGE_SCRIPT = `
let last = { parcel: null, wells: [], utility: [], evidence: null };
let activeTab = 'wells';
const $ = id => document.getElementById(id);
function renderSummary(parcel) {
  const p = parcel.properties;
  $('overviewParcelId').textContent = p.ORIG_PARCEL_ID;
  $('overviewAddress').textContent = [p.SITUS_ADDRESS, p.SITUS_CITY_NM].filter(Boolean).join(', ');
  $('overviewAcres').textContent = p.ACRES == null ? 'Not available' : p.ACRES + ' ac (assessor)';
  $('wellMetric').textContent = last.wells.length ? last.wells.length + ' nearby wells' : 'Not found';
  $('waterStatus').textContent = last.wells.length ? 'Recorded wells nearby' : 'No nearby depth records returned';
  $('wellNote').textContent = 'Closest five recorded wells';
  const zp = last.zoningPermits || {};
  $('zoningMetric').textContent = zp.zoning?.code || zp.zoning?.label || 'Not configured';
  $('zoningNote').textContent = zp.zoning?.status === 'gis_match' ? [zp.zoning?.name, zp.jurisdiction].filter(Boolean).join(' · ') : zp.zoning?.note || zp.error || 'County source unavailable';
  $('overviewFlood').textContent = last.flood?.available ? last.flood.category : 'Not verified';
  $('overviewWetlands').textContent = last.wetlands?.available ? 'Checked' : 'Not verified';
  $('utilityMetric').textContent = last.utility.length ? last.utility.join(' / ') : 'Not identified';
  $('scoreMetric').textContent = 'Score ' + ['flood', 'wetlands', 'zoningPermits', 'land'].filter(k => last[k]?.available).length;
}
function renderMap() {}
function renderResults() {}
async function findParcel(county, input) {
  const response = await fetch('/api/parcel-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'ID', county, parcelId: String(input || '').trim() }) });
  const data = await response.json();
  if (!response.ok || !data?.parcel) throw new Error(data?.error || 'Parcel service returned ' + response.status);
  return data.parcel;
}
async function findWells(parcel, signal) {
  const [lon, lat] = turf.centroid(parcel).geometry.coordinates;
  const response = await fetch('/api/well-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'ID', county: 'Kootenai', lat, lon }), signal });
  const data = await response.json();
  if (!response.ok || !data?.available) throw new Error(data?.error || 'Well service returned ' + response.status);
  const wells = Array.isArray(data.wells) ? data.wells : [];
  wells.forEach((well, i) => { well.properties = well.properties || {}; well.properties._distance = i; });
  return wells.slice(0, 5);
}
async function findUtility(parcel, signal) {
  const [lon, lat] = turf.centroid(parcel).geometry.coordinates;
  try {
    const response = await fetch('/api/utility-territory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'ID', county: 'Kootenai', lat, lon }), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Utility territory service returned ' + response.status);
    return Array.isArray(data.providers) ? data.providers : [];
  } catch (error) { return []; }
}
async function findListingEvidence() { return { status: 'none', matches: [] }; }
async function hazardQuery(kind, parcel, signal) { const r = await fetch('/api/hazards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, geometry: parcel.geometry }), signal }); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Hazard service returned ' + r.status); return j; }
async function findFlood(parcel, signal) { try { return await hazardQuery('flood', parcel, signal); } catch (e) { return { available: false, intersects: false, high: false, zones: [], error: e.message }; } }
async function findWetlands(parcel, signal) { try { return await hazardQuery('wetlands', parcel, signal); } catch (e) { return { available: false, intersects: false, count: 0, types: [], error: e.message }; } }
async function findZoningPermits(parcel, signal) {
  const p = parcel.properties, [lon, lat] = turf.centroid(parcel).geometry.coordinates, id = p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '';
  try {
    const r = await fetch('/api/zoning-permits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ county: p._countyDisplay || p.COUNTY_NM || '', parcelId: id, address: '', lat, lon, geometry: parcel.geometry, dataLink: '' }), signal });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Zoning lookup failed'); return d;
  } catch (e) { return { available: false, error: e.message, zoning: { status: 'unavailable' }, permits: [] }; }
}
async function findLandAnalysis() { return { available: false, error: 'not part of this test', soil: { available: false }, terrain: { available: false } }; }
`;

// Vertex average, enough to place the point queries (the page uses turf.centroid).
const turf = { centroid: f => { const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0]; return { geometry: { coordinates: [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length] } }; } };

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let restoreUpstream, workerCalls;
beforeEach(() => {
  workerCalls = [];
  // The Worker's view of the outage: Kootenai and IDWR time out, FEMA answers 525, the rest fails.
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    workerCalls.push(url.hostname);
    if (url.hostname === 'hazards.fema.gov') return new Response('<html>525</html>', { status: 525 });
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    throw error;
  };
  console.warn = () => {};
  restoreUpstream = configureUpstream({ backoffMs: 0 });
});
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 50)); globalThis.fetch = realFetch; console.warn = realWarn; restoreUpstream(); });

// The page. config.delays: { [url]: ms on the manual clock, or fn(n) -> ms for the n-th call to
// that url } for the browser's government requests; config.answers: { [url]: body } overrides
// the recorded answers. Tests may change config between steps.
function page(config = {}) {
  config.delays ||= {};
  config.answers ||= {};
  const clock = makeClock();
  const browserCalls = [];
  const counts = new Map();
  const env = { ASSETS: { fetch: async () => new Response('') } };
  const pageFetch = async (input, init = {}) => {
    const raw = String(input);
    if (raw.startsWith('/api/')) {
      return worker.fetch(new Request(`https://acresx.test${raw}`, { method: init.method || 'GET', headers: init.headers, body: init.body }), env, { waitUntil() {} });
    }
    const url = new URL(raw);
    const base = url.origin + url.pathname;
    const params = new URLSearchParams(url.search);
    if (init.body) new URLSearchParams(String(init.body)).forEach((v, k) => params.set(k, v));
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    const call = { base, host: url.hostname, params, at: clock.now, aborted: false, redirect: init.redirect, credentials: init.credentials };
    browserCalls.push(call);
    const list = recorded.responses.filter(r => r.url === base);
    const body = base in config.answers ? config.answers[base] : list.length ? list[Math.min(n, list.length) - 1].body : null;
    const rule = config.delays[base];
    const delay = typeof rule === 'function' ? rule(n) : rule ?? 0;
    return new Promise((resolve, reject) => {
      const onAbort = () => { call.aborted = true; const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); };
      if (init.signal?.aborted) return onAbort();
      init.signal?.addEventListener?.('abort', onAbort);
      if (delay === 'hang') return;
      clock.setTimeout(() => {
        if (body == null) reject(new TypeError('Failed to fetch'));
        else resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }, delay);
    });
  };
  const p = makeContext({ body: PAGE, clock, fetch: pageFetch, extra: { turf, Response, Headers, Request, URLSearchParams } });
  p.document.getElementById('county').value = 'Kootenai';
  p.document.getElementById('parcel').value = PIN;
  p.run(PAGE_SCRIPT, 'page.js');
  p.run(readPublic('progressive-loading.js'), 'progressive-loading.js');
  p.run(readPublic('browser-fallback.js'), 'browser-fallback.js');
  const $ = id => p.document.getElementById(id);
  const S = p.ctx.AcresXSections;
  // Let the Worker (real time) and the page (manual clock) run until `until()` or `ms` pass.
  async function runFor(ms, until = () => false) {
    for (let t = 0; t < ms && !until(); t += 50) {
      await clock.advance(50);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  // Real time only (the Worker's own work), firing manual timers that are already due; the manual
  // clock does not move, so section time limits are not used up while the Worker answers.
  async function waitReal(until, ms = 5000) {
    const end = Date.now() + ms;
    while (!until() && Date.now() < end) { await clock.advance(0); await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.ok(until(), 'condition reached');
  }
  const note = id => $(id)?.parentNode?.children.find(c => c.className === 'acresx-fallback-note')?.textContent || '';
  return { ...p, config, clock, $, S, runFor, waitReal, browserCalls, note, text: id => $(id).textContent, last: key => p.run(`JSON.parse(JSON.stringify(last[${JSON.stringify(key)}] ?? null))`) };
}

function assertBrowserSafe(calls) {
  for (const c of calls) {
    assert.ok(ALLOWED.includes(c.host), c.host);
    assert.equal(c.redirect, 'error', `${c.base}: no redirects`);
    assert.equal(c.credentials, 'omit', `${c.base}: no cookies`);
    const fields = c.params.get('outFields') || '';
    assert.ok(fields && fields !== '*', `${c.base} names its fields`);
    assert.doesNotMatch(fields, /(^|,)(Owner\w*|Name)(,|$)/i, `${c.base} asked for an owner field`);
  }
}

test(`end to end ${PIN}: every Kootenai/IDWR Worker call fails, parcel, zoning (RURAL) and wells render through the browser path`, async t => {
  const pg = page();
  const done = pg.ctx.AcresXProgress.search();
  await pg.runFor(60000, () => pg.S.allSettled());
  await done;
  await pg.runFor(2000);

  // The Worker really failed: its upstream calls went to the blocked hosts and nowhere else.
  assert.ok(workerCalls.includes('map.kcgov.us') && workerCalls.includes('gis.idwr.idaho.gov'));

  // Parcel: from the browser, in the Worker's /api/parcel-search shape.
  const parcel = pg.run('JSON.parse(JSON.stringify(last.parcel.properties))');
  assert.equal(parcel.ORIG_PARCEL_ID, PIN);
  assert.equal(parcel.PID, '50N04W-32-3200');
  assert.equal(parcel.ACRES, 11.703);
  assert.equal(parcel.SITUS_ADDRESS, '3572 S MOOSE CANYON RD');
  assert.equal(parcel._source.name, 'Kootenai County GIS (Ownership_Display parcel layer)');
  assert.equal(pg.text('overviewParcelId'), PIN);
  assert.equal(pg.text('overviewAcres'), '11.703 ac (assessor)');
  assert.equal(pg.note('overviewParcelId'), 'Loaded directly from Kootenai County GIS. Verify with the responsible agency.');

  // Zoning: unincorporated (layer 18 CITY ' '), county zone RURAL.
  const zoning = pg.last('zoningPermits');
  assert.equal(zoning.available, true);
  assert.equal(zoning.jurisdiction, 'Kootenai County');
  assert.equal(zoning.zoning.code, 'RURAL');
  assert.equal(zoning.source.attributes.ZONE_NAME, 'RUR');
  assert.equal('fallback' in zoning, false);
  assert.equal(pg.S.status('zoningPermits'), 'done');
  assert.equal(pg.text('zoningMetric'), 'RURAL');
  assert.equal(pg.text('zoningNote'), 'RURAL · Kootenai County');
  assert.equal(pg.note('zoningNote'), 'Loaded directly from Kootenai County GIS. Verify with the responsible agency.');

  // Wells: IDWR from the browser; the page keeps the closest five.
  const wells = pg.last('wells');
  assert.equal(wells.length, 5);
  assert.ok(wells.every(w => w.properties._source === 'Idaho Department of Water Resources' && Number(w.properties.CompletedDepth) > 0 && !('Owner' in w.properties)));
  assert.equal(pg.S.status('wells'), 'done');
  assert.equal(pg.text('wellMetric'), '5 nearby wells');
  assert.equal(pg.note('wellNote'), 'Loaded directly from Idaho Department of Water Resources. Verify with the responsible agency.');

  // Flood: FEMA has no recorded browser answer here, so it stays the Worker's "unavailable"
  // answer; only that layer is affected.
  assert.equal(pg.last('flood').available, false);
  assert.equal(pg.text('overviewFlood'), 'Not verified');

  assert.ok(pg.S.ready('score'), 'every score input settled');
  assert.deepEqual(pg.S.timedOut(), []);
  assertBrowserSafe(pg.browserCalls);
  const byHost = pg.browserCalls.reduce((m, c) => ({ ...m, [c.base.split('/services/')[1]]: (m[c.base.split('/services/')[1]] || 0) + 1 }), {});
  t.diagnostic(`parcel ${parcel.ORIG_PARCEL_ID} ${parcel.ACRES} ac ${parcel.SITUS_ADDRESS}; zoning ${zoning.zoning.code} (${zoning.jurisdiction}); wells shown ${wells.length} of ${recorded.responses.find(r => r.url === IDWR_WELLS).body.features.length} returned; flood ${pg.last('flood').error}`);
  t.diagnostic(`browser requests: ${JSON.stringify(byHost)}; Worker upstream attempts: ${workerCalls.length}`);
});

test('a hinted section stays "Checking…" past its own time limit while the browser runs, and the score waits', async () => {
  // The browser zoning chain: its parcel query (2nd call to the parcel layer; the 1st was the
  // parcel search) 11 s, then city limits 11 s. Each is under the browser's 12 s request timeout,
  // but together they pass the zoning section's 20 s limit.
  const pg = page({ delays: { [KC_PARCELS]: n => (n >= 2 ? 11000 : 0), [KC_CITY_LIMITS]: 11000 } });
  const done = pg.ctx.AcresXProgress.search();
  // The parcel search and the zoning Worker call fail (real time); the browser zoning chain starts.
  await pg.waitReal(() => pg.browserCalls.filter(c => c.base === KC_PARCELS).length >= 2);
  await done;
  const sectionStart = 0;
  assert.equal(pg.clock.now, 0);
  await pg.runFor(21000 - pg.clock.now + sectionStart);
  assert.equal(pg.S.status('zoningPermits'), 'pending', 'still checking after the 20 s limit');
  assert.equal(pg.text('zoningMetric'), 'Checking…', 'not "unavailable" first');
  assert.equal(pg.S.ready('score'), false, 'the score waits for zoning');
  assert.ok(pg.S.waitingFor('score').includes('zoning'));
  await pg.runFor(20000, () => pg.S.status('zoningPermits') !== 'pending');
  assert.equal(pg.S.status('zoningPermits'), 'done');
  assert.ok(pg.clock.now - sectionStart >= 22000, 'answered by the browser after ~22 s');
  await pg.runFor(1000); // the debounced re-render
  assert.equal(pg.text('zoningMetric'), 'RURAL');
  assert.ok(pg.S.ready('score'));
});

test('the time limit is extended once: a browser attempt past it times out, its requests are cancelled, and Retry uses the fallback again', async () => {
  // Wells: few wells at every radius, so the browser walks all five radii, 11 s each (55 s).
  const fewWells = { type: 'FeatureCollection', features: recorded.responses.find(r => r.url === IDWR_WELLS).body.features.slice(0, 2) };
  const pg = page({ delays: { [IDWR_WELLS]: 11000 }, answers: { [IDWR_WELLS]: fewWells } });
  const done = pg.ctx.AcresXProgress.search();
  await pg.waitReal(() => pg.browserCalls.some(c => c.base === IDWR_WELLS));
  await done;
  const startedAt = pg.browserCalls.find(c => c.base === IDWR_WELLS).at;
  await pg.runFor(16000);
  assert.equal(pg.S.status('wells'), 'pending', 'past the 15 s wells limit: extended');
  await pg.runFor(60000, () => pg.S.status('wells') !== 'pending');
  assert.equal(pg.S.status('wells'), 'timeout');
  assert.ok(pg.clock.now - startedAt <= 31000, `one 30 s extension, not more (${pg.clock.now - startedAt} ms)`);
  await pg.runFor(500); // the debounced re-render
  assert.equal(pg.text('wellMetric'), 'Timed out');
  const wellCalls = () => pg.browserCalls.filter(c => c.base === IDWR_WELLS);
  assert.ok(wellCalls().at(-1).aborted, 'the in-flight browser request was cancelled');
  const sent = wellCalls().length;
  await pg.runFor(30000);
  assert.equal(wellCalls().length, sent, 'no browser requests after the timeout');

  // Retry: the Worker fails again, and its hint starts the browser query again (fast now).
  pg.config.delays = {};
  pg.config.answers = {};
  const before = workerCalls.filter(h => h === 'gis.idwr.idaho.gov').length;
  pg.ctx.AcresXProgress.retry('wells');
  await pg.waitReal(() => wellCalls().length > sent);
  await pg.runFor(10000, () => pg.S.status('wells') !== 'pending');
  assert.ok(workerCalls.filter(h => h === 'gis.idwr.idaho.gov').length > before, 'Retry asked the Worker first');
  assert.equal(pg.S.status('wells'), 'done');
  assert.equal(pg.last('wells').length, 5);
  await pg.runFor(500);
  assert.equal(pg.text('wellMetric'), '5 nearby wells');
});

// Real time: the Worker's 8 s county cap and 5 s IDWR window are real timers.
for (const [idwrCase, idwrHangs, low, high] of [['IDWR fails fast', false, 7900, 9500], ['IDWR hangs too', true, 12900, 14500]]) {
  test(`timing ${PIN}: county parcel layer hangs, ${idwrCase}: the parcel renders via the browser after the Worker's caps`, async t => {
    const hosts = [];
    const hang = init => new Promise((_, reject) => init.signal?.addEventListener('abort', () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); }));
    globalThis.fetch = (input, init = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      hosts.push(url.hostname + url.pathname + (url.searchParams.get('outFields') === 'PIN,PID,Acres,Loc_Addr,Loc_City' ? ' (parcel search)' : ''));
      if (url.pathname.endsWith('/Ownership_Display/MapServer/0/query')) return hang(init);
      if (idwrHangs && url.pathname.includes('/Reference/Parcels/')) return hang(init);
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      return Promise.reject(error);
    };
    const pg = page();
    const started = Date.now();
    pg.ctx.AcresXProgress.search();
    await pg.waitReal(() => pg.text('overviewParcelId') === PIN, 20000);
    const ms = Date.now() - started;
    assert.ok(ms >= low && ms < high, `parcel rendered after ${ms} ms`);
    assert.equal(hosts.filter(h => h.endsWith('(parcel search)')).length, 1, 'one Worker attempt at the county parcel layer');
    assert.equal(hosts.some(h => h.startsWith('services1.arcgis.com')), false, 'no statewide parcel request');
    assert.ok(hosts.some(h => h.includes('/Reference/Parcels/')), 'IDWR parcels asked');
    assert.equal(pg.run('last.parcel.properties.ACRES'), 11.703);
    t.diagnostic(`${idwrCase}: search start -> parcel rendered via the browser: ${ms} ms`);
  });
}
