// Offline tests for the 3-page printable report (public/property-report-v2.js, redesign 2026-11-13).
// The report runs in the lazy fake DOM from test/ui-harness.js with the modules it reads at
// generation time: cost tables + local cost model, public utilities, acreage, flood and wetland
// readers, and the score (screening-refinements.js). No network.
//
// Fixture: test/fixtures/report-spokane-23123.9051.json is the page's `last` for Spokane parcel
// 23123.9051 (live answers of 2026-11-13, trimmed: permit history, listing candidate and well-record
// details removed; no owner names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeLazyContext, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js'];

function generate(data, { modules = MODULES, scoreMetric = '', name } = {}) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  for (const f of modules) h.run(readPublic(f));
  if (name !== undefined) h.context.prompt = () => name;
  h.el('scoreMetric').textContent = scoreMetric;
  h.context.__acresxLast = data;
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  const pages = html.split('<section class="page ').slice(1);
  return { html, pages, h };
}
const text = html => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const dollars = s => Number(String(s).replace(/[$,]/g, ''));
const amounts = s => { const [lo, hi = lo] = String(s).split('–'); return [dollars(lo), dollars(hi)]; };
const count = (hay, needle) => hay.split(needle).length - 1;

test('three Letter pages with a numbered footer on every page', () => {
  const { html, pages } = generate(fixture());
  assert.equal(pages.length, 3);
  pages.forEach((p, i) => assert.match(p, new RegExp(`AcresX · Preliminary property intelligence · Verify material findings</span><span>Page ${i + 1} of 3`)));
  assert.match(html, /@page\{size:letter;margin:0\}/);
  assert.match(html, /break-inside:avoid/);
  assert.match(html, /print-color-adjust:exact/, 'backgrounds print, so the score is not faded');
  assert.doesNotMatch(html, /V5/);
});

test('cost total: page 1 = page 3 total = sum of the lines = AcresXCostModel.estimate()', () => {
  const data = fixture();
  const { pages, h } = generate(data);
  const page1 = /<div class="cost-num">([^<]+)<\/div>/.exec(pages[0])[1];
  const total = /<tfoot><tr><td colspan="2">Total \(matches page 1\)<\/td><td class="amt">([^<]+)<\/td>/.exec(pages[2])[1];
  assert.equal(page1, total);
  const lines = [...pages[2].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.equal(lines.length, 6);
  const sum = lines.reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]);
  assert.deepEqual(amounts(total), sum);
  const e = h.context.AcresXCostModel.estimate(data);
  assert.deepEqual(amounts(total), [e.low, e.high]);
  assert.equal(total, '$45,437–$89,566');
});

test('a range whose low equals high prints one number', () => {
  const { pages } = generate(fixture());
  assert.match(pages[2], /Permits \(building \+ approach\)[\s\S]*?<td class="amt">\$2,136<\/td>/);
  assert.doesNotMatch(pages[2], /\$2,136–\$2,136/);
});

