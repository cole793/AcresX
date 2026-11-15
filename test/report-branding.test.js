// Offline tests for report co-branding: public/report-branding.js (Settings page, per-browser
// storage, cleaning and logo limits) and its use in public/property-report-v2.js (page 1 header,
// every footer, "Powered by AcresX"). No network; localStorage is a stub, including one that throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeLazyContext, makeContext, makeClock, readPublic } from './ui-harness.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const MODULES = ['flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-report-v2.js'];
const KEY = 'acresx.reportBranding.v1';
// A tiny valid PNG data URL (1x1).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JANE = { name: 'Jane Example', brokerage: 'Example Realty', phone: '(509) 555-0100', email: 'jane@example.com', website: 'example.com', license: '' };

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); } };
}
const throwingStorage = () => ({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } });

// The branding module alone, in the lazy fake DOM. storage: an object, or 'throw' for a
// localStorage getter that throws (blocked site data).
function branding({ storage = memoryStorage() } = {}) {
  const h = makeLazyContext({});
  h.context.URL = URL;
  if (storage === 'throw') Object.defineProperty(h.context, 'localStorage', { get() { throw new Error('SecurityError: access denied'); } });
  else h.context.localStorage = storage;
  h.run(readPublic('report-branding.js'));
  return { B: h.context.AcresXBranding, h, storage };
}

function report({ storage, save, name, modules = MODULES } = {}) {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: fixture() });
  h.context.URL = URL;
  if (storage === 'throw') Object.defineProperty(h.context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  else if (storage) h.context.localStorage = storage;
  for (const f of ['report-branding.js', ...modules]) h.run(readPublic(f));
  if (save) assert.equal(h.context.AcresXBranding.save(save).ok, true);
  if (name !== undefined) h.context.prompt = () => name;
  h.context.__acresxLast = fixture();
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  const html = h.opened.at(-1);
  return { html, pages: html.split('<section class="page ').slice(1), h };
}

// ---- Storage

test('branding saves to this browser and loads back in a new page (same storage)', () => {
  const storage = memoryStorage();
  const { B } = branding({ storage });
  assert.equal(B.load(), null, 'nothing saved yet');
  const r = B.save({ ...JANE, logo: PNG });
  assert.equal(r.ok, true); assert.equal(r.stored, true);
  const stored = JSON.parse(storage.data.get(KEY));
  assert.equal(stored.name, 'Jane Example'); assert.equal(stored.website, 'https://example.com'); assert.equal(stored.logo, PNG);
  const again = branding({ storage }).B.load();
  assert.equal(again.brokerage, 'Example Realty'); assert.equal(again.phone, '(509) 555-0100'); assert.equal(again.logo, PNG);
  assert.equal(B.clear().stored, true);
  assert.equal(storage.data.has(KEY), false);
  assert.equal(branding({ storage }).B.load(), null);
});

test('storage that throws: the page still works, branding is kept for this page load only', () => {
  for (const storage of ['throw', throwingStorage()]) {
    const { B } = branding({ storage });
    assert.equal(B.storageAvailable(), false);
    assert.equal(B.load(), null);
    const r = B.save(JANE);
    assert.equal(r.ok, true); assert.equal(r.stored, false, 'reported as not saved');
    assert.equal(B.load().name, 'Jane Example', 'kept in memory');
    assert.equal(B.clear().stored, false);
    assert.equal(B.load(), null);
  }
  // A report still generates, with the in-memory branding.
  const { pages } = report({ storage: 'throw', save: JANE });
  assert.equal(pages.length, 4);
  assert.match(pages[0], /Prepared by <strong>Jane Example<\/strong>, Example Realty/);
});

test('a failed write never falls back to an older stored copy', () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ name: 'Old Name' }) });
  const { B } = branding({ storage });
  assert.equal(B.load().name, 'Old Name');
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(B.save({ name: 'New Name' }).stored, false);
  assert.equal(B.load().name, 'New Name');
  storage.removeItem = () => { throw new Error('SecurityError'); };
  B.clear();
  assert.equal(B.load(), null, 'cleared for this page even though the stored copy could not be removed');
});

