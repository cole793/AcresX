// Offline tests for the OpenStreetMap distance guard (src/services/power-intelligence.js
// osmDistribution): OSM maps very few local distribution lines in our counties, so an OSM
// "nearest line" distance is "mapped lines only". A far one (over 1,000 ft) or a line whose type is
// unknown never feeds the cost model and reads "Distance not confirmed — likely served"; a near
// minor_line or pole feeds it, labelled. Avista's own map takes precedence. Every OSM-derived
// distance carries the "© OpenStreetMap contributors" attribution (card, details, report sources).
// Fetch is stubbed; nothing touches the network.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureUpstream } from '../src/shared/upstream.js';
import { handlePowerIntelligence, OSM_COST_MAX_FT } from '../src/services/power-intelligence.js';
import { makeLazyContext, readPublic } from './ui-harness.js';

const realFetch = globalThis.fetch;
let restoreUpstream;
before(() => { restoreUpstream = configureUpstream({ backoffMs: 0, log: () => {} }); });
after(() => { restoreUpstream(); });
afterEach(() => { globalThis.fetch = realFetch; });

const plain = v => JSON.parse(JSON.stringify(v));
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const quiet = { ...console, warn() {}, log() {} };

// The parcel of test/power-distance.test.js: 0.002 x 0.002 degree, rural Spokane County.
const LAT = 47.85, LON = -117.25;
const square = (lon, lat, d) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const PARCEL = square(LON, LAT, 0.002);
const CENTER = { lat: LAT + 0.001, lon: LON + 0.001 };
const top = LAT + 0.002;
const FT_PER_DEG_LAT = 364000;
const COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const CREDIT = '© OpenStreetMap contributors';

const ew = (id, dLat, tags) => ({ type: 'way', id, tags, geometry: [{ lat: top + dLat, lon: LON - 0.003 }, { lat: top + dLat, lon: LON + 0.005 }] });
// A 13.2 kV minor_line 0.004 deg north of the top edge: about 1,456 ft, over the 1,000 ft limit.
const FAR_LINE = [ew(201, 0.004, { power: 'minor_line', voltage: '13200' })];
// The same far line, and a pole 0.0008 deg north of the top edge (about 291 ft).
const NEAR_POLE = [...FAR_LINE, { type: 'node', id: 202, lat: top + 0.0008, lon: LON + 0.001, tags: { power: 'pole' } }];
// A power=line without a voltage 0.0005 deg north (about 182 ft): type unknown.
const UNKNOWN_LINE = [ew(203, 0.0005, { power: 'line' })];
// A 13.2 kV minor_line 0.001 deg north (about 364 ft).
const NEAR_LINE = [ew(204, 0.001, { power: 'minor_line', voltage: '13200' })];
// Avista's DER layer: a line section 0.0005 deg south of the parcel (about 182 ft).
const AVISTA_SECTION = [{ attributes: { SECTIONID: 'X1' }, geometry: { paths: [[[LON - 0.002, LAT - 0.0005], [LON + 0.004, LAT - 0.0005]]] } }];

function stub({ elements = [], avista = 'empty' } = {}) {
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (/overpass/.test(url.hostname)) return jsonResponse({ elements });
    if (url.pathname.includes('US_Electric_Power_Transmission_Lines')) return jsonResponse({ features: [] });
    if (url.pathname.includes('DER_Hosting_Capacity_PRD')) return jsonResponse({ features: avista === 'answer' ? AVISTA_SECTION : [] });
    if (url.pathname.includes('Public_Basic_FEC_System')) return jsonResponse({ features: [] });
    return Promise.reject(new TypeError('fetch failed'));
  };
}
const post = body => new Request('https://acresx.test/api/power-intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const INLAND = 'INLAND POWER & LIGHT COMPANY';
async function power(elements, { providers = [INLAND], avista } = {}) {
  stub({ elements, avista });
  return plain(await (await handlePowerIntelligence(post({ state: 'WA', providers, ...CENTER, geometry: PARCEL }))).json());
}

// ---- The page: the Spokane report fixture (Inland Power) with this power answer.
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
function withPower(pi, provider = INLAND) {
  const d = fixture();
  d.utility = [provider];
  d.powerIntelligence = pi;
  return d;
}
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js', 'coverage-trust.js', 'ui-polish.js'];
function page(data) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.console = quiet;
  h.run('var esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;" }[c])); var activeTab = "power"; function renderSummary() {} function renderResults() {}');
  for (const f of MODULES) h.run(readPublic(f), f);
  h.context.__acresxLast = data;
  return {
    h,
    card() { h.run('renderSummary()'); return { status: h.el('powerStatus').textContent, grade: h.el('powerGrade').textContent, dot: h.el('powerDot').className }; },
    details() { h.run('renderResults()'); return h.el('results').innerHTML; },
    electric: () => h.run('window.AcresXCostModel.estimate(last)').components.electric,
    report() { h.generate(); return h.opened.at(-1); }
  };
}

