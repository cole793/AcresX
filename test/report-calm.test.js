// Offline tests for the calm report look (public/property-report-v2.js, concept 2026-11-17:
// realtors found page 1 overwhelming). The calm look keeps every fact of the classic report and
// spreads it over six Letter pages: summary, site details, zoning & records, costs & next steps,
// cost assumptions (when the cost lines carry them) and sources. The classic look is still covered by the other report tests (the harness
// renders classic unless REPORT_THEME=calm).
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

// theme: what window.AcresXReportTheme holds (undefined: the module default). search: the page URL query.
function context({ data = fixture(), theme = 'calm', search = '', brand } = {}) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.URL = URL;
  h.context.URLSearchParams = URLSearchParams;
  h.context.AcresXReportTheme = theme;
  h.context.location = { pathname: '/', search, hash: '' };
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

test('calm: six Letter pages, "Page N of 6" on every page, calm stylesheet', () => {
  const { pages, h } = generate({ data: withBuildable() });
  const html = h.context.AcresXReport.renderHtml(h.context.AcresXReport.buildModel('x'), { brand: null });
  assert.equal(pages.length, 6);
  pages.forEach((p, i) => {
    assert.match(p, new RegExp(`^calm p${i + 1}"`));
    assert.match(p, new RegExp(`<span>Page ${i + 1} of 6</span></footer>`));
  });
  assert.match(html, /<meta name="acresx-report-theme" content="calm">/);
  assert.match(html, /@page\{size:letter;margin:0\}/);
  assert.match(html, /break-after:page/);
  assert.match(html, /text-size-adjust:100%/, 'iOS text autosizing stays off');
  assert.match(html, /window\.__acresxFit=fit/, 'the page-fit step still runs');
  assert.deepEqual(pages.map(p => (/<div class="eyebrow">([^<]+)<\/div>/.exec(p) || [])[1] || 'summary'), ['summary', 'Site details', 'Zoning &amp; records', 'Costs &amp; next steps', 'Cost assumptions', 'Sources']);
});