test('cost lines carry a confidence tag from their sources; long source text moves to Sources', () => {
  const { pages } = generate(fixture());
  const tags = [...pages[2].matchAll(/<strong>([^<]+)<\/strong><sup[^>]*>[^<]*<\/sup><\/td><td><span class="tag \w+">([^<]+)<\/span>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(tags), {
    Well: 'Estimate — get a quote', Septic: 'Estimate — get a quote', 'Power (Inland Power line extension)': 'Local price',
    Driveway: 'Local price', 'Site work': 'Estimate — get a quote', 'Permits (building + approach)': 'Published fee'
  });
  assert.match(pages[2], /Screening estimate, not a quote\./);
  assert.match(pages[2], /<ol class="sources">[\s\S]*Spokane County BP-04 Fee Schedule, Building Dept\. \(owner-provided, undated\), undated/);
  assert.match(pages[2], /WSDOT bid tabulation 26Z001, 2026 Eastern Region \(bids opened Apr 22, 2026\), as of 2026-04-22/);
  assert.doesNotMatch(pages[2].split('<ol class="sources">')[0], /RCW 18\.104\.055/, 'not inside the cost table');
});

test('score equals the dashboard and comes with three plain-word drivers', () => {
  const data = fixture();
  const { pages, h } = generate(data);
  const shown = /<div class="score-num">([^<]+)<small>/.exec(pages[0])[1];
  assert.equal(shown, h.context.AcresXScore.calculate().score.toFixed(1));
  assert.equal(shown, '7.8');
  assert.match(pages[0], /class="score-card band-good"/);
  const drivers = [...pages[0].matchAll(/<li class="(good|risk)"><b>(✓|⚠)<\/b>([^<]+)<\/li>/g)].map(m => [m[2], m[3]]);
  assert.deepEqual(drivers, [['⚠', 'High-risk FEMA flood zone on the parcel'], ['✓', 'Nearly flat ground (0.3% average grade)'], ['✓', 'Soils look favorable for a septic system']]);
  // When the dashboard shows a score, the report prints that one.
  assert.match(generate(data, { scoreMetric: '6.1' }).pages[0], /<div class="score-num">6\.1<small>/);
  assert.match(generate(data, { scoreMetric: '6.1' }).pages[0], /band-fair/);
});

test('key findings: 4-6 color-coded flags, risks first', () => {
  const { pages } = generate(fixture());
  const flags = [...pages[0].matchAll(/<div class="flag (risk|verify|good)"><b>[^<]*<\/b><div><strong>([^<]+)<\/strong>/g)].map(m => `${m[1]}: ${m[2]}`);
  assert.deepEqual(flags, [
    'risk: High-risk flood zone on the parcel', 'risk: Mapped wetland on the parcel',
    'verify: Access is by a private road', 'verify: Overlapping power territories',
    'good: Zoning allows a home (RT)', 'good: Low slope'
  ]);
});

test('flood, wetland and overlay details render', () => {
  const t = text(generate(fixture()).pages[1]);
  assert.match(t, /FEMA zone A \(1% annual chance, Special Flood Hazard Area\)/);
  assert.match(t, /High risk/);
  assert.match(t, /5\.1% of parcel · 1\.06 ac · Freshwater Emergent Wetland/);
  assert.match(t, /County map: permanent marsh on 9%; 190 ft buffer on 31%; 250 ft buffer on 42%/);
  assert.match(t, /Critical aquifer recharge area: moderate susceptibility whole parcel/);
  assert.match(t, /Mapped wetland buffer: 190 foot buffer 31% of parcel/);
  assert.match(t, /Outside the urban growth area/);
  assert.doesNotMatch(t, /No additional parcel-specific detail/);
});

test('flood share of the parcel prints when the answer carries one', () => {
  const data = fixture();
  data.flood.sharePct = 12.4;
  assert.match(text(generate(data).pages[1]), /Flood zone covers about 12% of the parcel/);
});

test('header: address or "No situs address", parcel once, acres both ways; assessed value once', () => {
  const { pages, html } = generate(fixture());
  assert.match(pages[0], /<h1>No situs address<\/h1>/);
  assert.equal(count(pages[0], '23123.9051'), 1);
  assert.match(pages[0], /<span>Parcel size<\/span><strong>20\.48 ac \(assessor\) · 20\.63 ac mapped<\/strong>/);
  assert.match(pages[0], /Spokane County, Washington/);
  assert.equal(count(html, '$203,360'), 1);
  const withStreet = fixture();
  withStreet.parcel.properties.SITUS_ADDRESS = '2610 W DYNAMITE RD';
  assert.match(generate(withStreet).pages[0], /<h1>2610 W Dynamite Rd<\/h1>/);
});

test('page 2: zoning in plain words, two-column use table, normal-case power, tax category label', () => {
  const p2 = generate(fixture()).pages[1];
  assert.match(p2, /<div class="zone-code">RT<\/div><div><strong>Rural Traditional<\/strong>/);
  assert.match(p2, /A single-family home is permitted outright, within the density limit \(maximum 1 dwelling unit per 10 acres\)/);
  assert.equal(count(p2, '<tr>'), 5, '10 uses in two columns');
  assert.match(p2, /Inland Power &amp; Light Company · also listed: Avista Corp/);
  assert.doesNotMatch(p2, /INLAND POWER/);
  assert.match(p2, /<span>Tax category<\/span><strong>91 – Vacant Land<\/strong><small>Tax category, not zoning<\/small>/);
  assert.match(p2, /578 ft to Blasted Ln \(private road\)/);
  assert.doesNotMatch(p2, /Next step/);
});

test('listing shows only when one matched, and never changes the score', () => {
  const data = fixture();
  const none = generate(data).pages;
  assert.doesNotMatch(none.join(''), /Listing claims are unverified/);
  data.resoListings = { available: true, best: { status: 'Active', listPrice: 250000, daysOnMarket: 12, listingId: 'SAR1' } };
  const one = generate(data).pages;
  assert.match(one[1], /Active · List \$250,000 · 12 days on market · MLS SAR1/);
  assert.match(one[1], /do not affect the buildability score/);
  assert.equal(/score-num">([^<]+)/.exec(one[0])[1], /score-num">([^<]+)/.exec(none[0])[1]);
});

test('no owner names, even when the parcel record carries one', () => {
  const data = fixture();
  data.parcel.properties.OWNER_NAME = 'JANE Q SAMPLE';
  data.parcel.properties.OwnerName = 'Jane Q Sample';
  assert.doesNotMatch(generate(data).html, /Sample/i);
});

test('missing data says "Not available" — never undefined, NaN or $0', () => {
  const data = { parcel: { type: 'Feature', geometry: null, properties: { ORIG_PARCEL_ID: 'X1', _countyDisplay: 'Spokane', _stateCode: 'WA' } }, wells: [], utility: [] };
  const { html } = generate(data, { modules: ['acreage.js', 'property-report-v2.js'] });
  const t = text(html);
  assert.doesNotMatch(t, /undefined|NaN|null/);
  assert.doesNotMatch(t, /\$0(?![\d,])/);
  assert.match(t, /Not available/);
  assert.match(t, /Parcel outline not available for a map/);
  assert.match(t, /Cost inputs were not available/);
  // The same with every module loaded (the cost model still prices a Spokane parcel).
  const full = text(generate(data).html);
  assert.doesNotMatch(full, /undefined|NaN/);
  assert.doesNotMatch(full, /\$0(?![\d,])/);
});

const square = { type: 'Polygon', coordinates: [[[-116.8, 47.7], [-116.79, 47.7], [-116.79, 47.71], [-116.8, 47.71], [-116.8, 47.7]]] };
function county(props, extra = {}) {
  return { parcel: { type: 'Feature', geometry: square, properties: props }, wells: [{ properties: { CompletedDepth: 300 } }], utility: ['NORTHWESTERN ENERGY'], land: { soil: { available: true, feasibility: 'moderate', mapUnit: 'Loam' }, terrain: { available: true, gradePct: 6, reliefFt: 20 } }, flood: { available: true, intersects: false, zones: [] }, wetlands: { available: true, intersects: false, category: 'none' }, ...extra };
}

test('Idaho (Kootenai, local prices) and Montana (Gallatin, generic ranges) render all three pages', () => {
  const id = generate(county({ ORIG_PARCEL_ID: 'C1', _countyDisplay: 'Kootenai', _stateCode: 'ID', SITUS_ADDRESS: '5811 N CHRISTOPHER DR', SITUS_CITY_NM: 'COEUR D ALENE' }, { utility: ['KOOTENAI ELECTRIC COOPERATIVE', 'AVISTA CORP'] }));
  assert.equal(id.pages.length, 3);
  assert.match(id.pages[0], /<h1>5811 N Christopher Dr<\/h1>/);
  assert.match(id.pages[0], /Kootenai County, Idaho/);
  assert.match(id.html, /Local prices for Kootenai County, ID/);
  assert.match(id.html, /Idaho Department of Water Resources \(IDWR\) well records/);
  assert.match(id.html, /Kootenai Electric Cooperative · also listed: Avista Corp/);

  const mt = generate(county({ ORIG_PARCEL_ID: 'M1', _countyDisplay: 'Gallatin', _stateCode: 'MT' }));
  assert.equal(mt.pages.length, 3);
  assert.match(mt.pages[0], /<h1>No situs address<\/h1>/);
  assert.match(mt.html, /Montana Bureau of Mines and Geology GWIC well records/);
  assert.match(mt.html, /Generic regional ranges; local prices not yet sourced for this county\./);
  const page1 = /<div class="cost-num">([^<]+)<\/div>/.exec(mt.pages[0])[1];
  const lines = [...mt.pages[2].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.equal(lines.length, 5);
  assert.deepEqual(amounts(page1), lines.reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]));
  assert.equal([...mt.pages[2].matchAll(/class="tag estimate">Estimate — get a quote/g)].length, 5, 'generic lines are estimates');
  for (const r of [id, mt]) assert.doesNotMatch(text(r.html), /undefined|NaN/);
});

test('a county without the local cost model uses its generic estimate on both pages', () => {
  const data = county({ ORIG_PARCEL_ID: 'Y1', _countyDisplay: 'Yellowstone', _stateCode: 'MT' });
  const noModel = MODULES.filter(f => f !== 'local-cost-model.js' && f !== 'cost-tables.js');
  const { pages } = generate(data, { modules: noModel });
  const page1 = /<div class="cost-num">([^<]+)<\/div>/.exec(pages[0])[1];
  const total = /<tfoot>[\s\S]*?<td class="amt">([^<]+)<\/td>/.exec(pages[2])[1];
  assert.equal(page1, total);
  assert.match(pages[2], /Generic regional ranges/);
});