// ---- Far OSM line: not fed to the cost model, "Distance not confirmed"

test('far OSM line (> 1,000 ft): not the distribution distance, kept as a mapped-only "not confirmed" line', async () => {
  const body = await power(FAR_LINE);
  assert.equal(OSM_COST_MAX_FT, 1000);
  assert.equal(body.proximity.estimatedDistanceFt > OSM_COST_MAX_FT, true, String(body.proximity.estimatedDistanceFt));
  assert.equal(body.distribution.status, 'osm_distance_not_confirmed');
  assert.equal(body.distribution.estimatedDistanceFt, null, 'never fed to the cost model');
  assert.ok(Math.abs(body.distribution.mappedDistanceFt - 0.004 * FT_PER_DEG_LAT) <= 2, String(body.distribution.mappedDistanceFt));
  assert.equal(body.distribution.usableForCost, false);
  assert.match(body.distribution.note, /^Distance not confirmed\. .*may be much closer/);
  assert.deepEqual(body.distribution.attribution, { text: CREDIT, url: COPYRIGHT });
  assert.equal(body.nearestLine.lineType, 'distribution');
  assert.equal(body.nearestLine.usableForCost, false);
  assert.equal(body.nearestLine.mappedOnly, true);
  assert.equal(body.nearestLine.distanceFt, body.distribution.mappedDistanceFt);
  // The score reads the territory only (public/score-cost.js powerScore): unchanged by the guard.
  assert.deepEqual(body.territory, (await power([])).territory);
});

test('far OSM line: the card says "Distance not confirmed — likely served", with context and the OSM credit', async () => {
  const p = page(withPower(await power(FAR_LINE)));
  const c = p.card();
  assert.equal(c.grade, `Distance not confirmed — likely served, verify with ${INLAND}`);
  assert.match(c.status, /^Nearest line mapped in OpenStreetMap ~1,4\d\d ft — OSM maps few local lines here; the actual nearest line may be much closer\. The utility confirms the route\./);
  // Context from the page: territory and the road (fixture: private road 578 ft away).
  assert.match(c.status, /Likely served: inside INLAND POWER & LIGHT COMPANY territory; private road ~578 ft away\./);
  assert.ok(c.status.endsWith(CREDIT), c.status);
  assert.equal(c.dot, 'traffic-dot amber');
  assert.doesNotMatch(c.status + c.grade, /far from power|no power/i);
  const details = p.details();
  assert.match(details, /Distance not confirmed — likely served, verify with INLAND POWER &amp; LIGHT COMPANY\./);
  assert.match(details, /This mapped distance is not used in the cost estimate/);
  assert.match(details, new RegExp(`<a href="${COPYRIGHT}"[^>]*>${CREDIT}</a>`));
});

