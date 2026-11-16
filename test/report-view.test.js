// Offline tests for the in-page report view (public/property-report-v2.js, owner bug 2026-11-15:
// "I can't save/print reports on mobile"). Generate report used to call window.prompt() and then
// window.open(); in iPhone in-app browsers both return null at once, so the tap did nothing.
// The report now opens in a full-screen view on the page with an inline reference field and a
// toolbar (Save as PDF / Print, Share, Close). Runs in the structured fake DOM from
// test/ui-harness.js; window.prompt and window.open throw, so any use of them fails the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { El, makeClock, makeContext, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js'];

function setup({ data = fixture(), navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, print = true } = {}) {
  const clock = makeClock();
  const printed = [], shared = [], saved = [];
  const h = makeContext({
    clock,
    body: [['div', { class: 'workspace' }, '', [['header', { class: 'topbar' }, '', [['div', { class: 'top-actions' }, '', [['button', { class: 'ghost' }, 'Save property'], ['button', { id: 'generateReportBtn', class: 'primary' }, 'Generate report']]]]], ['main', {}, '']]]],
    extra: {
      navigator,
      prompt: () => { throw new Error('window.prompt must not be used'); },
      open: () => { throw new Error('window.open must not be used for the report'); },
      alert: () => { throw new Error('alert() is suppressed in in-app browsers; use the view'); },
      addEventListener() {}, innerWidth: 390,
      turf: { area: () => 20.63 * 4046.8564224, centroid: () => ({ geometry: { coordinates: [-117.4, 47.5] } }) },
      AcresXAccounts: { reportGenerated: (model, snapshotOf) => saved.push({ name: model.name, snap: snapshotOf(model) }) }
    }
  });
  if (print) h.ctx.print = () => printed.push(h.ctx.document.title);
  h.document.documentElement = new El('html', h.document);
  h.document.title = 'AcresX | Washington Land Intelligence';
  h.ctx.__acresxLast = data;
  for (const f of MODULES) h.run(readPublic(f), f);
  if (navigator.share === true) h.ctx.navigator.share = arg => { shared.push(arg); return Promise.resolve(); };
  const $ = id => h.document.getElementById(id);
  return { h, ctx: h.ctx, $, printed, shared, saved, clock, R: h.ctx.AcresXReport };
}
const tapGenerate = s => s.$('generateReportBtn').click();
const pagesOf = html => html.split('<body>')[1].split('<script>')[0].replace(/^<div class="toolbar">[\s\S]*?<\/div>\n?/, '');

test('Generate report opens the in-page view inside the tap: no prompt, no popup, nothing awaited first', () => {
  const s = setup();
  tapGenerate(s); // the stubs throw on prompt/open/alert; no clock advance or microtask flush here
  const view = s.$('acresxReportView');
  assert.ok(view, 'the view exists as soon as the tap handler returns');
  assert.ok(view.classList.contains('open'));
  assert.ok(s.h.document.documentElement.classList.contains('arv-open'));
  assert.equal(s.$('acresxReportAsk').hidden, false, 'the inline reference field is shown');
  assert.equal(s.$('acresxReportName').value, 'Parcel 23123.9051', 'prefilled with what the prompt suggested');
  assert.equal(s.$('acresxReportActions').hidden, true);
  assert.equal(s.$('acresxReportPages').shadowRoot.innerHTML, '', 'no report until Create report');
  assert.equal(s.saved.length, 0);
});