test('calm page 1: header, address line, map, three tiles, at most 5 findings, disclaimer; details moved off', () => {
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
  // Cost tile: range and midpoint.
  assert.match(p1, /<div class="t-num t-range">\$[\d,]+–\$[\d,]+<\/div><p class="t-label">Midpoint about \$\d+k<\/p>/);
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

test('calm: the same facts as classic (score, cost lines and total, site conditions, zoning, checklist, sources)', () => {
  const calm = generate({ data: withBuildable() });
  const classic = generate({ data: withBuildable(), theme: 'classic' });
  assert.equal(classic.pages.length, 4);
  // Cost: page 1 tile = page 4 total = classic page 1 = sum of the lines.
  const tile = /<div class="t-num t-range">([^<]+)<\/div>/.exec(calm.pages[0])[1];
  const total = /Total \(matches page 1\)<\/td><td class="amt">([^<]+)<\/td>/.exec(calm.pages[3])[1];
  assert.equal(tile, total);
  assert.equal(tile, /<div class="cost-num">([^<]+)<\/div>/.exec(classic.pages[0])[1]);
  const lines = [...calm.pages[3].split('<tfoot>')[0].matchAll(/<td class="amt">([^<]+)<\/td><\/tr>/g)].map(m => amounts(m[1]));
  assert.deepEqual(lines.reduce((s, [lo, hi]) => [s[0] + lo, s[1] + hi], [0, 0]), amounts(total));
  assert.match(calm.pages[3], /The total is the sum of \d lines: well, septic/);
  // Site conditions (page 2) and zoning (page 3) carry the same cards and blocks as classic.
  const titles = p => [...p.matchAll(/<article class="site"><div class="site-top"><h3>([^<]+)/g)].map(m => m[1]);
  assert.deepEqual(titles(calm.pages[1]), titles(classic.pages[1]));
  assert.ok(titles(calm.pages[1]).length >= 7);
  for (const bit of ['<div class="zone-code">', '<table class="uses">', '<ul class="overlays">', '<div class="assessor">']) {
    assert.ok(calm.pages[2].includes(bit), bit);
    assert.ok(classic.pages[1].includes(bit), bit);
  }
  assert.equal((calm.pages[3].match(/<li><p><strong>/g) || []).length, (classic.pages[2].match(/<li><p><strong>/g) || []).length, 'same checklist');
  // Sources: same list (numbering follows the page order), and every bracketed number is listed.
  const sources = html => [...html.split('<ol class="sources">')[1].split('</ol>')[0].matchAll(/<li value="\d+">([^<]+)/g)].map(m => m[1]).sort();
  assert.deepEqual(sources(calm.html), sources(classic.html));
  const count = sources(calm.html).length;
  for (const [, sup] of calm.html.matchAll(/<sup class="ref">\[([^\]]+)\]<\/sup>/g)) for (const n of sup.match(/\d+/g)) assert.ok(Number(n) <= count);
  // Page 5: the cost assumptions with their pointer; page 6: sources and the limits text.
  assert.match(calm.pages[3], /How each line was estimated: appendix, page 5\./);
  assert.match(calm.pages[4], /How each cost line was estimated/);
  assert.match(calm.pages[4], /<ol class="notes"><li><strong>/);
  assert.match(calm.pages[4], /sources on page 6\./);
  assert.match(calm.pages[5], /<ol class="sources">/);
  assert.match(calm.pages[5], /Preliminary screening only\.<\/strong> AcresX compiles public records/);
  // Plain text of the classic report is all present in the calm one (wording of moved bits aside).
  const words = s => new Set(text(s).toLowerCase().match(/[a-z]{5,}/g));
  const calmWords = words(calm.html);
  const missing = [...words(classic.html)].filter(w => !calmWords.has(w));
  assert.ok(missing.length <= 12, `classic words missing from calm: ${missing.join(', ')}`);
});

test('calm without a cost estimate: five pages, no assumptions page or pointer, sources on page 5', () => {
  const data = fixture();
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: data });
  h.context.AcresXReportTheme = 'calm';
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

test('theme flag: renderHtml option, then ?reportTheme=, then window.AcresXReportTheme, then calm', () => {
  const h = context({ theme: undefined });
  const R = h.context.AcresXReport;
  const model = R.buildModel('x');
  const pagesOf = html => html.split('<section class="page ').length - 1;
  assert.equal(R.reportTheme(), 'calm', 'calm by default on this branch');
  assert.equal(pagesOf(R.renderHtml(model, { brand: null })), 6);
  assert.equal(pagesOf(R.renderHtml(model, { brand: null, theme: 'classic' })), 4);
  h.context.AcresXReportTheme = 'classic';
  assert.equal(R.reportTheme(), 'classic');
  h.context.location.search = '?reportTheme=calm';
  assert.equal(R.reportTheme(), 'calm', 'the URL beats the global');
  h.context.location.search = '?reportTheme=<x>';
  assert.equal(R.reportTheme(), 'classic', 'unknown values are ignored');
  assert.equal(R.reportTheme('nope'), 'classic');
  // The in-page view uses the stylesheet of the look it shows.
  const calmView = R.viewMarkup(R.renderHtml(model, { brand: null, theme: 'calm' }));
  const classicView = R.viewMarkup(R.renderHtml(model, { brand: null, theme: 'classic' }));
  assert.match(calmView, /:host\{display:block;-webkit-text-size-adjust:100%;text-size-adjust:100%;--ink:#2f3437/);
  assert.match(calmView, /\n\.rv-doc\{margin:0;background:#eceeeb/);
  assert.doesNotMatch(calmView, /<div class="toolbar">|<script>/);
  assert.match(classicView, /--g:#174f34/);
});

test('calm with branding: light "Prepared by" header, agent on every footer, "Powered by AcresX", escaped', () => {
  const { pages } = generate({ brand: { ...JANE, name: 'Jane <b>Example</b>', logo: PNG } });
  assert.match(pages[0], /<header class="c-head branded"><div class="agent"><img class="agent-logo" src="data:image\/png;base64,[^"]+" alt="Example Realty">/);
  assert.match(pages[0], /<p class="prepared">Prepared by Jane &lt;b&gt;Example&lt;\/b&gt;, Example Realty<\/p>/);
  assert.match(pages[0], /<p class="agent-contact">\(509\) 555-0100 · jane@example\.com · example\.com<\/p>/);
  assert.match(pages[0], /<span class="powered">Powered by AcresX<\/span>/);
  pages.forEach((p, i) => {
    assert.match(p, /<footer class="foot branded"><span class="foot-agent"><span class="foot-line foot-who">Prepared by Jane &lt;b&gt;Example&lt;\/b&gt; · Example Realty/);
    assert.match(p, new RegExp(`Powered by AcresX · Screening only · Page ${i + 1} of 6`));
  });
  pages.slice(1).forEach(p => assert.match(p, /<header class="mini-head"><img class="agent-logo-sm"/));
});

test('calm shared view: a tampered snapshot cannot inject markup through class names or text', () => {
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
test('calm palette: text tokens pass WCAG AA; no saturated filled backgrounds', () => {
  const h = context();
  const css = /<style>([\s\S]*?)<\/style>/.exec(h.context.AcresXReport.renderHtml(h.context.AcresXReport.buildModel('x'), { brand: null }))[1];
  const tokens = Object.fromEntries([...css.split(':root{')[1].split('}')[0].matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const t of ['ink', 'ink-2', 'ink-3', 'accent', 'risk', 'caution', 'good']) {
    for (const bg of ['#ffffff', tokens.tint]) assert.ok(ratio(tokens[t], bg) >= 4.5, `--${t} ${tokens[t]} on ${bg}: ${ratio(tokens[t], bg).toFixed(2)}`);
  }
  assert.ok(ratio(tokens.tint, '#ffffff') < 1.1, 'one very light neutral tint');
  for (const fill of ['#fdeceb', '#fff4de', '#e8f4ec', '#174f34', '#e5a823']) assert.ok(!css.includes(fill), `classic fill ${fill} not used`);
  assert.match(css, /--fs-body:10\.5pt/);
  assert.match(css, /font:400 var\(--fs-body\)\/1\.5 /);
});