test('far OSM line: the cost model keeps the "not mapped" range and says the distance is not confirmed', async () => {
  const far = page(withPower(await power(FAR_LINE))).electric();
  const none = page(withPower(await power([]))).electric();
  assert.equal(far.low, none.low);
  assert.equal(far.high, none.high);
  assert.match(far.basis, /No mapped line distance \(the nearest line mapped in OpenStreetMap is too far or too uncertain to price/);
  assert.doesNotMatch(far.basis, /1,45\d ft/);
  // Generic providers (no tariff): the road-based likely run, not a per-foot price on 1,456 ft.
  const coop = page(withPower(await power(FAR_LINE, { providers: ['NORTHERN LIGHTS INC'] }), 'NORTHERN LIGHTS INC')).electric();
  assert.match(coop.basis, /No mapped line distance \(the nearest line mapped in OpenStreetMap is too far/);
  assert.doesNotMatch(coop.basis, /OpenStreetMap to the parcel/);
});

test('unknown-type OSM line nearby: never priced, "Distance not confirmed"', async () => {
  const body = await power(UNKNOWN_LINE);
  assert.equal(body.distribution.estimatedDistanceFt, null);
  assert.equal(body.nearestLine.lineType, 'unknown');
  assert.equal(body.nearestLine.usableForCost, false);
  assert.deepEqual(body.nearestLine.attribution, { text: CREDIT, url: COPYRIGHT });
  const c = page(withPower(body)).card();
  assert.match(c.status, /^Nearest power line \(voltage not mapped\) mapped in OpenStreetMap ~18\d ft — /);
  assert.equal(c.grade, `Distance not confirmed — likely served, verify with ${INLAND}`);
});

// ---- Near OSM pole or minor_line: fed, labelled

test('near OSM pole (<= 1,000 ft): feeds the cost model, labelled "mapped lines only", poles before the far line', async () => {
  const body = await power(NEAR_POLE);
  assert.equal(body.distribution.status, 'osm_mapped_proximity');
  assert.equal(body.distribution.featureType, 'pole');
  assert.ok(Math.abs(body.distribution.estimatedDistanceFt - 0.0008 * FT_PER_DEG_LAT) <= 2, String(body.distribution.estimatedDistanceFt));
  assert.equal(body.distribution.usableForCost, true);
  assert.match(body.distribution.note, /^Nearest power pole mapped in OpenStreetMap about 29\d ft from the parcel \(mapped lines only\)\./);
  assert.equal(body.nearestLine.usableForCost, true);
  const p = page(withPower(body));
  const c = p.card();
  assert.match(c.status, /^Nearest power pole mapped in OpenStreetMap ~29\d ft — OSM maps few local lines here; the actual nearest line may be closer\. The utility confirms the route\. © OpenStreetMap contributors$/);
  assert.match(c.grade, /confidence · mapped lines only$/);
  const e = p.electric();
  assert.match(e.basis, /29\d ft from a line or pole mapped in OpenStreetMap to the parcel/);
  assert.match(e.basis, /Distance from mapped lines only: OSM maps few local lines here/);
  assert.match(e.basis, /Line data © OpenStreetMap contributors/);
  assert.equal(e.confidence, 'Moderate');
});

test('near OSM minor_line: fed to the cost model (a different range from "not mapped")', async () => {
  const near = page(withPower(await power(NEAR_LINE))).electric();
  const none = page(withPower(await power([]))).electric();
  assert.match(near.basis, /36\d ft from a line or pole mapped in OpenStreetMap to the parcel/);
  assert.notDeepEqual([near.low, near.high], [none.low, none.high]);
});

// ---- Avista's own map first

test("Avista: its DER hosting-capacity line map takes precedence over a nearer-looking OSM line", async () => {
  const body = await power(NEAR_POLE, { providers: ['AVISTA CORP'], avista: 'answer' });
  assert.equal(body.distribution.status, 'utility_published_proximity');
  assert.equal(body.distribution.sourceLabel, 'Avista map');
  assert.equal(body.distribution.usableForCost, true);
  assert.ok(Math.abs(body.distribution.estimatedDistanceFt - 0.0005 * FT_PER_DEG_LAT) <= 2, String(body.distribution.estimatedDistanceFt));
  assert.equal(body.nearestLine.sourceLabel, 'Avista map');
  assert.equal(body.nearestLine.mappedOnly, undefined);
  const p = page(withPower(body, 'AVISTA CORP'));
  const c = p.card();
  assert.match(c.status, /^Nearest distribution line on the Avista map ~18\d ft — the utility confirms the route$/);
  assert.doesNotMatch(c.status, /OpenStreetMap/);
  assert.match(p.electric().basis, /18\d ft from Avista's published distribution line map to the parcel/);
});

test("Avista: its map shows no line nearby and OSM's line is far -> Avista's answer kept, OSM named but not priced", async () => {
  const body = await power(FAR_LINE, { providers: ['AVISTA CORP'] });
  assert.equal(body.distribution.status, 'no_published_line_nearby');
  assert.equal(body.distribution.estimatedDistanceFt, null);
  assert.equal(body.nearestLine.usableForCost, false);
  assert.equal(body.nearestLine.mappedOnly, true);
  const p = page(withPower(body, 'AVISTA CORP'));
  assert.equal(p.card().grade, 'Distance not confirmed — likely served, verify with AVISTA CORP');
  assert.match(p.electric().basis, /No mapped line distance \(the nearest line mapped in OpenStreetMap is too far/);
  // Avista near OSM (no Avista line) still uses OSM, labelled.
  const near = await power(NEAR_LINE, { providers: ['AVISTA CORP'] });
  assert.equal(near.distribution.status, 'osm_mapped_proximity');
  assert.equal(near.distribution.usableForCost, true);
});

// ---- The printable report

test('report: power card follows the same rules and the sources list credits OpenStreetMap', async () => {
  const far = page(withPower(await power(FAR_LINE))).report();
  assert.match(far, /Distance not confirmed — likely served, verify with Inland Power &amp; Light Company\./i);
  assert.match(far, /actual nearest line may be much closer/);
  assert.match(far, /<li value="\d+">OpenStreetMap power lines \(© OpenStreetMap contributors; mapped lines only\)(?: <span class="url">www\.openstreetmap\.org<\/span>)?<\/li>/);
  assert.doesNotMatch(far, /Mapped line about 1,4\d\d ft away/);
  const near = page(withPower(await power(NEAR_LINE))).report();
  assert.match(near, /Nearest line mapped in OpenStreetMap about 36\d ft away \(mapped lines only; OSM maps few local lines here/);
  assert.match(near, /OpenStreetMap power lines \(© OpenStreetMap contributors; mapped lines only\)/);
  // Cost assumptions page: the electric line basis says mapped lines only, with the credit.
  assert.match(near, /Distance from mapped lines only: OSM maps few local lines here/);
  const avista = page(withPower(await power(NEAR_POLE, { providers: ['AVISTA CORP'], avista: 'answer' }), 'AVISTA CORP')).report();
  assert.match(avista, /Distribution line on the Avista map about 18\d ft away/);
  assert.match(avista, /Avista DER Hosting Capacity map/);
  assert.doesNotMatch(avista, /OpenStreetMap power lines/);
});

// ---- The browser fallback applies the same guard

test('browser fallback (osm-power): a far OSM line gives the same guarded answer as the Worker', async () => {
  const healthy = await power(FAR_LINE);
  globalThis.fetch = async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (/overpass/.test(url.hostname)) return jsonResponse({ error: 'busy' }, 429);
    if (url.pathname.includes('US_Electric_Power_Transmission_Lines')) return jsonResponse({ features: [] });
    return Promise.reject(new TypeError('fetch failed'));
  };
  const failed = await handlePowerIntelligence(post({ state: 'WA', providers: [INLAND], ...CENTER, geometry: PARCEL }));
  const h = makeLazyContext();
  const timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; };
  Object.assign(h.context, { URL, URLSearchParams, AbortController, Response, Headers, setTimeout: timer, clearTimeout, fetch: async () => jsonResponse({ elements: FAR_LINE }) });
  h.run(readPublic('browser-fallback.js'));
  const recovered = plain(await (await h.context.AcresXFallback.recover('/api/power-intelligence', failed)).json());
  delete recovered.proximity.loadedFrom; delete recovered.proximity.attempts; delete healthy.proximity.attempts;
  assert.deepEqual(recovered, healthy);
  assert.equal(recovered.distribution.status, 'osm_distance_not_confirmed');
});

test('browser fallback: its copy of the guard and the distribution rules is verbatim', () => {
  const src = readFileSync(new URL('../src/services/power-intelligence.js', import.meta.url), 'utf8');
  const browserText = readPublic('browser-fallback.js');
  const indent = text => text.split('\n').map(l => (l.trim() ? `  ${l}` : '')).join('\n');
  for (const name of ['osmDistribution', 'chooseNearestLine', 'unknownProviderDistribution', 'avistaDistribution', 'inlandDistribution']) {
    const start = src.search(new RegExp(`(?:export )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const fn = src.slice(start, src.indexOf('\n}\n', start) + 2).replace(/^export /, '');
    assert.ok(browserText.includes(indent(fn)), `browser copy differs: ${name}`);
  }
  for (const name of ['OSM_COST_MAX_FT', 'OSM_ATTRIBUTION', 'OSM_MAPPED_ONLY_NOTE', 'OSM_FEATURE_NAMES']) {
    const line = src.match(new RegExp(`(?:export )?const ${name} = .*`))[0].replace(/^export /, '');
    assert.ok(browserText.includes(`  ${line}`), `browser copy differs: ${name}`);
  }
});