test('corrupt or tampered storage is cleaned on load', () => {
  assert.equal(branding({ storage: memoryStorage({ [KEY]: '{not json' }) }).B.load(), null);
  const tampered = { name: 'Jane\u202e Example\u0000', brokerage: 'x'.repeat(500), website: 'javascript:alert(1)', email: 'not-an-email', phone: '12', logo: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==' };
  const b = branding({ storage: memoryStorage({ [KEY]: JSON.stringify(tampered) }) }).B.load();
  assert.equal(b.name, 'Jane Example', 'control and bidi-override characters removed');
  assert.equal(b.brokerage.length, 100, 'length capped');
  assert.equal(b.website, ''); assert.equal(b.email, ''); assert.equal(b.phone, ''); assert.equal(b.logo, '');
});

// ---- Validation

test('email, phone and website are checked loosely; the website must be http(s)', () => {
  const { B } = branding();
  const errs = input => Object.keys(B.validate({ name: 'A', ...input }).errors);
  assert.deepEqual(errs({ email: 'jane@example.com', phone: '(509) 555-0100', website: 'https://www.example.com/agents/jane' }), []);
  assert.deepEqual(errs({ phone: '+1 509.555.0100 ext 12' }), []);
  assert.deepEqual(errs({ email: 'jane@example' }), ['email']);
  assert.deepEqual(errs({ email: 'jane <x>@example.com' }), ['email']);
  assert.deepEqual(errs({ phone: '555-01' }), ['phone']);
  assert.deepEqual(errs({ phone: 'call me' }), ['phone']);
  for (const w of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', 'https://user:pw@example.com', 'not a site']) assert.deepEqual(errs({ website: w }), ['website'], w);
  assert.equal(B.validate({ name: 'A', website: 'example.com' }).branding.website, 'https://example.com');
  assert.equal(B.validate({ name: 'A', website: 'http://example.com/' }).branding.website, 'http://example.com');
  assert.deepEqual(Object.keys(B.validate({ brokerage: 'Example Realty' }).errors), ['name'], 'a name is needed for branding');
  assert.equal(B.save({ ...JANE, email: 'bad' }).ok, false);
  assert.equal(B.load(), null, 'an invalid form is not saved');
  assert.equal(B.save({ name: '', brokerage: '' }).branding, null, 'an empty form clears branding');
});

// ---- Logo

test('logo: PNG/JPG only (SVG refused), fit to 600x200, data URL capped at 200 KB', () => {
  const { B } = branding();
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg = [0xff, 0xd8, 0xff, 0xe0];
  assert.equal(B.checkLogoFile({ type: 'image/png', size: 1000, name: 'a.png' }, png), '');
  assert.equal(B.checkLogoFile({ type: 'image/jpeg', size: 1000, name: 'a.jpg' }, jpg), '');
  assert.match(B.checkLogoFile({ type: 'image/svg+xml', size: 1000, name: 'a.svg' }), /SVG logos are not accepted/);
  assert.match(B.checkLogoFile({ type: '', size: 1000, name: 'logo.SVG' }), /SVG/);
  assert.match(B.checkLogoFile({ type: 'image/gif', size: 1000, name: 'a.gif' }), /PNG or JPG/);
  assert.match(B.checkLogoFile({ type: 'image/png', size: 6 * 1024 * 1024, name: 'a.png' }, png), /larger than 5 MB/);
  assert.match(B.checkLogoFile({ type: 'image/png', size: 1000, name: 'a.png' }, [0x3c, 0x73, 0x76, 0x67]), /not a PNG or JPG/, 'an SVG renamed .png');

  assert.deepEqual({ ...B.fitWithin(1200, 800) }, { w: 300, h: 200 });
  assert.deepEqual({ ...B.fitWithin(3000, 300) }, { w: 600, h: 60 });
  assert.deepEqual({ ...B.fitWithin(120, 40) }, { w: 120, h: 40 }, 'small logos are not enlarged');

  assert.equal(B.validLogo(PNG), true);
  assert.equal(B.validLogo('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(B.validLogo('data:image/png;base64,AAAA" onerror="x'), false);
  assert.equal(B.validLogo(`data:image/png;base64,${'A'.repeat(B.MAX_LOGO_CHARS)}`), false);

  // A canvas whose PNG is too large: JPEG at lower quality, then smaller sizes, until <= 200 KB.
  const calls = [];
  const render = (w, h, opaque) => ({ toDataURL: (type, q = 1) => { calls.push([w, h, type, q, opaque]); const bytes = Math.round(w * h * (type === 'image/png' ? 4 : q * 2.2)); return `data:${type};base64,${'A'.repeat(bytes)}`; } });
  const r = B.encodeLogo(1800, 600, render);
  assert.equal(r.ok, true);
  assert.ok(r.dataUrl.length <= 200 * 1024);
  assert.ok(r.width <= 600 && r.height <= 200);
  assert.deepEqual(calls[0].slice(0, 3), [600, 200, 'image/png']);
  assert.ok(calls.some(c => c[2] === 'image/jpeg' && c[4] === true), 'JPEG drawn on white');
  assert.equal(B.encodeLogo(600, 200, () => ({ toDataURL: () => `data:image/png;base64,${'A'.repeat(300 * 1024)}` })).ok, false);
  assert.match(B.save({ ...JANE, logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).errors.logo, /PNG or JPG/);
});

// ---- Escaping

test('branding text is HTML-escaped in the report and the Settings preview', () => {
  const evil = { name: '<img src=x onerror=alert(1)>', brokerage: 'Smith & "Sons" <b>', phone: '(509) 555-0100', email: 'a@example.com', website: 'https://example.com/?q=<script>', license: '<i>9</i>' };
  const { B } = branding();
  const preview = B.previewHtml(B.validate(evil).branding);
  assert.doesNotMatch(preview, /<img src=x|<b>|<script>|<i>9/);
  assert.match(preview, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const { html } = report({ storage: memoryStorage(), save: evil });
  const body = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(body, /<img src=x|onerror=alert\(1\)>|"Sons" <b>|<i>9/);
  assert.match(body, /Prepared by <strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>, Smith &amp; &quot;Sons&quot; &lt;b&gt;/);
  assert.match(body, /License #&lt;i&gt;9&lt;\/i&gt;/);
});

// ---- Report

test('report without branding: AcresX header and footers as before, no "Prepared by"', () => {
  const { pages, html } = report({ storage: memoryStorage() });
  assert.equal(pages.length, 4);
  assert.match(pages[0], /<header class="head"><img class="logo" src="\/assets\/acresx-logo.png" alt="AcresX">/);
  pages.forEach((p, i) => assert.match(p, new RegExp(`<footer class="foot"><span>AcresX · Preliminary property intelligence · Verify material findings</span><span>Page ${i + 1} of 4</span></footer>`)));
  assert.doesNotMatch(html, /Prepared by|Powered by AcresX/);
});

test('report with branding: page 1 "Prepared by", logo and contact; every footer carries the agent; AcresX as "Powered by"', () => {
  const plain = report({ storage: memoryStorage() });
  const { pages } = report({ storage: memoryStorage(), save: { ...JANE, license: '12345', logo: PNG }, name: 'Smith family' });
  assert.equal(pages.length, 4);
  const head = /<header class="head branded">[\s\S]*?<\/header>/.exec(pages[0])[0];
  assert.match(head, /<img class="agent-logo" src="data:image\/png;base64,[^"]+" alt="Example Realty">/);
  assert.match(head, /Prepared by <strong>Jane Example<\/strong>, Example Realty/);
  assert.match(head, /<div class="agent-contact">\(509\) 555-0100 · jane@example\.com · example\.com · License #12345<\/div>/);
  assert.match(head, /<span class="powered">Powered by AcresX<\/span>/);
  pages.forEach((p, i) => {
    assert.match(p, new RegExp(`<footer class="foot branded"><span class="foot-agent">Prepared by Jane Example, Example Realty · \\(509\\) 555-0100 · jane@example\\.com · example\\.com</span><span class="foot-right">Powered by AcresX · Screening only · Page ${i + 1} of 4</span></footer>`));
    if (i) assert.match(p, /<header class="mini-head"><img class="agent-logo-sm" src="data:image\/png/);
  });
  // The screening framing is unchanged.
  assert.match(pages[0], /Verify material findings with the responsible agency, utility or licensed professional/);
  assert.match(pages[2], /Preliminary screening only\./);
  // The client / reference name typed when generating prints on page 1.
  assert.match(pages[0], /<div><span>Reference<\/span><strong>Smith family<\/strong><\/div>/);
  // Same score and costs as the unbranded report.
  const score = p => /<div class="score-num">([^<]+)<small>/.exec(p)[1];
  const cost = p => /<div class="cost-num">([^<]+)<\/div>/.exec(p)[1];
  assert.equal(score(pages[0]), score(plain.pages[0]));
  assert.equal(cost(pages[0]), cost(plain.pages[0]));
});

test('branding without a logo or contact details; a long brokerage name is capped and kept whole on page 1', () => {
  const brokerage = 'Northwest Rural Land & Ranch Properties of the Inland Empire, Eastern Washington and North Idaho Division Office';
  const { pages, html } = report({ storage: memoryStorage(), save: { name: 'Jane Example', brokerage } });
  const cut = brokerage.slice(0, 100).trim().replace(/&/g, '&amp;');
  assert.match(pages[0], new RegExp(`Prepared by <strong>Jane Example</strong>, ${cut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</div></div></div>`));
  assert.doesNotMatch(pages[0], /agent-logo|agent-contact/);
  assert.match(pages[1], /<header class="mini-head"><span class="agent-mark">Jane Example, Northwest Rural/);
  assert.match(pages[1], /<span class="foot-agent">Prepared by Jane Example, Northwest Rural[^<]*<\/span>/);
  assert.match(html, /\.head\.branded\{/, 'the branded header has its own styles');
});

test('no branding module loaded: the report is unchanged', () => {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: fixture() });
  for (const f of MODULES) h.run(readPublic(f));
  h.context.__acresxLast = fixture();
  h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.doesNotMatch(h.opened.at(-1), /Prepared by|Powered by/);
});

// ---- Page wiring

test('the sidebar Settings item is enabled and the module is injected before browser-fallback', () => {
  const clock = makeClock();
  const h = makeContext({ clock, body: [['aside', { class: 'sidebar' }, '', [['nav', { class: 'nav' }, '', [['button', {}, 'Property Dashboard'], ['button', {}, 'Settings']]]]]] });
  const settings = h.document.querySelectorAll('.sidebar .nav button')[1];
  settings.disabled = true;
  h.run(readPublic('report-branding.js'));
  assert.equal(settings.disabled, false);
  assert.equal(typeof settings.onclick, 'function');
  assert.ok(h.document.getElementById('reportBrandingStyles'), 'styles added');
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const list = /for\(const s of \[([^\]]+)\]\)/.exec(src)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(list.includes('report-branding'));
  assert.ok(list.indexOf('report-branding') < list.indexOf('browser-fallback'));
  assert.equal(list.at(-1), 'browser-fallback');
});
