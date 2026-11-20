// Offline tests for the calm report layout (public/property-report-v2.js, 2026-11-17: realtors
// found page 1 overwhelming). Six Letter pages: summary, site details, zoning & records, costs &
// next steps, cost assumptions (when the cost lines carry them) and sources. Content details per
// page are also covered by test/property-report.test.js and the other report tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeLazyContext, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['report-branding.js', 'flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'buildable-area.js', 'property-report-v2.js'];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JANE = { name: 'Jane Example', brokerage: 'Example Realty', phone: '(509) 555-0100', email: 'jane@example.com', website: 'example.com', license: '' };
const BUILDABLE = {
  status: 'measured', parcelAcres: 20.63, buildableAcres: 6.62, buildablePct: 32.1, overlapAcres: 10.49,
  removed: [
    { key: 'flood', reason: 'FEMA high-risk flood zone A', acres: 13.85, pct: 67.1 },
    { key: 'wetland', reason: 'Mapped wetlands (NWI + Spokane County)', acres: 2.41, pct: 11.7 }
  ],
  mayAlsoRestrict: [{ key: 'buffer', reason: 'Mapped wetland buffers (190/250 ft, Spokane County)', acres: 1.2, pct: 5.8 }],
  layers: [{ key: 'flood', status: 'counted' }, { key: 'wetland', status: 'counted' }, { key: 'buffer', status: 'shown' }],
  notes: [], disclaimer: 'Screening estimate, not a survey.'
};

function context({ data = fixture(), brand } = {}) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.URL = URL;
  const store = new Map();
  h.context.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  for (const f of MODULES) h.run(readPublic(f));
  if (brand) assert.equal(h.context.AcresXBranding.save(brand).ok, true);
  h.context.__acresxLast = data;
  return h;
}
function generate(opts = {}, name) {
  const h = context(opts);
  h.generate(name);
  const html = h.opened.at(-1);
  return { html, pages: html.split('<section class="page ').slice(1), h };
}
const withBuildable = () => { const d = fixture(); d.buildableArea = BUILDABLE; return d; };
const text = html => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const dollars = s => Number(String(s).replace(/[$,]/g, ''));
const amounts = s => { const [lo, hi = lo] = String(s).split('–'); return [dollars(lo), dollars(hi)]; };

test('six Letter pages, "Page N of 6" on every page; Letter, fit-to-page and iOS text size rules', () => {
  const { pages, h } = generate({ data: withBuildable() });
  const html = h.context.AcresXReport.renderHtml(h.context.AcresXReport.buildModel('x'), { brand: null });
  assert.equal(pages.length, 6);
  pages.forEach((p, i) => {
    assert.match(p, new RegExp(`^p${i + 1}"`));
    assert.match(p, new RegExp(`<span>Page ${i + 1} of 6</span></footer>`));
  });
  assert.match(html, /@page\{size:letter;margin:0\}/);
  assert.match(html, /break-after:page/);
  assert.match(html, /text-size-adjust:100%/, 'iOS text autosizing stays off');
  assert.match(html, /window\.__acresxFit=fit/, 'the page-fit step still runs');
  assert.deepEqual(pages.map(p => (/<div class="eyebrow">([^<]+)<\/div>/.exec(p) || [])[1] || 'summary'), ['summary', 'Site details', 'Zoning &amp; records', 'Costs &amp; next steps', 'Cost assumptions', 'Sources']);
});

