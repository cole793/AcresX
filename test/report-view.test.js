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
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'report-pdf.js', 'property-report-v2.js'];

function setup({ data = fixture(), navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, print = true, modules = MODULES } = {}) {
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
  for (const f of modules) h.run(readPublic(f), f);
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
  assert.match(shown, /:host\{display:block;-webkit-text-size-adjust:100%;text-size-adjust:100%;--g:#174f34/, 'the report colors live on the shadow host');
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

test('Print (desktop) calls window.print() straight from the tap, with Letter @page and the report title', () => {
  const s = setup();
  tapGenerate(s);
  s.$('acresxReportCreate').click();
  const pageCss = s.$('acresxReportPageCss');
  assert.ok(pageCss, '@page rule added while the report is open');
  assert.equal(pageCss.textContent, '@page{size:letter;margin:0}');
  assert.equal(s.$('acresxReportPrint').hidden, false);
  assert.equal(s.$('acresxReportPrint').textContent, 'Print');
  assert.equal(s.$('acresxReportPdf').hidden, false, 'Download PDF is the primary button');
  const actions = s.$('acresxReportActions').children.map(c => c.id);
  assert.ok(actions.indexOf('acresxReportPdf') < actions.indexOf('acresxReportPrint'), 'Download PDF comes before Print');
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
  assert.match(s.R.viewMarkup(s.R.renderHtml(s.R.buildModel('x', fixture()))), /@media print\{\.rv-doc\{background:#fff;-webkit-text-size-adjust:100%;text-size-adjust:100%\}html\{[^}]*\}\.toolbar\{display:none\}\.page\{margin:0;box-shadow:none;zoom:1!important\}\}/);
  assert.match(s.R.viewMarkup('<body></body>'), /@media print\{\.rv-doc\{padding:0\}\.page\{zoom:1!important\}\}/, 'the phone zoom is reset for printing');
});

test('iPhone: the toolbar says how to keep the PDF; a browser without window.print still has Download PDF, not a dead button', () => {
  const ios = setup({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' } });
  tapGenerate(ios); ios.$('acresxReportCreate').click();
  assert.equal(ios.$('acresxReportHint').hidden, false);
  assert.match(ios.$('acresxReportHint').textContent, /tap Download PDF, then choose Save to Files/);
  assert.equal(ios.$('acresxReportPrint').hidden, true, 'phones do not get the print button (window.print is unreliable there)');
  assert.equal(ios.$('acresxReportPdf').hidden, false);

  const desktop = setup();
  tapGenerate(desktop); desktop.$('acresxReportCreate').click();
  assert.equal(desktop.$('acresxReportHint').hidden, true);

  const noPrint = setup({ print: false });
  delete noPrint.ctx.print;
  tapGenerate(noPrint); noPrint.$('acresxReportCreate').click();
  assert.equal(noPrint.$('acresxReportPrint').hidden, true);
  assert.equal(noPrint.$('acresxReportPdf').hidden, false);
  assert.equal(noPrint.$('acresxReportHint').hidden, true);

  const neither = setup({ print: false, modules: MODULES.filter(m => m !== 'report-pdf.js') });
  delete neither.ctx.print;
  tapGenerate(neither); neither.$('acresxReportCreate').click();
  assert.equal(neither.$('acresxReportPdf').hidden, true);
  assert.match(neither.$('acresxReportHint').textContent, /Open AcresX in Safari or Chrome/);
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

test('the saved PDF is named after the report: dashboard re-renders (beta-labels.js) do not reset the title while the view is open', () => {
  const s = setup({ modules: ['beta-labels.js', ...MODULES] });
  const labelTitle = s.h.document.title;
  assert.equal(labelTitle, 'AcresX | Northwest Land Intelligence', 'beta-labels.js owns the page title');
  tapGenerate(s);
  s.$('acresxReportCreate').click();
  assert.equal(s.h.document.title, 'Parcel 23123.9051 — AcresX Property Report');
  s.ctx.AcresXBetaLabel.apply(); // what every renderSummary() runs while layers keep arriving
  assert.equal(s.h.document.title, 'Parcel 23123.9051 — AcresX Property Report');
  s.$('acresxReportPrint').click();
  assert.deepEqual(s.printed, ['Parcel 23123.9051 — AcresX Property Report']);
  s.$('acresxReportClose').click();
  assert.equal(s.h.document.title, labelTitle, 'Close hands the title back to beta-labels.js');
  s.ctx.AcresXBetaLabel.apply();
  assert.equal(s.h.document.title, labelTitle);
});

test('the Generate report button has no tap highlight, from the first tap on', () => {
  const s = setup();
  const css = s.$('acresxReportViewStyles')?.textContent || '';
  assert.match(css, /#generateReportBtn\{-webkit-tap-highlight-color:transparent\}/, 'added when the button is bound, before any tap');
  assert.equal(s.h.document.head.querySelectorAll('style').filter(n => n.id === 'acresxReportViewStyles').length, 1);
  tapGenerate(s);
  assert.equal(s.h.document.head.querySelectorAll('style').filter(n => n.id === 'acresxReportViewStyles').length, 1, 'not added twice');
});

// Owner iPhone screenshot (Safari, 2026-11-16): one page-1 paragraph rendered about 3x too large
// (iOS text autosizing on the zoomed Letter pages), page 1 was cut off mid-card (fixed Letter
// height with overflow hidden) and the branded footer wrapped to four lines.
const TSA = '-webkit-text-size-adjust:100%;text-size-adjust:100%';
test('iOS: text autosizing is off in the report, the in-page view, its shadow root and the shared page', () => {
  const s = setup();
  tapGenerate(s); s.$('acresxReportCreate').click();
  const html = s.R.renderHtml(s.R.buildModel('x', fixture()));
  assert.ok(html.includes(`*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;${TSA}}`), 'every element of the report document');
  assert.ok(html.includes(`html{${TSA}}`), 'the report document root');
  const print = html.slice(html.indexOf('@media print{'));
  assert.ok(print.includes(TSA), 'and in the print stylesheet');
  assert.match(print, /\.page\{margin:0;box-shadow:none;zoom:1!important\}/, 'print removes the phone scaling');
  const shown = s.$('acresxReportPages').shadowRoot.innerHTML;
  assert.ok(shown.includes(`:host{display:block;${TSA};`), 'the shadow host');
  assert.ok(shown.includes(`.rv-doc{padding:1px 0 24px;min-height:100%;${TSA}}`), 'the view document wrapper');
  assert.ok(s.$('acresxReportViewStyles').textContent.includes(`z-index:99995;display:none;flex-direction:column;background:rgba(13,30,20,.45);font-family:Arial,Helvetica,sans-serif;color:#17231c;${TSA}}`), 'the view root in the app page');
  assert.ok(readPublic('shared-report.html').includes(`html{${TSA}}`), '/r/<token> page before the report loads');
  assert.ok(readPublic('shared-report.js').includes(`html,body{${TSA}}`), '/r/<token> page once the report is shown');
});

test('screen view: pages are never clipped (they grow past Letter); the fixed Letter box is only for measuring and print', () => {
  const s = setup();
  tapGenerate(s); s.$('acresxReportCreate').click();
  const shown = s.$('acresxReportPages').shadowRoot.innerHTML;
  assert.ok(shown.includes('@media screen{.page{height:auto;min-height:11in;overflow:visible}.page-body{flex:1 0 auto;overflow:visible}}'), 'screen: no overflow hidden, height grows');
  assert.ok(shown.includes('.page.fit-measure{height:11in!important;min-height:0!important;overflow:hidden!important}'), 'the fit is measured in the Letter box');
  assert.match(shown, /\.page\{width:8\.5in;height:11in;[^}]*overflow:hidden\}/, 'print keeps the fixed Letter page');
  const screenAt = shown.indexOf('@media screen{.page{'), printAt = shown.indexOf('@media print{');
  assert.ok(screenAt > 0 && screenAt < printAt, 'the screen rule is media-scoped, so print is unchanged');
  // The view, the report document and the shared page add the measuring class only while measuring.
  assert.match(readPublic('property-report-v2.js'), /function fitNodes\(nodes\) \{[\s\S]*?p\.classList\.add\('fit-measure'\);[\s\S]*?p\.classList\.remove\('fit-measure'\);/);
  assert.match(s.R.renderHtml(s.R.buildModel('x', fixture())), /p\.classList\.add\('fit-measure'\)[\s\S]*p\.classList\.remove\('fit-measure'\)/);
  assert.match(readPublic('shared-report.js'), /p\.classList\.add\('fit-measure'\)[\s\S]*p\.classList\.remove\('fit-measure'\)/);
});

test('branded footer: two lines at most (name · brokerage, then contacts), each cut with an ellipsis', () => {
  const s = setup();
  const brand = { name: 'Alexandra Montgomery-Whitfield', brokerage: 'Tightline Property Brokers', preparedBy: 'Alexandra Montgomery-Whitfield, Tightline Property Brokers', contact: [], footerContact: ['(406) 555-0199', 'alexandra.montgomery-whitfield@tightlinepropertybrokers.com', 'tightlinepropertybrokers-billings-montana.com/agents/alexandra'], logo: '' };
  const html = s.R.renderHtml(s.R.buildModel('x', fixture()), { brand });
  const feet = html.match(/<footer class="foot branded">[\s\S]*?<\/footer>/g);
  assert.equal(feet.length, 4);
  for (const f of feet) {
    assert.equal((f.match(/class="foot-line /g) || []).length, 2, 'two lines');
    assert.match(f, /<span class="foot-line foot-who">Prepared by Alexandra Montgomery-Whitfield · Tightline Property Brokers<\/span>/);
    assert.match(f, /<span class="foot-line foot-contact">\(406\) 555-0199 · alexandra\.montgomery-whitfield@tightlinepropertybrokers\.com · tightlinepropertybrokers-billings-montana\.com\/agents\/alexandra<\/span>/);
  }
  assert.ok(html.includes('.foot-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'), 'each line stays one line');
  assert.match(html, /\.foot\.branded\{[^}]*font-size:6\.6pt/, 'smaller footer type');
  assert.match(html, /\.foot-right\{flex:none;text-align:right;white-space:nowrap\}/);
});
