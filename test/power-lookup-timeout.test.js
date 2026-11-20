// The browser side of /api/power-intelligence, offline (2026-11-20). In production the route
// answered 200 on 6 of 6 test parcels, but on 5 of them the page stored
// { available: false, error: 'The user aborted a request.' }: the answer asked the browser to load
// OpenStreetMap itself (public/browser-fallback.js, kind osm-power), the 15 s follow-up clock that
// had been running while the Worker answered (9 s) fired during that browser query, and the abort
// also cancelled the body of the Worker's response, so its partial answer (utility map,
// transmission line) was thrown away. These tests run the real public/progressive-loading.js,
// public/browser-fallback.js and public/ui-polish.js in node:vm with a manual clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeContext, makeLazyContext, readPublic } from './ui-harness.js';

// What the Worker answers when Overpass did not answer it: the HIFLD line, and the browser hint.
const WORKER_ANSWER = {
  available: true, adapter: 'inland-power-v1', provider: 'INLAND POWER & LIGHT COMPANY',
  proximity: { available: false, status: 'timed_out', browserFallback: true },
  distribution: { status: 'no_verified_distance', estimatedDistanceFt: null },
  transmissionLine: { available: true, lineType: 'transmission', distanceFt: 1291 },
  nearestLine: { distanceFt: 1291, lineType: 'transmission', sourceLabel: 'HIFLD', usableForCost: false },
  fallback: { mode: 'browser', kind: 'osm-power', input: { lat: 47.6, lon: -117.4 } }
};

// A response whose body, like a browser fetch body, can no longer be read once the request's
// signal has fired (clone() is taken before that, as the fallback does).
function browserLikeResponse(body, signal) {
  const text = JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  const aborted = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
  return {
    ok: true, status: 200, statusText: 'OK', headers,
    clone: () => new Response(text, { status: 200, headers }),
    text: async () => { if (signal?.aborted) throw aborted(); return text; },
    json: async () => { if (signal?.aborted) throw aborted(); return JSON.parse(text); }
  };
}

// The page with progressive loading and the browser fallback. /api/power-intelligence answers
// after workerMs; Overpass (the browser query) never answers until aborted.
function page({ workerMs = 3000 } = {}) {
  const clock = makeClock();
  const calls = [];
  const fetch = (input, init = {}) => {
    const url = new URL(String(input), 'https://acresx.test/');
    calls.push({ host: url.hostname, path: url.pathname, at: clock.now });
    return new Promise((resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
      if (init.signal?.aborted) return fail();
      init.signal?.addEventListener?.('abort', fail);
      if (url.pathname === '/api/power-intelligence') clock.setTimeout(() => resolve(browserLikeResponse(WORKER_ANSWER, init.signal)), workerMs);
    });
  };
  const h = makeContext({ clock, fetch, extra: { URLSearchParams, Response, Headers, location: { href: 'https://acresx.test/', pathname: '/', search: '', hash: '', assign() {} } } });
  h.run(readPublic('progressive-loading.js'), 'progressive-loading.js');
  h.run(readPublic('browser-fallback.js'), 'browser-fallback.js');
  return { ...h, clock, calls, S: h.ctx.AcresXSections };
}

test('a follow-up time limit starts when it is created (at send), not before, and can be extended once', async () => {
  const { clock, S } = page();
  await clock.advance(5000); // the page was busy for 5 s before the request was sent
  const signal = S.timeoutSignal(20000);
  await clock.advance(19999);
  assert.equal(signal.aborted, false, 'the 5 s before the send do not count');
  await clock.advance(1);
  assert.equal(signal.aborted, true);

  const other = S.timeoutSignal(20000);
  await clock.advance(10000);
  assert.equal(S.extend(other, 30000), true);
  assert.equal(S.extend(other, 30000), false, 'once only');
  await clock.advance(29999);
  assert.equal(other.aborted, false);
  await clock.advance(1);
  assert.equal(other.aborted, true);
});

test('abort keeps partial: the page signal fires during the browser Overpass query -> the Worker answer is kept', async () => {
  const { clock, ctx, calls } = page({ workerMs: 3000 });
  const controller = new AbortController();
  clock.setTimeout(() => controller.abort(), 5000); // fires 2 s into the browser query
  const warn = console.warn; console.warn = () => {};
  try {
    let result = null;
    ctx.fetch('/api/power-intelligence', { method: 'POST', body: '{}', signal: controller.signal })
      .then(r => r.json()).then(body => { result = { body }; }, error => { result = { error }; });
    await clock.advance(6000);
    assert.ok(calls.some(c => c.host === 'overpass-api.de'), 'the browser asked Overpass');
    assert.ok(result, 'settled');
    assert.equal(result.error, undefined, `no "${result.error?.message}"`);
    assert.equal(result.body.provider, 'INLAND POWER & LIGHT COMPANY');
    assert.equal(result.body.nearestLine.distanceFt, 1291);
    assert.equal(result.body.fallback.kind, 'osm-power');
  } finally { console.warn = warn; }
});

