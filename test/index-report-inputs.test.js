// Drift guard for pipeline/report-inputs.mjs (R4 of docs/explore-index.md section 8): the batch
// job replicates the page's request builders until they move into a shared public file. The
// public/index.html originals run here in a vm (with the pinned @turf/turf the job uses) beside
// the copies, on the recorded Spokane parcel, and must send the same requests and return the same
// answers. For the builders wired to the DOM, the source lines the copy follows are asserted
// verbatim, so changing one side without the other fails this test. Offline: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as turf from '@turf/turf';
import * as R from '../pipeline/report-inputs.mjs';

const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/index-spokane-23123.9051.json', import.meta.url), 'utf8'));
const parcel = FIXTURE.calls.find(c => c.path === '/api/parcel-search').data.parcel;
const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// The inline index.html definitions, by name (each is one line in the file).
function extract(name) {
  const line = html.split('\n').find(l => new RegExp(`^(?:async )?function ${name}\\(|^const ${name}=`).test(l));
  assert.ok(line, `public/index.html no longer defines ${name} on one line; update test and pipeline/report-inputs.mjs`);
  return line;
}

// Answers by path (+ kind/service), for both the page's fetch and the copy's api().
const answerFor = (path, body) => FIXTURE.calls.find(c => c.path === path && (c.kind || null) === (body?.kind || body?.service || null));

function pageContext() {
  const sent = [];
  const fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    sent.push({ path: url, body });
    const hit = answerFor(url, body);
    return new Response(JSON.stringify(hit ? hit.data : { error: 'not recorded' }), { status: hit ? hit.status : 404, headers: { 'Content-Type': 'application/json' } });
  };
  const document = { getElementById: id => (id === 'state' ? { value: 'WA' } : id === 'county' ? { value: 'Spokane' } : null) };
  const context = vm.createContext({ turf, fetch, document, console: { warn() {}, log() {} }, JSON, Math, Number, String, Set, Array, Error, Response, Object, Promise, isFinite });
  const names = ['PARCEL_URL', 'WELL_URL', 'WHOLESALE_POWER', 'arcQuery', 'retailProviders', 'rankedProviders', 'findWells', 'findUtility', 'hazardQuery', 'zoningPoint', 'findZoningPermits', 'findFlood', 'findWetlands', 'findLandAnalysis'];
  vm.runInContext(names.map(extract).join('\n') + `\n;globalThis.__page={${names.join(',')}};`, context);
  return { page: context.__page, sent };
}

function copyApi() {
  const sent = [];
  const api = async (path, body) => {
    sent.push({ path, body: plain(body) });
    const hit = answerFor(path, body);
    return { ok: hit ? hit.ok : false, status: hit ? hit.status : 404, data: hit ? plain(hit.data) : { error: 'not recorded' } };
  };
  return { api, sent };
}

test('zoningPoint, retailProviders and rankedProviders match public/index.html', () => {
  const { page } = pageContext();
  assert.deepEqual(R.zoningPoint(parcel), plain(page.zoningPoint(parcel)));
  // A concave parcel whose vertex average falls outside it.
  const ell = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-117.3, 47.8], [-117.29, 47.8], [-117.29, 47.801], [-117.299, 47.801], [-117.299, 47.81], [-117.3, 47.81], [-117.3, 47.8]]] } };
  assert.deepEqual(R.zoningPoint(ell), plain(page.zoningPoint(ell)));
  const d = { providers: ['Bonneville Power Administration', 'Avista Corp', 'Inland Power & Light Company', 'Avista Corp'], primary: { name: 'Avista Corp', basis: 'avista_line_x', resolved: true, note: 'n' } };
  const a = R.rankedProviders(d), b = page.rankedProviders(d);
  assert.deepEqual([...a], [...b]);
  for (const k of ['primary', 'alsoListed', 'basis', 'resolved', 'note']) assert.deepEqual(plain(a[k]), plain(b[k]), k);
});

test('the section lookups send the page\'s request bodies and return the page\'s answers', async () => {
  const { page, sent: pageSent } = pageContext();
  const { api, sent: copySent } = copyApi();
  const pairs = [
    ['findWells', () => R.findWellsWA(parcel, api)],
    ['findUtility', () => R.findUtility(parcel, api, { state: 'WA', county: 'Spokane' })],
    ['findZoningPermits', () => R.findZoningPermits(parcel, api)],
    ['findFlood', () => R.findFlood(parcel, api)],
    ['findWetlands', () => R.findWetlands(parcel, api)],
    ['findLandAnalysis', () => R.findLandAnalysis(parcel, api)]
  ];
  for (const [name, copy] of pairs) {
    const p0 = pageSent.length, c0 = copySent.length;
    const fromPage = await page[name](plain(parcel));
    const fromCopy = await copy();
    assert.deepEqual(copySent.slice(c0).map(s => [s.path, s.body]), pageSent.slice(p0).map(s => [s.path, s.body]), `${name}: request bodies`);
    assert.deepEqual(plain(fromCopy), plain(fromPage), `${name}: answer`);
    if (Array.isArray(fromPage)) for (const k of ['lookupFailed', 'primary', 'basis', 'resolved']) assert.deepEqual(plain(fromCopy[k]), plain(fromPage[k]), `${name}.${k}`);
  }
});

test('a failed lookup leaves what the page leaves (lookupFailed lists, unavailable answers)', async () => {
  const down = async () => ({ ok: false, status: 502, data: { error: 'down' } });
  const wells = await R.findWellsWA(parcel, down);
  assert.equal(wells.lookupFailed, true);
  assert.equal(wells.length, 0);
  assert.equal((await R.findUtility(parcel, down, { state: 'WA', county: 'Spokane' })).lookupFailed, true);
  assert.deepEqual(plain(await R.findFlood(parcel, down)), { available: false, intersects: false, high: false, zones: [], error: 'down' });
  assert.equal((await R.findZoningPermits(parcel, down)).zoning.status, 'unavailable');
  assert.equal((await R.findLandAnalysis(parcel, down)).soil.available, false);
});

