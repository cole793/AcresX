// Offline tests for deep links and the iPhone Home Screen app (public/deep-link.js with the report
// view in public/property-report-v2.js; owner finding 2026-11-16, real iPhone: Download PDF does
// nothing when AcresX is opened from a Home Screen bookmark). Runs in the fake DOM from
// test/ui-harness.js; the search itself is a stub that answers the way progressive-loading.js does
// (window.__acresxLast replaced, window.AcresXSections settling later).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { El, makeClock, makeContext, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'report-pdf.js', 'property-report-v2.js', 'deep-link.js'];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64)';
const ORIGIN = 'https://acresx.example.workers.dev';
const COUNTIES = {
  WA: ['Spokane', 'Stevens', 'Pend Oreille'],
  ID: ['Kootenai', 'Bonner'],
  MT: ['Gallatin', 'Yellowstone', 'Lewis and Clark']
};
const counties = s => COUNTIES[s] || [];

// A page with the search form (state, county, parcel), the report button, and the modules.
// search: what the stubbed search does on submit ('found' | 'not-found' | 'never').
function setup({ ua = DESKTOP, standalone, media = [], search = '', onSubmit = 'found', settleAfter = 3000, clipboard, signedIn = false, modules = MODULES } = {}) {
  const clock = makeClock();
  const log = { submits: 0, replaced: [], saved: [], copied: [] };
  const navigator = { userAgent: ua };
  if (standalone !== undefined) navigator.standalone = standalone;
  if (clipboard) navigator.clipboard = { writeText: url => { log.copied.push(url); return clipboard(url); } };
  const h = makeContext({
    clock,
    body: [
      ['form', { id: 'searchForm' }, '', [['select', { id: 'state' }], ['select', { id: 'county' }], ['input', { id: 'parcel' }], ['button', { id: 'searchBtn' }, 'Analyze property']]],
      ['div', { id: 'status', class: 'status' }],
      ['div', { class: 'workspace' }, '', [['header', { class: 'topbar' }, '', [['div', { class: 'top-actions' }, '', [['button', { class: 'ghost' }, 'Save property'], ['button', { id: 'generateReportBtn', class: 'primary' }, 'Generate report']]]]], ['main', {}, '']]]
    ],
    extra: {
      navigator, URLSearchParams, File, Blob,
      location: { origin: ORIGIN, pathname: '/', search, hash: '' },
      history: { state: null, replaceState: (st, title, url) => log.replaced.push(url) },
      matchMedia: q => ({ matches: media.some(m => q === `(display-mode: ${m})`) }),
      prompt: () => { throw new Error('window.prompt must not be used'); },
      open: () => { throw new Error('window.open must not be used for the report'); },
      addEventListener() {}, innerWidth: 390,
      turf: { area: () => 20.63 * 4046.8564224, centroid: () => ({ geometry: { coordinates: [-117.4, 47.5] } }) },
      AcresXStateSelector: { counties },
      AcresXAccounts: { state: { signedIn }, reportGenerated: model => log.saved.push(model.name) }
    }
  });
  const { ctx, document } = h;
  document.documentElement = new El('html', document);
  document.title = 'AcresX';
  const $ = id => document.getElementById(id);
  // The search: progressive-loading.js replaces window.__acresxLast once the parcel is found and
  // settles the sections later.
  let settled = true;
  ctx.AcresXSections = { allSettled: () => settled, ready: () => settled, placeholder: () => null, claim: () => false, settle() {}, isCurrent: () => true, waitingFor: () => [], timedOut: () => [] };
  $('searchForm').requestSubmit = () => {
    log.submits++;
    for (const fn of $('searchForm').listeners.submit || []) fn({ preventDefault() {} });
    $('status').className = 'status show';
    if (onSubmit === 'found') {
      settled = false;
      clock.setTimeout(() => { ctx.__acresxLast = fixture(); }, 800);
      clock.setTimeout(() => { settled = true; }, 800 + settleAfter);
    } else if (onSubmit === 'not-found') {
      clock.setTimeout(() => { $('status').className = 'status show error'; }, 800);
    }
  };
  for (const f of modules) h.run(readPublic(f), f);
  const fill = (state, county, parcel) => { $('state').value = state; $('county').value = county; $('parcel').value = parcel; };
  return { h, ctx, $, log, clock, fill, D: ctx.AcresXDeepLink, R: ctx.AcresXReport };
}
const viewOpen = s => Boolean(s.$('acresxReportView')?.classList.contains('open'));
const reportShown = s => s.$('acresxReportPages')?.shadowRoot?.innerHTML || '';