test('with the follow-up time limit: the browser query gets its own fresh limit, and the Worker answer survives it', async () => {
  const { clock, ctx, S, calls } = page({ workerMs: 9000 }); // the old 9 s Worker wait
  const warn = console.warn; console.warn = () => {};
  try {
    let result = null;
    ctx.fetch('/api/power-intelligence', { method: 'POST', body: '{}', signal: S.timeoutSignal(15000) })
      .then(r => r.json()).then(body => { result = { body }; }, error => { result = { error }; });
    // Before: aborted at 15 s (6 s into the browser query) and the answer was lost.
    await clock.advance(15001);
    assert.equal(result, null, 'still waiting for the browser query at 15 s (limit extended)');
    // Both Overpass endpoints give up (12 s each in the browser), inside the extension.
    await clock.advance(30000);
    assert.deepEqual(calls.filter(c => c.host.startsWith('overpass')).map(c => c.host), ['overpass-api.de', 'overpass.private.coffee']);
    assert.ok(result?.body, `answered (${result?.error?.message || 'pending'})`);
    assert.equal(result.body.nearestLine.distanceFt, 1291);
  } finally { console.warn = warn; }
});

test('ui-polish sends /api/power-intelligence with a 20 s limit created in the fetch call (6 s server budget + margin)', async () => {
  const log = [];
  const h = makeLazyContext({ last: { parcel: { type: 'Feature', properties: { ORIG_PARCEL_ID: '1' }, geometry: null }, utility: ['AVISTA CORP'], powerIntelligence: null } });
  const signal = new AbortController().signal;
  Object.assign(h.context, {
    AcresXSections: { searchId: 1, claim: () => { log.push('claim'); return true; }, isCurrent: () => true, settle: key => log.push(`settle:${key}`), timeoutSignal: ms => { log.push(`signal:${ms}`); return signal; } },
    fetch: async (url, init) => { log.push(`fetch:${url}:${init.signal === signal}`); return { ok: true, status: 200, json: async () => ({ ...WORKER_ANSWER, fallback: undefined }) }; }
  });
  h.run('var esc = s => String(s ?? ""); function renderSummary() {}');
  h.run(readPublic('ui-polish.js'));
  h.run('renderSummary()');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(log.slice(0, 3), ['claim', 'signal:20000', 'fetch:/api/power-intelligence:true']);
  assert.ok(log.includes('settle:powerIntelligence'));
  assert.equal(h.context.last.powerIntelligence.nearestLine.distanceFt, 1291);
});

// ---- The page applies the Worker's answer at once, then upgrades it from the browser's own
// OpenStreetMap answer when that gives a usable distribution distance (<= 1,000 ft guard).

const CENTER = { lat: 47.6, lon: -117.4 };
const FT_PER_DEG_LAT = 364000;
const pole = ft => ({ type: 'node', id: 1, lat: CENTER.lat + ft / FT_PER_DEG_LAT, lon: CENTER.lon, tags: { power: 'pole' } });