test('MultiPolygon parcels: the page\'s wells lookup fails on them, and so does the copy (known page bug, kept for parity)', async () => {
  const { page } = pageContext();
  const { api } = copyApi();
  const [poly] = parcel.geometry.type === 'Polygon' ? [parcel.geometry.coordinates] : parcel.geometry.coordinates;
  const shifted = poly.map(r => r.map(([x, y]) => [x + 0.02, y]));
  const multi = { ...parcel, geometry: { type: 'MultiPolygon', coordinates: [poly, shifted] } };
  const fromPage = await page.findWells(plain(multi));
  const fromCopy = await R.findWellsWA(plain(multi), api);
  assert.equal(fromPage.lookupFailed, true);
  assert.equal(fromCopy.lookupFailed, true);
});

// The DOM-wired builders: the lines the copy follows, verbatim.
const SNIPPETS = {
  'buildable-area.js': [
    "const WAIT_FOR = ['flood', 'wetlands', 'zoningPermits', 'land'];",
    'const REQUEST_MS = 35000;',
    "const code = l.zoningPermits?.zoning?.code || zdp.code || '';",
    'const body = { geometry: l.parcel.geometry, state: w.state, county: w.county, ...(zdp.available && zdp.setback ? { zoning: { code, setback: zdp.setback } } : {}) };',
    "state: String(p._stateCode || stateEl?.value || '').toUpperCase(),",
    "county: String(p._countyDisplay || countyEl?.value || '').replace(/\\s+County$/i, '').trim()"
  ],
  'ui-polish.js': [
    'const POWER_TIMEOUT_MS = 20000;',
    "state: document.getElementById('state')?.value || p._stateCode || 'WA',",
    "parcelId: p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || '',",
    'providers: Array.isArray(last.utility) ? last.utility : [],',
    "providerRanking: { basis: last.utility?.basis || '', resolved: last.utility?.resolved === true, note: last.utility?.note || '' }",
    'if (!identity || !identity.providers.length) return;'
  ],
  'public-utilities.js': [
    "body: JSON.stringify({ state: String(p._stateCode || 'WA').toUpperCase(), county: p._countyDisplay || p.COUNTY_NM || '', lat: point[1], lon: point[0], geometry: parcel.geometry })"
  ],
  'local-cost-model.js': [
    'return { body: { state: w.state, county: w.county, lat: point[1], lon: point[0] }, searchId: S?.searchId };'
  ],
  'well-terrain.js': [
    'const WAIT_MS = 12500;',
    'body: JSON.stringify({ state: stateOf(parcel), lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) }), signal'
  ],
  'zoning-potential.js': [
    "if (!/^(spokane|stevens|yellowstone|kootenai|gallatin)$/i.test(county)) return null;",
    "if (/^spokane$/i.test(county) && ((identity.jurisdictionType && identity.jurisdictionType !== 'county') || (identity.jurisdiction && !/^spokane county$/i.test(identity.jurisdiction))) && identity.rules !== 'mapped') return null;",
    "district: /^gallatin\\b/i.test(String(county)) ? (z.district || zp.source?.attributes?.DISTRICT_N || '') : '',",
    'uga: Boolean(zp.urbanGrowthArea?.intersects),'
  ],
  'state-selector.js': [
    "body:JSON.stringify({state:'WA', county:'Spokane', parcelId:String(input || '').trim()})",
    'if (stateEl.value === \'WA\') return oldFindWells(parcel, signal);'
  ]
};

test('the DOM-wired request builders still read as pipeline/report-inputs.mjs copies them', () => {
  for (const [file, lines] of Object.entries(SNIPPETS)) {
    const source = read(file);
    for (const line of lines) assert.ok(source.includes(line), `public/${file} changed: "${line}" (replicated in pipeline/report-inputs.mjs; update both)`);
  }
});

test('the section time limits are progressive-loading.js\'s', () => {
  const source = read('progressive-loading.js');
  for (const [name, def] of Object.entries(R.SECTIONS)) {
    const m = source.match(new RegExp(`\\b${name}: \\{ fn: '\\w+', ms: (\\d+)`));
    assert.ok(m, `progressive-loading.js has no section ${name}`);
    assert.equal(def.ms, Number(m[1]), name);
  }
  assert.ok(source.includes("const SCORE_INPUTS = ['wells', 'utility', 'flood', 'wetlands', 'zoningPermits', 'land', 'publicUtilities'];"), 'score inputs changed');
});

test('zoningRulesIdentity: the county gate of zoning-potential.js', () => {
  const last = { parcel, zoningPermits: { county: 'Spokane', jurisdiction: 'Spokane County', zoning: { code: 'RT', name: 'Rural Traditional' } } };
  assert.equal(R.zoningRulesIdentity(last).zoneCode, 'RT');
  assert.equal(R.zoningRulesIdentity({ ...last, zoningPermits: { ...last.zoningPermits, jurisdiction: 'City of Cheney', zoning: { code: 'R-1', jurisdictionType: 'city' } } }), null);
  assert.equal(R.zoningRulesIdentity({ ...last, zoningPermits: { ...last.zoningPermits, jurisdiction: 'City of Spokane Valley', zoning: { code: 'R-3', jurisdictionType: 'city', rules: 'mapped' } } }).zoneCode, 'R-3');
  assert.equal(R.zoningRulesIdentity({ ...last, zoningPermits: { zoning: { status: 'unavailable' } } }), null);
});