// ---- Standalone detection

test('isStandalone: navigator.standalone, or display-mode standalone / fullscreen / minimal-ui', () => {
  assert.equal(setup({ standalone: true }).D.isStandalone(), true, 'iOS Home Screen app');
  for (const m of ['standalone', 'fullscreen', 'minimal-ui']) assert.equal(setup({ media: [m] }).D.isStandalone(), true, m);
  assert.equal(setup().D.isStandalone(), false, 'a browser tab');
  assert.equal(setup({ standalone: false, media: ['browser'] }).D.isStandalone(), false);
  const s = setup();
  s.ctx.matchMedia = () => { throw new Error('no matchMedia'); };
  assert.equal(s.D.isStandalone(), false, 'a throwing matchMedia is a browser tab');
  delete s.ctx.matchMedia;
  assert.equal(s.D.isStandalone(), false);
});

test('needsBrowser: only a standalone app on iPhone/iPad (Android and desktop installed apps can save files)', () => {
  assert.equal(setup({ ua: IPHONE, standalone: true }).D.needsBrowser(), true);
  assert.equal(setup({ ua: IPHONE, media: ['standalone'] }).D.needsBrowser(), true);
  assert.equal(setup({ ua: IPHONE }).D.needsBrowser(), false, 'Safari / Chrome tab on iPhone');
  assert.equal(setup({ ua: ANDROID, media: ['standalone'] }).D.needsBrowser(), false);
  assert.equal(setup({ ua: DESKTOP, media: ['standalone'] }).D.needsBrowser(), false);
});

// ---- Parsing

test('parse: a valid link gives the canonical state, county, parcel, report and ref', () => {
  const { D } = setup();
  assert.deepEqual({ ...D.parse('?state=MT&county=Yellowstone&parcel=03092732390050000&report=1&ref=Smith%20parcel', { counties }) },
    { state: 'MT', county: 'Yellowstone', parcel: '03092732390050000', report: true, ref: 'Smith parcel' });
  assert.deepEqual({ ...D.parse('state=wa&county=spokane+county&parcel=23123.9051', { counties }) },
    { state: 'WA', county: 'Spokane', parcel: '23123.9051', report: false, ref: '' }, 'case and a "County" suffix are accepted');
  assert.equal(D.parse('?state=MT&county=lewis%20and%20clark&parcel=03-0927-32-3-90-05-0000', { counties }).county, 'Lewis and Clark');
  assert.equal(D.parse('?state=ID&county=Kootenai&parcel=C72150030040&report=0', { counties }).report, false);
  assert.equal(D.parse('?state=WA&county=Spokane&parcel=23123.9051&utm_source=x&signedIn=1', { counties }).parcel, '23123.9051', 'other parameters are ignored');
  // Default lists come from state-selector.js (window.AcresXStateSelector).
  assert.equal(D.parse('?state=MT&county=Gallatin&parcel=06079815101030000').county, 'Gallatin');
});