// ui-polish.js + browser-fallback.js on the fake DOM. overpass(url) answers the browser query
// ({ delay, elements } or 'hang'). AcresXSections is a stand-in that records settle/touch.
function powerPage({ workerMs = 1500, overpass = () => 'hang' } = {}) {
  const clock = makeClock();
  const log = [];
  const fetch = (input, init = {}) => {
    const url = new URL(String(input), 'https://acresx.test/');
    log.push(`${clock.now} ${url.hostname}${url.pathname}`);
    return new Promise((resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
      if (init.signal?.aborted) return fail();
      init.signal?.addEventListener?.('abort', fail);
      if (url.pathname === '/api/power-intelligence') return clock.setTimeout(() => resolve(browserLikeResponse(WORKER_ANSWER, init.signal)), workerMs);
      const a = overpass(url);
      if (a !== 'hang') clock.setTimeout(() => resolve(new Response(JSON.stringify({ elements: a.elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })), a.delay || 0);
    });
  };
  const sections = { searchId: 1 };
  const h = makeContext({
    body: [['span', { id: 'powerStatus' }, ''], ['span', { id: 'powerGrade' }, ''], ['span', { id: 'powerDot' }, ''], ['div', { id: 'detailCard' }]],
    clock, fetch, autoIds: true,
    extra: {
      URLSearchParams, Response, Headers,
      location: { href: 'https://acresx.test/', pathname: '/', search: '', hash: '', assign() {} },
      turf: { centroid: () => ({ geometry: { coordinates: [CENTER.lon, CENTER.lat] } }) },
      AcresXSections: {
        get searchId() { return sections.searchId; },
        claim: () => true, isCurrent: id => id === sections.searchId,
        settle: key => log.push(`${clock.now} settle:${key}`), touch: () => log.push(`${clock.now} touch`),
        timeoutSignal: ms => { const c = new AbortController(); clock.setTimeout(() => c.abort(), ms); return c.signal; }
      }
    }
  });
  h.ctx.__last = { parcel: { type: 'Feature', properties: { ORIG_PARCEL_ID: 'P1' }, geometry: null }, utility: ['INLAND POWER & LIGHT COMPANY'], powerIntelligence: null };
  h.run('var last = __last; var activeTab = "wells"; var esc = s => String(s ?? ""); function renderSummary() {}', 'inline.js');
  h.run(readPublic('ui-polish.js'), 'ui-polish.js');
  h.run(readPublic('browser-fallback.js'), 'browser-fallback.js');
  return { ...h, clock, log, sections, last: () => h.ctx.last, status: () => h.document.getElementById('powerStatus').textContent };
}

test('the Worker answer is on the card at once (not after the browser query); a pole 300 ft away then upgrades it', async () => {
  const p = powerPage({ workerMs: 1500, overpass: () => ({ delay: 4000, elements: [pole(300)] }) });
  const warn = console.warn; console.warn = () => {};
  try {
    p.run('renderSummary()');
    await p.clock.advance(1600);
    // Settled with the Worker's answer 1.5 s after the send, while Overpass is still running.
    assert.equal(p.last().powerIntelligence.nearestLine.distanceFt, 1291);
    assert.ok(p.log.includes('1500 settle:powerIntelligence'), p.log.join(' | '));
    assert.ok(p.log.some(l => l.endsWith('overpass-api.de/api/interpreter')), 'the browser query started');
    assert.match(p.status(), /transmission line ~1,291 ft/);
    await p.clock.advance(4500);
    const pi = p.last().powerIntelligence;
    assert.equal(pi.distribution.status, 'osm_mapped_proximity');
    assert.ok(Math.abs(pi.distribution.estimatedDistanceFt - 300) <= 2, `${pi.distribution.estimatedDistanceFt} ft`);
    assert.equal(pi.distribution.usableForCost, true);
    assert.equal(pi.proximity.loadedFrom, 'browser');
    assert.ok(p.log.some(l => / touch$/.test(l)), 'the summary, score and cost re-render');
    assert.match(p.status(), /power pole mapped in OpenStreetMap ~300 ft/);
    assert.deepEqual({ ...p.ctx.AcresXFallback.loaded() }, { 'osm-power': 'OpenStreetMap (Overpass API)' });
  } finally { console.warn = warn; }
});

test('a far OSM line (2,000 ft, over the 1,000 ft guard) does not replace the Worker answer, and no "loaded from" label', async () => {
  const p = powerPage({ overpass: () => ({ delay: 2000, elements: [pole(2000)] }) });
  p.run('renderSummary()');
  await p.clock.advance(10000);
  assert.equal(p.last().powerIntelligence.distribution.status, 'no_verified_distance');
  assert.equal(p.last().powerIntelligence.nearestLine.distanceFt, 1291);
  assert.ok(!p.log.some(l => / touch$/.test(l)));
  assert.deepEqual({ ...p.ctx.AcresXFallback.loaded() }, {});
});

test('Overpass hangs in the browser too: the Worker answer stays, the browser query is given up quietly', async () => {
  const p = powerPage();
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  try {
    p.run('renderSummary()');
    await p.clock.advance(2000);
    assert.equal(p.last().powerIntelligence.nearestLine.distanceFt, 1291);
    await p.clock.advance(60000);
    assert.equal(p.last().powerIntelligence.nearestLine.distanceFt, 1291);
    assert.equal(p.last().powerIntelligence.error, undefined);
    assert.ok(!p.log.some(l => / touch$/.test(l)));
  } finally { console.warn = warn; }
});

test('a new search before the browser answers: the old parcel\'s OSM answer is dropped', async () => {
  const p = powerPage({ overpass: () => ({ delay: 4000, elements: [pole(300)] }) });
  p.run('renderSummary()');
  await p.clock.advance(2000);
  p.sections.searchId = 2; // progressive loading started another search
  p.ctx.AcresXFallback.reset();
  await p.clock.advance(6000);
  assert.equal(p.last().powerIntelligence.distribution.status, 'no_verified_distance');
  assert.ok(!p.log.some(l => / touch$/.test(l)));
});
