// Offline tests for the printable report (public/property-report-v2.js; calm layout 2026-11-17:
// summary, site details, zoning & records, costs & next steps, cost assumptions, sources).
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

// The page's wells now carry the terrain-aware estimate (public/well-terrain.js attaches it as
// wells.terrain; recorded for this parcel 2026-11-18: moderate confidence, 170 ft, 8 wells at similar elevation).
const TERRAIN = JSON.parse(readFileSync(new URL('./fixtures/well-depth-terrain-spokane-23123.9051.json', import.meta.url), 'utf8')).answer;
const withTerrain = data => { data.wells.terrain = structuredClone(TERRAIN); return data; };
const fixture = () => withTerrain(JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8')));
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js'];

function generate(data, { modules = MODULES, scoreMetric = '', name } = {}) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  for (const f of modules) h.run(readPublic(f));
  h.el('scoreMetric').textContent = scoreMetric;
  h.context.__acresxLast = data;
  h.generate(name);
  const html = h.opened.at(-1);
  const pages = html.split('<section class="page ').slice(1);
  return { html, pages, h };
}
const text = html => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const dollars = s => Number(String(s).replace(/[$,]/g, ''));
const amounts = s => { const [lo, hi = lo] = String(s).split('–'); return [dollars(lo), dollars(hi)]; };
const count = (hay, needle) => hay.split(needle).length - 1;

test('six Letter pages (with the cost-assumptions page), with "Page N of 6" on every page', () => {
  const { html, pages } = generate(fixture());
  assert.equal(pages.length, 6);
  pages.forEach((p, i) => assert.match(p, new RegExp(`AcresX · Preliminary property intelligence · Verify material findings</span><span>Page ${i + 1} of 6`)));
  assert.match(html, /break-after:page/, 'one Letter page per section (the @page rule is checked in test/report-view.test.js)');
  assert.match(html, /break-inside:avoid/);
  assert.match(html, /print-color-adjust:exact/, 'backgrounds print, so the score is not faded');
  assert.doesNotMatch(html, /V5/);
});

test('cost total: page 1 = page 4 total = sum of the lines = AcresXCostModel.estimate()', () => {
  const data = fixture();
  const { pages, h } = generate(data);
  const page1 = /<div class="t-num t-range">([^<]+)<\/div>/.exec(pages[0])[1];
  const total = /<tfoot><tr><td colspan="2">Total \(matches page 1\)<\/td><td class="amt">([^<]+)<\/td>/.exec(pages[3])[1];
  assert.equal(page1, total);
  const lines = [...pages[3].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.equal(lines.length, 6);
  const sum = lines.reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]);
  assert.deepEqual(amounts(total), sum);
  const e = h.context.AcresXCostModel.estimate(data);
  assert.deepEqual(amounts(total), [e.low, e.high]);
  // The well line's high end is the high end of the depth range (230 ft, was the 100 ft median): +130 ft x $60.
  assert.equal(total, '$45,437–$97,366');
});

test('page 5: the assumptions of each cost line, with the same source numbers as the cost table', () => {
  const { pages } = generate(fixture());
  const [p3, p4, src] = [pages[3], pages[4], pages[5]];
  assert.match(p3, /<p class="pointer">How each line was estimated: appendix, page 5\.<\/p>/);
  assert.doesNotMatch(p3, /Exact SRHD fees/, 'the long basis text is on page 5');
  assert.match(src, /<ol class="sources">/);
  assert.match(src, /Preliminary screening only\./);
  assert.match(p4, /<div class="eyebrow">Cost assumptions<\/div>/);
  const rowRefs = [...p3.split('<tfoot>')[0].matchAll(/<strong>([^<]+)<\/strong>(<sup class="ref">\[[^\]]*\]<\/sup>)<\/td>/g)].map(m => [m[1], m[2]]);
  const noteRefs = [...p4.matchAll(/<li><strong>([^<]+)<\/strong>(<sup class="ref">\[[^\]]*\]<\/sup>)/g)].map(m => [m[1], m[2]]);
  assert.equal(noteRefs.length, 6);
  assert.deepEqual(noteRefs, rowRefs);
  const sourceCount = (src.match(/<li value="/g) || []).length;
  for (const [, sup] of noteRefs) for (const n of sup.match(/\d+/g)) assert.ok(Number(n) <= sourceCount, `source [${n}] is listed on page 6`);
  assert.match(p4, /Exact SRHD fees \$1,890/);
  assert.match(p4, /<span class="amt-note">\$2,136<\/span>/);
});

test('no cost estimate: no assumptions page, "Page N of 5"', () => {
  const data = { parcel: { type: 'Feature', geometry: null, properties: { ORIG_PARCEL_ID: 'X1', _countyDisplay: 'Spokane', _stateCode: 'WA' } }, wells: [], utility: [] };
  const { pages } = generate(data, { modules: ['acreage.js', 'property-report-v2.js'] });
  assert.equal(pages.length, 5);
  assert.match(pages[4], /Page 5 of 5/);
  assert.match(pages[4], /<ol class="sources">|No sources recorded/);
  assert.doesNotMatch(pages.join(''), /appendix|How each cost line/);
});