test('parse: rejects bad states, counties, parcels, report values and repeated parameters', () => {
  const { D } = setup();
  const bad = [
    '', '?parcel=23123.9051',
    '?state=OR&county=Spokane&parcel=1', '?state=&county=Spokane&parcel=1', '?state=WAX&county=Spokane&parcel=1',
    '?state=WA&parcel=23123.9051', '?state=MT&county=Kootenai&parcel=1', '?state=WA&county=Nowhere&parcel=1', '?state=WA&county=Spo&parcel=1',
    '?state=WA&county=Spokane', '?state=WA&county=Spokane&parcel=', '?state=WA&county=Spokane&parcel=%3Cscript%3E',
    '?state=WA&county=Spokane&parcel=12%2F34', '?state=WA&county=Spokane&parcel=-123', '?state=WA&county=Spokane&parcel=123.',
    `?state=WA&county=Spokane&parcel=${'1'.repeat(41)}`, '?state=WA&county=Spokane&parcel=12%0A34', '?state=WA&county=Spokane&parcel=javascript:1',
    '?state=WA&county=Spokane&parcel=1&report=yes', '?state=WA&county=Spokane&parcel=1&report=true',
    '?state=WA&state=MT&county=Spokane&parcel=1', '?state=WA&county=Spokane&county=Stevens&parcel=1', '?state=WA&county=Spokane&parcel=1&parcel=2',
    '?state=WA&county=Spokane&parcel=1&report=1&ref=a&ref=b', `?state=WA&county=Spokane&parcel=1&report=1&ref=${'x'.repeat(481)}`
  ];
  for (const q of bad) assert.equal(D.parse(q, { counties }), null, q);
  assert.equal(D.parse('?state=WA&county=Spokane&parcel=1', { counties: () => [] }), null, 'no county list: nothing runs');
});

test('parse: ref is capped at 120 characters and stripped of control characters; markup stays text', () => {
  const { D } = setup();
  const q = r => `?state=WA&county=Spokane&parcel=23123.9051&report=1&ref=${encodeURIComponent(r)}`;
  assert.equal(D.parse(q('x'.repeat(300)), { counties }).ref.length, 120);
  assert.equal(D.parse(q('  Smith\u0000\u0007 ‮parcel\n2 '), { counties }).ref, 'Smith parcel 2');
  assert.equal(D.parse(q('<img src=x onerror=alert(1)>'), { counties }).ref, '<img src=x onerror=alert(1)>', 'kept as text; the report escapes it');
});

test('link: builds the deep link, and parse(link(x)) gives x back', () => {
  const { D } = setup();
  const x = { state: 'MT', county: 'Lewis and Clark', parcel: '03092732390050000', report: true, ref: 'Smith & Co #1 / 50%' };
  const url = D.link(x);
  assert.match(url, /^\/\?state=MT&county=Lewis\+and\+Clark&parcel=03092732390050000&report=1&ref=/);
  assert.deepEqual({ ...D.parse(url.slice(1), { counties }) }, x);
  assert.equal(D.link({ state: 'WA', county: 'Spokane', parcel: '1', ref: 'ignored' }), '/?state=WA&county=Spokane&parcel=1', 'no report: no ref');
});

// ---- Running a link

test('a report link selects state and county, fills the parcel, runs the search once, and opens the report when loading settles', async () => {
  const s = setup({ search: '?state=WA&county=Spokane&parcel=23123.9051&report=1&ref=Smith%20parcel' });
  assert.equal(s.log.submits, 0, 'nothing runs before DOMContentLoaded handlers finish');
  await s.clock.advance(1);
  assert.equal(s.$('state').value, 'WA');
  assert.equal(s.$('county').value, 'Spokane');
  assert.equal(s.$('parcel').value, '23123.9051');
  assert.equal(s.log.submits, 1, 'the normal search flow (form submit), once');
  assert.deepEqual(s.log.replaced, ['/?state=WA&county=Spokane&parcel=23123.9051'], 'the address bar shows the search');
  await s.clock.advance(2000);
  assert.equal(viewOpen(s), false, 'parcel found but sections still loading: wait');
  await s.clock.advance(3000);
  assert.equal(viewOpen(s), true, 'opened once the sections settled');
  assert.equal(s.$('acresxReportAsk').hidden, true);
  assert.match(reportShown(s), /<div><span>Reference<\/span><strong>Smith parcel<\/strong>/);
  assert.equal(s.$('acresxReportPdf').textContent, 'Preparing PDF…', 'the PDF starts building');
  assert.deepEqual(s.log.saved, [], 'not saved to the account again');
  assert.equal(s.log.submits, 1, 'nothing else runs');
});