test('Create report shows exactly the report renderHtml builds (same pages), without its popup toolbar or script', () => {
  const s = setup();
  tapGenerate(s);
  s.$('acresxReportName').value = '  Smith parcel ';
  s.$('acresxReportCreate').click();
  const shown = s.$('acresxReportPages').shadowRoot.innerHTML;
  const model = s.R.buildModel('Smith parcel', fixture());
  const expected = s.R.renderHtml(model);
  assert.equal(shown, s.R.viewMarkup(expected));
  assert.ok(shown.endsWith(`<div class="rv-doc">${pagesOf(expected)}</div>`), 'the page markup is renderHtml\'s, unchanged');
  assert.equal((shown.match(/<section class="page /g) || []).length, 4);
  assert.match(shown, /<div><span>Reference<\/span><strong>Smith parcel<\/strong>/);
  assert.doesNotMatch(shown, /<script|class="toolbar"|onclick=/);
  assert.match(shown, /print-color-adjust:exact/);
  assert.match(shown, /\.page\{width:8\.5in;height:11in;/);
  assert.match(shown, /:host\{display:block;--g:#174f34/, 'the report colors live on the shadow host');
  assert.match(shown, /\.rv-doc\{margin:0;background:#e6ece8/);
  assert.doesNotMatch(shown, /(^|[}\n])body\{|:root\{|@page/, 'no document-level selectors inside the shadow root');
  assert.equal(s.$('acresxReportAsk').hidden, true);
  assert.equal(s.$('acresxReportActions').hidden, false);
  assert.equal(s.saved.length, 1, 'saved to the account once, as before');
  assert.equal(s.saved[0].name, 'Smith parcel');
  assert.equal(s.saved[0].snap.name, 'Smith parcel');
});

test('an empty reference keeps the suggested one; Enter in the field creates the report', () => {
  const s = setup();
  tapGenerate(s);
  s.$('acresxReportName').value = '';
  for (const fn of s.$('acresxReportName').listeners.keydown) fn({ key: 'Enter', preventDefault() {} });
  const shown = s.$('acresxReportPages').shadowRoot.innerHTML;
  assert.equal((shown.match(/<section class="page /g) || []).length, 4);
  assert.doesNotMatch(shown, /<span>Reference<\/span>/, 'the suggested name is the parcel itself, so no separate reference line (as before)');
  assert.equal(s.saved[0].name, 'Parcel 23123.9051');
});

test('Cancel closes the view without building or saving a report', () => {
  const s = setup();
  tapGenerate(s);
  s.$('acresxReportCancel').click();
  assert.ok(!s.$('acresxReportView').classList.contains('open'));
  assert.ok(!s.h.document.documentElement.classList.contains('arv-open'));
  assert.equal(s.saved.length, 0);
  s.$('acresxReportCreate').click(); // a stale tap after cancel does nothing
  assert.equal(s.saved.length, 0);
});

test('Save as PDF / Print calls window.print() straight from the tap, with Letter @page and the report title', () => {
  const s = setup();
  tapGenerate(s);
  s.$('acresxReportCreate').click();
  const pageCss = s.$('acresxReportPageCss');
  assert.ok(pageCss, '@page rule added while the report is open');
  assert.equal(pageCss.textContent, '@page{size:letter;margin:0}');
  assert.equal(s.$('acresxReportPrint').hidden, false);
  assert.equal(s.$('acresxReportPrint').textContent, 'Save as PDF / Print');
  s.$('acresxReportPrint').click();
  assert.deepEqual(s.printed, ['Parcel 23123.9051 — AcresX Property Report'], 'printed synchronously, titled for the PDF file name');
  s.$('acresxReportClose').click();
  assert.ok(!s.$('acresxReportView').classList.contains('open'));
  assert.equal(s.$('acresxReportPageCss'), null, '@page rule removed with the view');
  assert.equal(s.h.document.title, 'AcresX | Washington Land Intelligence', 'page title restored');
  assert.equal(s.$('acresxReportPages').shadowRoot.innerHTML, '');
});

test('print CSS hides the app and the toolbar and prints only the report', () => {
  const s = setup();
  tapGenerate(s);
  const css = s.$('acresxReportViewStyles').textContent;
  const print = css.slice(css.indexOf('@media print{'));
  assert.match(print, /html\.arv-open body>\*:not\(#acresxReportView\)\{display:none!important\}/);
  assert.match(print, /#acresxReportView \.arv-bar,#acresxReportView \.arv-status\{display:none!important\}/);
  assert.match(print, /#acresxReportView\.open\{position:static!important/);
  assert.match(print, /html\.arv-open,html\.arv-open body\{overflow:visible!important;height:auto!important/, 'the scroll lock does not cut the print to one page');
  assert.match(print, /#acresxReportView \.arv-pages\{overflow:visible!important/);
  assert.match(s.R.viewMarkup(s.R.renderHtml(s.R.buildModel('x', fixture()))), /@media print\{\.rv-doc\{background:#fff\}\.toolbar\{display:none\}\.page\{margin:0;box-shadow:none\}\}/);
  assert.match(s.R.viewMarkup('<body></body>'), /@media print\{\.rv-doc\{padding:0\}\.page\{zoom:1!important\}\}/, 'the phone zoom is reset for printing');
});

test('iPhone: the toolbar says how to keep the PDF; a browser without window.print gets a pointer instead of a dead button', () => {
  const ios = setup({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' } });
  tapGenerate(ios); ios.$('acresxReportCreate').click();
  assert.equal(ios.$('acresxReportHint').hidden, false);
  assert.match(ios.$('acresxReportHint').textContent, /tap Save as PDF \/ Print, then use Share → Save to Files/);

  const desktop = setup();
  tapGenerate(desktop); desktop.$('acresxReportCreate').click();
  assert.equal(desktop.$('acresxReportHint').hidden, true);

  const noPrint = setup({ print: false });
  delete noPrint.ctx.print;
  tapGenerate(noPrint); noPrint.$('acresxReportCreate').click();
  assert.equal(noPrint.$('acresxReportPrint').hidden, true);
  assert.match(noPrint.$('acresxReportHint').textContent, /Open AcresX in Safari or Chrome/);
});

test('Share appears only with a share link and navigator.share, and shares that link', () => {
  const s = setup({ navigator: { userAgent: 'x', share: true } });
  tapGenerate(s); s.$('acresxReportCreate').click();
  assert.equal(s.$('acresxReportShare').hidden, true, 'a freshly generated report has no link to share');
  s.R.openReport(s.R.renderHtml(s.R.buildModel('Smith', fixture())), { shareUrl: 'https://acresx.test/r/abc' });
  assert.equal(s.$('acresxReportShare').hidden, false);
  s.$('acresxReportShare').click();
  assert.deepEqual(JSON.parse(JSON.stringify(s.shared)), [{ title: 'Parcel 23123.9051 — AcresX Property Report', url: 'https://acresx.test/r/abc' }]);

  const noApi = setup();
  noApi.R.openReport(noApi.R.renderHtml(noApi.R.buildModel('Smith', fixture())), { shareUrl: 'https://acresx.test/r/abc' });
  assert.equal(noApi.$('acresxReportShare').hidden, true);
});

test('no property analyzed: the view says so (no alert, which in-app browsers swallow)', () => {
  const s = setup({ data: null });
  tapGenerate(s);
  assert.ok(s.$('acresxReportView').classList.contains('open'));
  assert.equal(s.$('acresxReportStatus').hidden, false);
  assert.match(s.$('acresxReportStatus').textContent, /Analyze a property first/);
  assert.equal(s.$('acresxReportPrint').hidden, true);
  s.$('acresxReportClose').click();
  assert.ok(!s.$('acresxReportView').classList.contains('open'));
});

test('saved reports: showLoading opens the view at once; a report that arrives after Close stays closed', () => {
  const s = setup();
  const html = s.R.renderHtml(s.R.buildModel('Saved', fixture()));
  const ticket = s.R.showLoading('Loading report…');
  assert.ok(s.$('acresxReportView').classList.contains('open'));
  assert.equal(s.$('acresxReportStatus').textContent, 'Loading report…');
  assert.equal(s.R.openReport(html, { ticket }), true);
  assert.match(s.$('acresxReportPages').shadowRoot.innerHTML, /<strong>Saved<\/strong>/);

  const late = s.R.showLoading();
  s.$('acresxReportClose').click();
  assert.equal(s.R.openReport(html, { ticket: late }), false);
  assert.ok(!s.$('acresxReportView').classList.contains('open'));
  // closeReport(ticket) leaves a newer view alone.
  const t1 = s.R.showLoading();
  tapGenerate(s);
  s.R.closeReport(t1);
  assert.ok(s.$('acresxReportView').classList.contains('open'));
});