test('page 1: header, address line, map, three tiles, at most 5 findings, disclaimer; details moved off', () => {
  const { pages, h } = generate({ data: withBuildable() }, 'Client 1042');
  const p1 = pages[0];
  assert.match(p1, /<header class="c-head"><img class="logo" src="\/assets\/acresx-logo\.png"/);
  assert.match(p1, /<p class="c-meta">Parcel 23123\.9051 <span class="sep">·<\/span> Spokane County, Washington/);
  assert.match(p1, /Reference: Client 1042/);
  assert.match(p1, /<figure class="map">/);
  const tiles = [...p1.matchAll(/<article class="tile (t-\w+)/g)].map(m => m[1]);
  assert.deepEqual(tiles, ['t-score', 't-acres', 't-cost']);
  // Score tile: the dashboard's number, label and one-line why.
  const calc = h.context.AcresXScore.calculate();
  assert.match(p1, new RegExp(`<div class="t-num">${calc.score.toFixed(1).replace('.', '\\.')}<small>/10</small></div>`));
  assert.match(p1, /<p class="t-label"><i class="dot good"><\/i>(Good|Excellent)<\/p>/);
  assert.match(p1, /<p class="t-why">[^<]+\.<\/p>/);
  // Buildable acres tile.
  assert.match(p1, /<div class="t-num">6\.6<small> of 20\.6 ac<\/small><\/div><p class="t-label">About 32\.1% of the parcel<\/p>/);
  // Cost tile: likely range and the most likely total.
  assert.match(p1, /<div class="t-num t-range">\$[\d,]+–\$[\d,]+<\/div><p class="t-label">Most likely about \$\d+k<\/p>/);
  // Key findings: at most 5, risks first, one dot each, no filled flag boxes.
  const levels = [...p1.split('<ul class="kf">')[1].split('</ul>')[0].matchAll(/<li class="(\w+)"><i class="dot \1"><\/i>/g)].map(m => m[1]);
  assert.ok(levels.length >= 3 && levels.length <= 5, `${levels.length} findings`);
  assert.equal(levels[0], 'risk');
  assert.deepEqual([...levels].sort((a, b) => ['risk', 'verify', 'good'].indexOf(a) - ['risk', 'verify', 'good'].indexOf(b)), levels, 'risks, then verify, then good');
  assert.doesNotMatch(p1, /class="flag /);
  assert.match(p1, /Verify material findings with the responsible agency/);
  // Moved off page 1: score drivers and the buildable breakdown (page 2), the coverage line (last page).
  assert.doesNotMatch(p1, /class="c-list drivers"|Removed: FEMA|class="coverage/);
  assert.match(pages[1], /class="c-list drivers"/);
  assert.match(pages[1], /Removed: FEMA high-risk flood zone A <b>13\.8 ac<\/b> \(67\.1%\)/);
  assert.match(pages[1], /May also be restricted:<\/b> mapped wetland buffers/);
  assert.match(pages[1], /Verify with the responsible agency\./);
});

test('every fact lands on a page: findings, site conditions, cost lines, checklist, numbered sources', () => {
  const { pages, h } = generate({ data: withBuildable() });
  const html = pages.join('');
  const f = h.context.AcresXReport.gatherFacts(withBuildable());
  for (const x of f.findings) assert.ok(text(html).includes(x.title.replace(/&/g, '&')), x.title);
  const titles = [...pages[1].matchAll(/<article class="site"><div class="site-top"><h3>([^<]+)/g)].map(m => m[1]);
  assert.deepEqual(titles, ['Water / well', 'Septic / soil', 'Public water / sewer', 'Power', 'Access / driveway', 'Flood', 'Wetlands', 'Terrain']);
  for (const bit of ['<div class="zone-code">', '<table class="uses">', '<ul class="overlays">', '<div class="assessor">']) assert.ok(pages[2].includes(bit), bit);
  // Cost: page 1 tile = page 4 total = sum of the lines; what the total sums is said on page 4.
  const tile = /<div class="t-num t-range">([^<]+)<\/div>/.exec(pages[0])[1];
  const total = /Total \(matches page 1\)<\/td><td class="amt">[^<]+<\/td><td class="amt">([^<]+)<\/td>/.exec(pages[3])[1];
  assert.equal(tile, total);
  const lines = [...pages[3].split('<tfoot>')[0].matchAll(/<td class="amt">[^<]+<\/td><td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.deepEqual(lines.reduce((s, [lo, hi]) => [s[0] + lo, s[1] + hi], [0, 0]), amounts(total));
  assert.match(pages[3], /The total is the sum of 6 lines: well, septic, power, driveway, site work, permits\./);
  assert.equal((pages[3].match(/<li><p><strong>/g) || []).length, 7, 'the before-you-buy checklist');
  // Sources: numbered in page order, every bracketed number listed on the last page.
  const count = (pages[5].match(/<li value="/g) || []).length;
  assert.ok(count >= 10);
  for (const [, sup] of html.matchAll(/<sup class="ref">\[([^\]]+)\]<\/sup>/g)) for (const n of sup.match(/\d+/g)) assert.ok(Number(n) <= count);
  assert.match(pages[3], /How each line was estimated: appendix, page 5\./);
  assert.match(pages[4], /How each cost line was estimated/);
  assert.match(pages[4], /<ol class="notes"><li><strong>/);
  assert.match(pages[4], /sources on page 6\./);
  assert.match(pages[5], /Preliminary screening only\.<\/strong> AcresX compiles public records/);
});

test('findings past the first 5 open page 2 ("More findings"), so every finding prints', () => {
  const h = context();
  const R = h.context.AcresXReport;
  const model = R.buildModel('x');
  const levels = ['risk', 'risk', 'verify', 'verify', 'verify', 'good', 'good'];
  model.f = { ...model.f, findings: levels.map((level, i) => ({ level, title: `Finding number ${i + 1}`, detail: `Detail ${i + 1}` })) };
  const pages = R.renderHtml(model, { brand: null }).split('<section class="page ').slice(1);
  const titles = p => [...p.matchAll(/<li class="(\w+)"><i class="dot \1"><\/i><p><strong>(Finding number \d)<\/strong>/g)].map(m => m[2]);
  assert.deepEqual(titles(pages[0]), ['Finding number 1', 'Finding number 2', 'Finding number 3', 'Finding number 4', 'Finding number 5']);
  assert.match(pages[1], /<section class="c-sec block c-findings"><h2>More findings<\/h2><ul class="kf">/);
  assert.deepEqual(titles(pages[1]), ['Finding number 6', 'Finding number 7']);
  for (const x of model.f.findings) assert.ok(titles(pages[0] + pages[1]).includes(x.title), x.title);
  assert.match(pages[1], /Detail 7/);
  // Five or fewer: no "More findings" section.
  model.f.findings = model.f.findings.slice(0, 5);
  assert.doesNotMatch(R.renderHtml(model, { brand: null }), /More findings/);
});

test('page 1 second line names a city only: no stray state code after "County, State"', () => {
  const mt = fixture();
  Object.assign(mt.parcel.properties, { _stateCode: 'MT', _countyDisplay: 'Yellowstone', _stateDisplay: 'Montana', SITUS_CITY_NM: '', SITUS_ZIP_NR: '' });
  const p1 = generate({ data: mt }).pages[0];
  assert.match(p1, /Yellowstone County, Montana/);
  assert.doesNotMatch(p1, /<p class="c-sub">MT/);
  assert.doesNotMatch(p1, /<p class="c-sub">/, 'no reference either: no second line at all');
  const withRef = generate({ data: mt }, 'Client 1042').pages[0];
  assert.match(withRef, /<p class="c-sub">Reference: Client 1042<\/p>/);
  const city = fixture();
  Object.assign(city.parcel.properties, { SITUS_CITY_NM: 'CHENEY', SITUS_ZIP_NR: '99004' });
  assert.match(generate({ data: city }).pages[0], /<p class="c-sub">Cheney, WA 99004<\/p>/);
});

test('without a cost estimate: five pages, no assumptions page or pointer, sources on page 5', () => {
  const data = fixture();
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  for (const f of ['acreage.js', 'property-report-v2.js']) h.run(readPublic(f));
  h.context.__acresxLast = data;
  const pages = h.generate().split('<section class="page ').slice(1);
  assert.equal(pages.length, 5);
  assert.match(pages[4], /Page 5 of 5/);
  assert.match(pages[0], /<article class="tile t-cost"><h3>Site development cost<\/h3><div class="t-num t-na">Not available<\/div>/);
  assert.match(pages[0], /<article class="tile t-acres"><h3>Buildable acres<\/h3><div class="t-num t-na">Not measured<\/div>/);
  assert.doesNotMatch(pages[3], /appendix, page/);
  assert.doesNotMatch(pages[4], /How each cost line was estimated/);
  assert.match(pages[4], /<h2>Sources<\/h2>/);
});

test('the in-page view carries the report stylesheet on the shadow host, without toolbar or script', () => {
  const h = context();
  const R = h.context.AcresXReport;
  const view = R.viewMarkup(R.renderHtml(R.buildModel('x'), { brand: null }));
  assert.match(view, /:host\{display:block;-webkit-text-size-adjust:100%;text-size-adjust:100%;--ink:#2f3437/);
  assert.match(view, /\n\.rv-doc\{margin:0;background:#eceeeb/);
  assert.doesNotMatch(view, /<div class="toolbar">|<script>/);
});

test('branding: light "Prepared by" header, agent on every footer, "Powered by AcresX", escaped', () => {
  const { pages, html } = generate({ brand: { ...JANE, name: 'Jane <b>Example</b>', logo: PNG } });
  assert.match(pages[0], /<header class="c-head branded"><div class="agent"><img class="agent-logo" src="data:image\/png;base64,[^"]+" alt="Example Realty">/);
  assert.match(pages[0], /<p class="prepared">Prepared by Jane &lt;b&gt;Example&lt;\/b&gt;, Example Realty<\/p>/);
  assert.match(pages[0], /<p class="agent-contact"><span class="ct">\(509\) 555-0100<\/span> · <span class="ct">jane@example\.com<\/span> · <span class="ct">example\.com<\/span><\/p>/);
  assert.match(html, /\.agent-contact \.ct\{display:inline-block;max-width:100%\}/, 'a contact (e.g. a license number) wraps whole, not at its hyphen');
  assert.match(pages[0], /<span class="powered">Powered by AcresX<\/span>/);
  pages.forEach((p, i) => {
    assert.match(p, /<footer class="foot branded"><span class="foot-agent"><span class="foot-line foot-who">Prepared by Jane &lt;b&gt;Example&lt;\/b&gt; · Example Realty/);
    assert.match(p, new RegExp(`Powered by AcresX · Screening only · Page ${i + 1} of 6`));
  });
  pages.slice(1).forEach(p => assert.match(p, /<header class="mini-head"><img class="agent-logo-sm"/));
});

test('shared view: a tampered snapshot cannot inject markup through class names or text', () => {
  const h = context();
  h.context.__acresxSharedReportTest = true;
  h.run(readPublic('shared-report.js'));
  const S = h.context.AcresXSharedReport, R = h.context.AcresXReport;
  const snap = JSON.parse(JSON.stringify(R.snapshot({ ...R.buildModel('x', fixture()), generatedAt: '2026-11-15T00:00:00.000Z' })));
  const evil = '"><script>alert(1)</script><x class="';
  snap.f.findings = [{ level: evil, title: '<img src=x onerror=alert(2)>', detail: 'd' }];
  snap.score.band = evil;
  snap.f.flood.cls = evil;
  snap.name = '<script>alert(3)</script>';
  const html = R.renderHtml(S.cleanModel(snap), { brand: null, date: snap.generatedAt });
  assert.equal(html.split('<section class="page ').length - 1, 6);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /<li class="verify"><i class="dot verify"><\/i>/);
  assert.match(html, /tile t-score band-na/);
  assert.match(html, /Generated November 1[45], 2026/);
});

// WCAG AA for the calm text colors: 4.5:1 on white and on the summary-tile tint.
test('palette: text tokens pass WCAG AA; no saturated filled backgrounds', () => {
  const h = context();
  const css = /<style>([\s\S]*?)<\/style>/.exec(h.context.AcresXReport.renderHtml(h.context.AcresXReport.buildModel('x'), { brand: null }))[1];
  const tokens = Object.fromEntries([...css.split(':root{')[1].split('}')[0].matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const t of ['ink', 'ink-2', 'ink-3', 'accent', 'risk', 'caution', 'good']) {
    for (const bg of ['#ffffff', tokens.tint]) assert.ok(ratio(tokens[t], bg) >= 4.5, `--${t} ${tokens[t]} on ${bg}: ${ratio(tokens[t], bg).toFixed(2)}`);
  }
  assert.ok(ratio(tokens.tint, '#ffffff') < 1.1, 'one very light neutral tint');
  for (const fill of ['#fdeceb', '#fff4de', '#e8f4ec', '#174f34', '#e5a823']) assert.ok(!css.includes(fill), `old saturated fill ${fill} not used`);
  assert.match(css, /--fs-body:10\.5pt/);
  assert.match(css, /font:400 var\(--fs-body\)\/1\.5 /);
});