test('a link without report=1 runs the search and does not open the report', async () => {
  const s = setup({ search: '?state=WA&county=Spokane&parcel=23123.9051' });
  await s.clock.advance(20000);
  assert.equal(s.log.submits, 1);
  assert.equal(viewOpen(s), false);
});

test('a report link with no ref opens the report with the suggested name, as Generate report does', async () => {
  const s = setup({ search: '?state=WA&county=Spokane&parcel=23123.9051&report=1' });
  await s.clock.advance(10000);
  assert.equal(viewOpen(s), true);
  assert.match(reportShown(s), /<section class="page /);
  assert.doesNotMatch(reportShown(s), /<span>Reference<\/span>/, 'the suggested name is not printed as a reference (as with Generate report)');
});

test('the report opens after 90 s even if a section never settles', async () => {
  const s = setup({ search: '?state=WA&county=Spokane&parcel=23123.9051&report=1&ref=A', settleAfter: 10 * 60000 });
  await s.clock.advance(60000);
  assert.equal(viewOpen(s), false);
  await s.clock.advance(31000);
  assert.equal(viewOpen(s), true);
});

test('bad links run nothing', async () => {
  for (const q of ['?state=OR&county=Spokane&parcel=1&report=1', '?state=WA&county=Spokane&parcel=%3Cb%3E&report=1', '?state=WA&state=WA&county=Spokane&parcel=1', '?report=1']) {
    const s = setup({ search: q });
    await s.clock.advance(20000);
    assert.equal(s.log.submits, 0, q);
    assert.equal(s.$('parcel').value, '', q);
    assert.equal(viewOpen(s), false, q);
  }
});

test('parcel not found: no report; another parcel typed meanwhile: no report', async () => {
  const miss = setup({ search: '?state=WA&county=Spokane&parcel=99999.9999&report=1', onSubmit: 'not-found' });
  await miss.clock.advance(100000);
  assert.equal(miss.log.submits, 1);
  assert.equal(viewOpen(miss), false);
  const moved = setup({ search: '?state=WA&county=Spokane&parcel=23123.9051&report=1' });
  await moved.clock.advance(1000);
  moved.$('parcel').value = '11111.1111';
  await moved.clock.advance(20000);
  assert.equal(viewOpen(moved), false);
});

test('every search updates the address bar; reportLink follows the search that produced the data on screen', async () => {
  const s = setup();
  assert.equal(s.D.reportLink('x'), null, 'no search yet');
  s.fill('WA', 'Spokane', ' 23123.9051 ');
  s.$('searchForm').requestSubmit();
  assert.deepEqual(s.log.replaced, ['/?state=WA&county=Spokane&parcel=23123.9051']);
  assert.equal(s.D.reportLink('x'), null, 'parcel not loaded yet');
  await s.clock.advance(5000);
  assert.equal(s.D.reportLink('Smith parcel'), `${ORIGIN}/?state=WA&county=Spokane&parcel=23123.9051&report=1&ref=Smith+parcel`);
  // A later search that fails leaves the old data on screen, and the link with it.
  s.ctx.AcresXSections = null;
  s.fill('WA', 'Stevens', '99999');
  const submit = s.$('searchForm').requestSubmit;
  s.$('searchForm').requestSubmit = () => { for (const fn of s.$('searchForm').listeners.submit) fn({}); };
  s.$('searchForm').requestSubmit();
  assert.equal(s.log.replaced.at(-1), '/?state=WA&county=Stevens&parcel=99999');
  assert.match(s.D.reportLink('a'), /county=Spokane&parcel=23123\.9051/);
  s.$('searchForm').requestSubmit = submit;
  // An invalid form (no state) changes nothing.
  s.fill('', 'Spokane', '1');
  for (const fn of s.$('searchForm').listeners.submit) fn({});
  assert.equal(s.log.replaced.length, 2);
});

test('address bar: only on the search page; a failing history API is ignored', () => {
  const s = setup();
  s.ctx.location.pathname = '/r/abc';
  s.fill('WA', 'Spokane', '1');
  for (const fn of s.$('searchForm').listeners.submit) fn({});
  assert.deepEqual(s.log.replaced, []);
  s.ctx.location.pathname = '/';
  s.ctx.history.replaceState = () => { throw new Error('SecurityError'); };
  assert.doesNotThrow(() => { for (const fn of s.$('searchForm').listeners.submit) fn({}); });
});

// ---- The report view toolbar

async function reportAfterSearch(opts) {
  const s = setup(opts);
  s.fill('WA', 'Spokane', '23123.9051');
  s.$('searchForm').requestSubmit();
  await s.clock.advance(5000);
  s.$('generateReportBtn').click();
  s.$('acresxReportName').value = 'Smith parcel';
  s.$('acresxReportCreate').click();
  return s;
}
const LINK = `${ORIGIN}/?state=WA&county=Spokane&parcel=23123.9051&report=1&ref=Smith+parcel`;

test('Home Screen app on iPhone: "Open in Safari to save PDF" is the primary action, a target=_blank link to the full https deep link', async () => {
  const s = await reportAfterSearch({ ua: IPHONE, standalone: true });
  const a = s.$('acresxReportSafari');
  assert.equal(a.tagName, 'A');
  assert.equal(a.hidden, false);
  assert.equal(a.textContent, 'Open in Safari to save PDF');
  assert.equal(a.getAttribute('href'), LINK);
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener');
  assert.match(a.className, /arv-link/);
  const order = s.$('acresxReportActions').children.map(n => n.id);
  assert.ok(order.indexOf('acresxReportSafari') < order.indexOf('acresxReportCopy'));
  assert.ok(order.indexOf('acresxReportCopy') < order.indexOf('acresxReportPdf'), 'Download PDF comes after');
  assert.equal(s.$('acresxReportCopy').hidden, false);
  assert.equal(s.$('acresxReportPdf').hidden, false, 'Download PDF stays available');
  assert.doesNotMatch(s.$('acresxReportPdf').className, /arv-primary/, '... as a secondary button');
  const hint = s.$('acresxReportHint');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /^Home Screen apps on iPhone can't save files\./);
  assert.match(hint.textContent, /branding saved in this Home Screen app may need re-entering in Safari\.$/);
  assert.equal(s.$('acresxReportPrint').hidden, true);
  // Opening the link deep-links back to this report: the same search, the same reference.
  assert.deepEqual({ ...s.D.parse(new URL(LINK).search, { counties }) }, { state: 'WA', county: 'Spokane', parcel: '23123.9051', report: true, ref: 'Smith parcel' });
});

test('Home Screen app, signed in: the explanation says branding follows the account', async () => {
  const s = await reportAfterSearch({ ua: IPHONE, standalone: true, signedIn: true });
  assert.match(s.$('acresxReportHint').textContent, /may need re-entering in Safari \(sign in there too and it follows your account\)\.$/);
});

test('Copy link: the clipboard gets the deep link; without clipboard access the link is shown to copy', async () => {
  const s = await reportAfterSearch({ ua: IPHONE, standalone: true, clipboard: () => Promise.resolve() });
  s.$('acresxReportCopy').click();
  assert.deepEqual(s.log.copied, [LINK], 'written inside the tap');
  await s.clock.advance(1);
  assert.equal(s.$('acresxReportCopyNote').hidden, false);
  assert.match(s.$('acresxReportCopyNote').textContent, /^Link copied/);
  const refused = await reportAfterSearch({ ua: IPHONE, standalone: true, clipboard: () => Promise.reject(new Error('NotAllowedError')) });
  refused.$('acresxReportCopy').click();
  await refused.clock.advance(1);
  assert.equal(refused.$('acresxReportCopyNote').textContent, `Copy this link and open it in Safari: ${LINK}`);
  const none = await reportAfterSearch({ ua: IPHONE, standalone: true });
  none.$('acresxReportCopy').click();
  assert.match(none.$('acresxReportCopyNote').textContent, /open it in Safari: https:\/\//);
});

test('not standalone (Safari/Chrome tab, desktop, Android app): the toolbar is unchanged', async () => {
  for (const opts of [{ ua: IPHONE }, { ua: IPHONE, standalone: false }, { ua: DESKTOP }, { ua: ANDROID, media: ['standalone'] }]) {
    const s = await reportAfterSearch(opts);
    assert.equal(s.$('acresxReportSafari').hidden, true, JSON.stringify(opts));
    assert.equal(s.$('acresxReportCopy').hidden, true);
    assert.match(s.$('acresxReportPdf').className, /arv-primary/);
    assert.doesNotMatch(s.$('acresxReportHint').textContent, /Home Screen/);
  }
  const iphone = await reportAfterSearch({ ua: IPHONE });
  assert.equal(iphone.$('acresxReportHint').textContent, 'On iPhone or iPad: tap Download PDF, then choose Save to Files (or Mail, Messages) to keep the PDF.');
});

test('Home Screen app with a report that has no link (a saved report): no Safari button, the explanation says to open AcresX in Safari', async () => {
  const s = setup({ ua: IPHONE, standalone: true });
  s.ctx.__acresxLast = fixture();
  s.R.openReport(s.R.renderHtml(s.R.buildModel('Saved', fixture())));
  assert.equal(s.$('acresxReportSafari').hidden, true);
  assert.equal(s.$('acresxReportCopy').hidden, true);
  assert.match(s.$('acresxReportPdf').className, /arv-primary/);
  assert.equal(s.$('acresxReportHint').textContent, "Home Screen apps on iPhone can't save files. Open AcresX in Safari to save this report as a PDF.");
  // A non-https link is never used.
  for (const browserUrl of ['javascript:alert(1)', 'http://evil.example/?state=WA', '//evil.example/', '/?state=WA&county=Spokane&parcel=1&report=1']) {
    s.R.openReport(s.R.renderHtml(s.R.buildModel('Saved', fixture())), { browserUrl });
    assert.equal(s.$('acresxReportSafari').hidden, true, browserUrl);
  }
  // Local dev (wrangler dev) runs on http://127.0.0.1 or localhost.
  s.R.openReport(s.R.renderHtml(s.R.buildModel('Saved', fixture())), { browserUrl: 'http://127.0.0.1:8787/?state=WA&county=Spokane&parcel=1&report=1' });
  assert.equal(s.$('acresxReportSafari').hidden, false);
});

test('without deep-link.js the report view works as before', async () => {
  const s = setup({ ua: IPHONE, standalone: true, modules: MODULES.filter(m => m !== 'deep-link.js') });
  s.ctx.__acresxLast = fixture();
  s.$('generateReportBtn').click();
  s.$('acresxReportCreate').click();
  assert.equal(s.$('acresxReportSafari').hidden, true);
  assert.match(s.$('acresxReportPdf').className, /arv-primary/);
  assert.deepEqual(s.log.saved, ['Parcel 23123.9051']);
});

test('wiring: deep-link.js is injected after state-selector and property-report-v2, before browser-fallback; state-selector exposes its counties', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const list = JSON.parse(`[${/for\(const s of \[([^\]]+)\]\)/.exec(index)[1].replace(/'/g, '"')}]`);
  const at = n => list.indexOf(n);
  assert.ok(at('deep-link') > at('state-selector') && at('deep-link') > at('property-report-v2') && at('deep-link') > at('accounts'));
  assert.ok(at('deep-link') < at('browser-fallback'));
  assert.match(readPublic('state-selector.js'), /window\.AcresXStateSelector = \{ counties:/);
});