test('a range whose low equals high prints one number', () => {
  const { pages } = generate(fixture());
  assert.match(pages[3], /Permits \(building \+ approach\)[\s\S]*?<td class="amt">\$2,136<\/td>/);
  assert.doesNotMatch(pages[3], /\$2,136–\$2,136/);
});

test('cost lines carry a confidence tag from their sources; long source text moves to Sources', () => {
  const { pages } = generate(fixture());
  const tags = [...pages[3].matchAll(/<strong>([^<]+)<\/strong><sup[^>]*>[^<]*<\/sup><\/td><td><span class="tag \w+">([^<]+)<\/span>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(tags), {
    Well: 'Estimate — get a quote', Septic: 'Estimate — get a quote', 'Power (Inland Power line extension)': 'Local price',
    Driveway: 'Local price', 'Site work': 'Estimate — get a quote', 'Permits (building + approach)': 'Published fee'
  });
  assert.match(pages[3], /Screening estimate, not a quote\./);
  assert.match(pages[5], /<ol class="sources">[\s\S]*Spokane County BP-04 Fee Schedule, Building Dept\. \(owner-provided, undated\), undated/);
  assert.match(pages[5], /WSDOT bid tabulation 26Z001, 2026 Eastern Region \(bids opened Apr 22, 2026\), as of 2026-04-22/);
  assert.doesNotMatch(pages[3], /RCW 18\.104\.055/, 'not inside the cost table');
  assert.match(pages[5], /RCW 18\.104\.055/);
});

test('score equals the dashboard and comes with three plain-word drivers', () => {
  const data = fixture();
  const { pages, h } = generate(data);
  const shown = /<div class="t-num">([^<]+)<small>/.exec(pages[0])[1];
  assert.equal(shown, h.context.AcresXScore.calculate().score.toFixed(1));
  assert.equal(shown, '7.8');
  assert.match(pages[0], /class="tile t-score band-good"/);
  assert.match(pages[0], /<p class="t-label"><i class="dot good"><\/i>Good<\/p>/);
  // The drivers are on page 2, each with a status dot.
  const drivers = [...pages[1].matchAll(/<li class="(good|risk)"><i class="dot \1"><\/i><p>([^<]+)<\/p><\/li>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(drivers, [['risk', 'High-risk FEMA flood zone on the parcel'], ['good', 'Nearly flat ground (0.3% average grade)'], ['good', 'Soils look favorable for a septic system']]);
  assert.match(pages[1], /<p class="c-lead"><strong>7\.8 of 10<\/strong> · Good<\/p>/);
  // When the dashboard shows a score, the report prints that one.
  assert.match(generate(data, { scoreMetric: '6.1' }).pages[0], /<div class="t-num">6\.1<small>/);
  assert.match(generate(data, { scoreMetric: '6.1' }).pages[0], /band-fair/);
});

test('key findings: at most 5 on page 1, one status dot each, risks first', () => {
  const { pages, h } = generate(fixture());
  const flags = [...pages[0].matchAll(/<li class="(risk|verify|good)"><i class="dot \1"><\/i><p><strong>([^<]+)<\/strong>/g)].map(m => `${m[1]}: ${m[2]}`);
  assert.deepEqual(flags, [
    'risk: High-risk flood zone on the parcel', 'risk: Mapped wetland on the parcel',
    'verify: Access is by a private road', 'verify: Overlapping power territories',
    'good: Zoning allows a home (RT)'
  ]);
  // The 6th finding opens page 2.
  assert.equal(h.context.AcresXReport.gatherFacts(fixture()).findings.length, 6);
  assert.match(pages[1], /<h2>More findings<\/h2><ul class="kf"><li class="good"><i class="dot good"><\/i><p><strong>Low slope<\/strong><span class="kf-d"> — 0\.3% average grade<\/span>/);
  assert.match(pages[0], /<span class="kf-d"> — Nearest road Blasted Ln is private; confirm a recorded easement\.<\/span>/);
});

test('flood, wetland and overlay details render', () => {
  const { pages } = generate(fixture());
  const t = text(pages[1] + pages[2]);
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
  assert.match(pages[0], /<p class="c-meta">Parcel 23123\.9051 <span class="sep">·<\/span> Spokane County, Washington <span class="sep">·<\/span> <span class="c-acres">20\.48 ac \(assessor\) · 20\.63 ac mapped<\/span><\/p>/);
  assert.match(pages[0], /Spokane County, Washington/);
  assert.equal(count(html, '$203,360'), 1);
  const withStreet = fixture();
  withStreet.parcel.properties.SITUS_ADDRESS = '2610 W DYNAMITE RD';
  assert.match(generate(withStreet).pages[0], /<h1>2610 W Dynamite Rd<\/h1>/);
});

test('pages 2-3: zoning in plain words, two-column use table, normal-case power, tax category label', () => {
  const { pages } = generate(fixture());
  const p2 = pages[1] + pages[2];
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
  assert.match(one[2], /<section class="c-sec block"><h2>Listing<\/h2><p class="listing"><strong>Active · List \$250,000 · 12 days on market · MLS SAR1/);
  assert.match(one[2], /do not affect the buildability score/);
  assert.equal(/t-num">([^<]+)/.exec(one[0])[1], /t-num">([^<]+)/.exec(none[0])[1]);
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

test('Idaho (Kootenai, local prices), Montana (Gallatin, local prices) and Stevens (generic ranges) render every page', () => {
  const id = generate(county({ ORIG_PARCEL_ID: 'C1', _countyDisplay: 'Kootenai', _stateCode: 'ID', SITUS_ADDRESS: '5811 N CHRISTOPHER DR', SITUS_CITY_NM: 'COEUR D ALENE' }, { utility: ['KOOTENAI ELECTRIC COOPERATIVE', 'AVISTA CORP'] }));
  assert.equal(id.pages.length, 6);
  assert.match(id.pages[0], /<h1>5811 N Christopher Dr<\/h1>/);
  assert.match(id.pages[0], /Kootenai County, Idaho/);
  assert.match(id.html, /Local prices for Kootenai County, ID/);
  assert.match(id.html, /Idaho Department of Water Resources \(IDWR\) well records/);
  assert.match(id.html, /Kootenai Electric Cooperative · also listed: Avista Corp/);

  // Gallatin, inside a county zoning district: local prices. The permit line is all published
  // fees (DLI, Land Use Permit, Road & Bridge); the driveway is MDT bid prices; the rest carry an
  // AcresX planning allowance.
  const mt = generate(county({ ORIG_PARCEL_ID: 'M1', _countyDisplay: 'Gallatin', _stateCode: 'MT' }, { zoningPermits: { zoning: { status: 'gis_match', code: 'RR-10' }, permitJurisdiction: { name: 'Gallatin County' } } }));
  assert.equal(mt.pages.length, 6);
  assert.match(mt.pages[0], /<h1>No situs address<\/h1>/);
  assert.match(mt.html, /Montana Bureau of Mines and Geology GWIC well records/);
  assert.match(mt.html, /Local prices for Gallatin County, MT/);
  const tagOf = (html, label) => new RegExp(`<strong>${label}[^<]*<\\/strong>(?:<sup class="ref">[^<]*<\\/sup>)?<\\/td><td><span class="tag (\\w+)">`).exec(html)?.[1];
  assert.equal(tagOf(mt.pages[3], 'Permits'), 'fee', 'permits: Published fee');
  assert.equal(tagOf(mt.pages[3], 'Driveway'), 'local', 'driveway: Local price');
  for (const label of ['Well', 'Septic', 'Power', 'Site work']) assert.equal(tagOf(mt.pages[3], label), 'estimate', label);
  assert.match(mt.html, /Land Use Permit/);
  const mtLines = [...mt.pages[3].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.equal(mtLines.length, 6);
  assert.deepEqual(amounts(/<div class="t-num t-range">([^<]+)<\/div>/.exec(mt.pages[0])[1]), mtLines.reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]));

  const wa = generate(county({ ORIG_PARCEL_ID: 'S1', _countyDisplay: 'Stevens', _stateCode: 'WA' }, { utility: ['AVISTA CORP'] }));
  assert.equal(wa.pages.length, 6, 'generic lines carry a basis too');
  assert.match(wa.html, /Generic regional ranges; local prices not yet sourced for this county\./);
  const page1 = /<div class="t-num t-range">([^<]+)<\/div>/.exec(wa.pages[0])[1];
  const lines = [...wa.pages[3].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.equal(lines.length, 5);
  assert.deepEqual(amounts(page1), lines.reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]));
  assert.equal([...wa.pages[3].matchAll(/class="tag estimate">Estimate — get a quote/g)].length, 5, 'generic lines are estimates');
  for (const r of [id, mt, wa]) assert.doesNotMatch(text(r.html), /undefined|NaN/);
});

test('a county without the local cost model uses its generic estimate on both pages', () => {
  const data = county({ ORIG_PARCEL_ID: 'Y1', _countyDisplay: 'Yellowstone', _stateCode: 'MT' });
  const noModel = MODULES.filter(f => f !== 'local-cost-model.js' && f !== 'cost-tables.js');
  const { pages } = generate(data, { modules: noModel });
  const page1 = /<div class="t-num t-range">([^<]+)<\/div>/.exec(pages[0])[1];
  const total = /<tfoot>[\s\S]*?<td class="amt">([^<]+)<\/td>/.exec(pages[3])[1];
  assert.equal(page1, total);
  assert.match(pages[3], /Generic regional ranges/);
});
