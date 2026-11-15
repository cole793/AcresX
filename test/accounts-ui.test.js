// Offline tests for the browser side of accounts: public/accounts.js (sign-in form, signed-in
// state, first-sign-in import, account-backed stores), its use by public/property-actions.js and
// public/report-branding.js, the report snapshot that property-report-v2.js saves, and the checks
// public/shared-report.js applies before rendering a shared report. fetch and localStorage are
// stubs; nothing leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeContext, makeClock, makeLazyContext, readPublic } from './ui-harness.js';

const SAVED_KEY = 'acresx.savedProperties.v2';
const REPORTS_KEY = 'acresx.reports.v1';
const BRAND_KEY = 'acresx.reportBranding.v1';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/report-spokane-23123.9051.json', import.meta.url), 'utf8'));
const REPORT_MODULES = ['report-branding.js', 'flood-status.js', 'screening-inputs.js', 'wetlands-status.js', 'acreage.js', 'screening-refinements.js', 'cost-tables.js', 'local-cost-model.js', 'public-utilities.js', 'property-tax.js', 'property-report-v2.js'];

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); } };
}

// routes: { 'GET /api/me': body | (body) => ({ status, body }) }. Every call is recorded.
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: String(url), body, headers: init.headers || {}, credentials: init.credentials });
    let route = routes[`${method} ${url}`];
    if (typeof route === 'function') route = route(body);
    else if (route !== undefined) route = { body: route };
    if (route === undefined) return { ok: false, status: 404, json: async () => ({ error: 'no stub' }) };
    const status = route.status || 200;
    return { ok: status < 400, status, json: async () => route.body };
  };
  return { fetch, calls };
}

const PAGE = [
  ['aside', { class: 'sidebar' }, '', [['nav', { class: 'nav' }, '', [['button', {}, 'Property Dashboard'], ['button', {}, 'Saved Properties'], ['button', {}, 'Reports'], ['button', {}, 'Settings']]]]],
  ['div', { class: 'workspace' }, '', [
    ['header', { class: 'topbar' }, '', [['div', { class: 'top-actions' }, '', [['button', { class: 'ghost' }, 'Save property'], ['button', { class: 'primary' }, 'Generate report']]]]],
    ['main', {}, '']
  ]]
];

async function page({ routes, storage = memoryStorage(), search = '', scripts = ['accounts.js'] } = {}) {
  const clock = makeClock();
  const { fetch, calls } = fakeFetch(routes);
  const replaced = [];
  let reloaded = 0;
  const h = makeContext({
    body: PAGE, clock, fetch,
    extra: {
      localStorage: storage, URLSearchParams,
      location: { pathname: '/', search, hash: '', origin: 'https://acresx.test', reload() { reloaded++; } },
      history: { replaceState: (s, t, url) => replaced.push(url) },
      open: () => null, prompt: () => null
    }
  });
  for (const s of scripts) h.run(readPublic(s), s);
  await h.ctx.AcresXAccounts?.ready;
  await clock.flush();
  const $ = id => h.document.getElementById(id);
  const click = async node => { for (const fn of node.listeners.click || []) await fn({ preventDefault() {}, target: node }); await clock.flush(); };
  return { h, ctx: h.ctx, calls, storage, $, click, clock, replaced, reloads: () => reloaded };
}

const SIGNED_IN = user => ({
  'GET /api/me': { enabled: true, signedIn: true, user },
  'GET /api/saved-properties': { items: [{ key: 'WA:Spokane:9', name: 'Account parcel', state: 'WA', county: 'Spokane', parcelId: '9' }] },
  'GET /api/reports': { reports: [{ id: 'r1', title: 'Account report', createdAt: Date.parse('2026-11-14T00:00:00Z'), summary: { name: 'Account report', county: 'Spokane' }, hasSnapshot: true, activeShares: 0 }] },
  'GET /api/branding': { branding: { name: 'Account Jane', brokerage: 'Account Realty' } }
});
const LOCAL = () => memoryStorage({
  [SAVED_KEY]: [{ key: 'WA:Spokane:1', name: 'Local parcel' }, { key: 'WA:Spokane:2', name: 'Second local' }],
  [REPORTS_KEY]: [{ id: '1700000000000-abcde', name: 'Local report' }],
  [BRAND_KEY]: { name: 'Local Jane', brokerage: 'Local Realty' }
});

// ---- Accounts not set up: nothing changes

test('without accounts (no email secret yet) the page is unchanged and everything stays in localStorage', async () => {
  const storage = LOCAL();
  const p = await page({ routes: { 'GET /api/me': { enabled: false, signedIn: false, reason: 'email' } }, storage, scripts: ['accounts.js', 'property-actions.js', 'report-branding.js'] });
  assert.equal(p.$('accountsButton'), null, 'no Sign in button');
  assert.equal(p.$('accountsStyles'), null, 'no styles added');
  assert.equal(p.$('accountsModal'), null);
  assert.deepEqual(p.calls.map(c => `${c.method} ${c.path}`), ['GET /api/me'], 'one status check, nothing else');
  assert.equal(p.ctx.AcresXAccounts.storeFor(SAVED_KEY), null);
  assert.equal(p.ctx.AcresXAccounts.brandingStore(), null);
  const L = p.ctx.AcresXLibrary;
  assert.equal(L.read(SAVED_KEY)[0].name, 'Local parcel');
  L.write(SAVED_KEY, [{ key: 'WA:Spokane:3', name: 'New local' }]);
  assert.equal(JSON.parse(storage.data.get(SAVED_KEY))[0].name, 'New local');
  const B = p.ctx.AcresXBranding;
  assert.equal(B.load().name, 'Local Jane');
  assert.equal(B.save({ name: 'Local Jim' }).stored, true);
  assert.equal(JSON.parse(storage.data.get(BRAND_KEY)).name, 'Local Jim');
  assert.equal(p.calls.length, 1, 'no account calls were made');
});

test('a failed status check is treated as "accounts not available"', async () => {
  const p = await page({ routes: {} });
  assert.equal(p.$('accountsButton'), null);
  assert.equal(p.ctx.AcresXAccounts.state.enabled, false);
});

// ---- Sign in

test('signed out: Sign in in the top bar, email form, then "Check your email"', async () => {
  const p = await page({ routes: { 'GET /api/me': { enabled: true, signedIn: false }, 'POST /api/auth/request-link': { ok: true, message: 'If that address can sign in, a sign-in link is on its way. It expires in 15 minutes.' } } });
  const button = p.$('accountsButton');
  assert.ok(button, 'Sign in button added');
  assert.equal(button.parentNode.className, 'top-actions');
  assert.equal(button.textContent, 'Sign in');
  assert.equal(p.ctx.AcresXAccounts.storeFor(SAVED_KEY), null, 'signed out: localStorage');
  await p.click(button);
  const form = p.$('accountsForm');
  assert.ok(form && p.$('accountsEmail'));
  p.$('accountsEmail').value = 'nope';
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.match(p.$('accountsMessage').textContent, /Enter an email/);
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 0);
  p.$('accountsEmail').value = ' jane@example.com ';
  await form.listeners.submit[0]({ preventDefault() {} });
  await p.clock.flush();
  const post = p.calls.find(c => c.path === '/api/auth/request-link');
  assert.deepEqual(post.body, { email: 'jane@example.com' });
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.equal(post.credentials, 'same-origin');
  assert.match(p.$('accountsDialogTitle').textContent, /Check your email/);
  assert.match(p.$('accountsCheckEmail').textContent, /expires in 15 minutes/);
});

test('a used or expired link shows a message and the address bar is cleaned', async () => {
  const p = await page({ routes: { 'GET /api/me': { enabled: true, signedIn: false } }, search: '?signin=expired' });
  assert.match(p.$('accountsToast').textContent, /expired or was already used/);
  assert.deepEqual(p.replaced, ['/']);
});

// ---- Signed in

test('signed in: the email and Sign out; Saved Properties, Reports and branding come from the account', async () => {
  const storage = LOCAL();
  storage.setItem('acresx.accounts.importOffered.u1', 'true');
  const p = await page({ routes: { ...SIGNED_IN({ id: 'u1', email: 'jane@example.com' }), 'PUT /api/saved-properties/WA%3ASpokane%3A10': { ok: true }, 'DELETE /api/saved-properties/WA%3ASpokane%3A9': { ok: true }, 'DELETE /api/reports/r1': { ok: true }, 'PUT /api/branding': { ok: true }, 'POST /api/auth/logout': { ok: true } }, storage, scripts: ['accounts.js', 'property-actions.js', 'report-branding.js'] });
  const button = p.$('accountsButton');
  assert.equal(button.textContent, 'jane@example.com');
  assert.equal(p.$('accountsModal'), null, 'import already offered on this browser');
  const L = p.ctx.AcresXLibrary;
  assert.deepEqual(L.read(SAVED_KEY).map(x => x.name), ['Account parcel']);
  assert.deepEqual(L.read(REPORTS_KEY).map(x => [x.name, x.accountReport, x.hasSnapshot]), [['Account report', true, true]]);
  // Replace the account parcel with a new one: one PUT, one DELETE, localStorage untouched.
  const before = storage.data.get(SAVED_KEY);
  L.write(SAVED_KEY, [{ key: 'WA:Spokane:10', name: 'Added on this device' }]);
  await p.clock.flush();
  const writes = p.calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`);
  assert.deepEqual(writes.sort(), ['DELETE /api/saved-properties/WA%3ASpokane%3A9', 'PUT /api/saved-properties/WA%3ASpokane%3A10']);
  assert.equal(storage.data.get(SAVED_KEY), before);
  L.write(REPORTS_KEY, []);
  await p.clock.flush();
  assert.ok(p.calls.some(c => c.method === 'DELETE' && c.path === '/api/reports/r1'));
  // Branding.
  const B = p.ctx.AcresXBranding;
  assert.equal(B.load().name, 'Account Jane');
  const r = B.save({ name: 'Jane Updated', brokerage: 'Account Realty' });
  assert.equal(r.account, true);
  await p.clock.flush();
  const put = p.calls.find(c => c.method === 'PUT' && c.path === '/api/branding');
  assert.equal(put.body.branding.name, 'Jane Updated');
  assert.equal(JSON.parse(storage.data.get(BRAND_KEY)).name, 'Local Jane', 'this browser\'s branding is kept');
  // Sign out.
  await p.click(button);
  await p.click(p.$('accountsSignOut'));
  assert.ok(p.calls.some(c => c.method === 'POST' && c.path === '/api/auth/logout'));
  assert.equal(p.reloads(), 1);
  assert.equal(p.ctx.AcresXAccounts.storeFor(SAVED_KEY), null);
});

test('first sign-in on a browser with saved work: offer to add it, then send it once', async () => {
  const storage = LOCAL();
  let imported = null;
  const routes = { ...SIGNED_IN({ id: 'u1', email: 'jane@example.com' }), 'POST /api/account/import': body => { imported = body; return { body: { ok: true } }; } };
  const p = await page({ routes, storage, search: '?signedIn=1' });
  assert.match(p.$('accountsToast').textContent, /Signed in as jane@example.com/);
  assert.deepEqual(p.replaced, ['/']);
  assert.ok(p.$('accountsModal'), 'import offered');
  assert.match(p.$('accountsModal').textContent, /2 saved properties, 1 report, your report branding/);
  await p.click(p.$('accountsImport'));
  assert.deepEqual(imported.savedProperties.map(x => x.key), ['WA:Spokane:1', 'WA:Spokane:2']);
  assert.deepEqual(imported.reports.map(x => x.id), ['1700000000000-abcde']);
  assert.equal(imported.branding.name, 'Local Jane');
  assert.equal(p.$('accountsModal'), null);
  assert.equal(storage.data.get('acresx.accounts.importOffered.u1'), 'true');
  assert.ok(storage.data.get(SAVED_KEY), 'nothing removed from this browser');
  assert.equal(p.calls.filter(c => c.path === '/api/saved-properties').length, 2, 'account reloaded after the import');
  // Next visit: no offer.
  const again = await page({ routes, storage });
  assert.equal(again.$('accountsModal'), null);
  // "Not now" also stops the offer for that account; another account on this browser is asked.
  const other = await page({ routes: { ...routes, 'GET /api/me': { enabled: true, signedIn: true, user: { id: 'u2', email: 'b@example.com' } } }, storage });
  assert.ok(other.$('accountsModal'));
  await other.click(other.$('accountsImportSkip'));
  assert.equal(storage.data.get('acresx.accounts.importOffered.u2'), 'true');
});

test('no offer when this browser has nothing saved', async () => {
  const p = await page({ routes: SIGNED_IN({ id: 'u3', email: 'c@example.com' }) });
  assert.equal(p.$('accountsModal'), null);
});

test('a report generated while signed in is saved to the account; signed out it is not', async () => {
  const model = { name: 'Smith parcel', generatedAt: '2026-11-15T10:00:00.000Z', f: { stateCode: 'WA', county: 'Spokane', pid: '1', address: '1 Pine Rd', acreage: { text: '5.00 acres' } }, score: { value: '7.2' }, data: {} };
  const snapshotOf = m => ({ v: 1, name: m.name, generatedAt: m.generatedAt, f: m.f, score: m.score, data: {} });
  let saved = null;
  const p = await page({ routes: { ...SIGNED_IN({ id: 'u1', email: 'j@example.com' }), 'POST /api/reports': body => { saved = body; return { body: { ok: true, id: 'r2' } }; } }, storage: memoryStorage({ 'acresx.accounts.importOffered.u1': 'true' }) });
  assert.equal(await p.ctx.AcresXAccounts.reportGenerated(model, snapshotOf), 'r2');
  assert.equal(saved.title, 'Smith parcel');
  assert.deepEqual(saved.summary, { name: 'Smith parcel', state: 'WA', county: 'Spokane', parcelId: '1', address: '1 Pine Rd', acreage: '5.00 acres', score: '7.2', generatedAt: '2026-11-15T10:00:00.000Z' });
  assert.equal(saved.snapshot.v, 1);
  assert.equal(p.ctx.AcresXAccounts.storeFor(REPORTS_KEY).read()[0].id, 'r2');
  const out = await page({ routes: { 'GET /api/me': { enabled: true, signedIn: false } } });
  assert.equal(await out.ctx.AcresXAccounts.reportGenerated(model, snapshotOf), null);
  assert.equal(out.calls.filter(c => c.method === 'POST').length, 0);
});

test('report cards from the account get View report and Share link; share creates, copies and turns off links', async () => {
  const p = await page({ routes: { ...SIGNED_IN({ id: 'u1', email: 'j@example.com' }), 'POST /api/reports/r1/share': { ok: true, path: '/r/abc', url: 'https://acresx.test/r/abc' }, 'DELETE /api/reports/r1/share': { ok: true, revoked: 1 } }, storage: memoryStorage({ 'acresx.accounts.importOffered.u1': 'true' }) });
  const doc = p.h.document;
  const card = doc.createElement('article');
  const actions = doc.createElement('div'); actions.className = 'library-actions';
  card.appendChild(actions);
  const item = p.ctx.AcresXAccounts.storeFor(REPORTS_KEY).read()[0];
  p.ctx.AcresXAccounts.decorateReportCard(card, item);
  assert.deepEqual(actions.children.map(b => b.textContent), ['View report', 'Share link']);
  p.ctx.AcresXAccounts.decorateReportCard(card.cloneNode?.() || doc.createElement('article'), { name: 'local' });
  await p.click(actions.children[1]);
  const panel = card.querySelector('.share-panel');
  assert.ok(panel);
  assert.match(panel.textContent, /Your account email is never shown/);
  await p.click(panel.querySelector('.share-create'));
  assert.equal(panel.querySelector('.share-url').value, 'https://acresx.test/r/abc');
  assert.equal(panel.querySelector('.share-row').hidden, false);
  let copied = '';
  p.ctx.navigator = { clipboard: { writeText: async t => { copied = t; } } };
  await p.click(panel.querySelector('.share-copy'));
  assert.equal(copied, 'https://acresx.test/r/abc');
  await p.click(panel.querySelector('.share-revoke'));
  assert.ok(p.calls.some(c => c.method === 'DELETE' && c.path === '/api/reports/r1/share'));
  assert.equal(panel.querySelector('.share-url').value, '');
  assert.match(panel.querySelector('.share-status').textContent, /turned off/);
});

// ---- Report snapshot and the shared view

function reportContext() {
  const h = makeLazyContext({ mappedSqm: 20.63 * 4046.8564224, last: fixture() });
  h.context.URL = URL;
  for (const f of REPORT_MODULES) h.run(readPublic(f));
  return h;
}

// The Spokane report fixture, and the same parcel with a property tax answer (page 2 tax line,
// data.propertyTax from public/property-tax.js; the shape of a Kootenai levy-rate estimate).
const withTax = () => ({
  ...fixture(),
  propertyTax: {
    available: true, state: 'WA', county: 'Spokane', parcelId: '23123.9051', status: 'found', basis: 'estimate', taxYear: 2026, total: 1234.56, levyRate: 9.87,
    note: 'Estimated from the 2026 levy rate; excludes fees and special assessments.', label: 'Estimated 2026 property tax',
    source: { name: 'County levy rates for 2026', url: 'https://example.gov/levy-2026.pdf' }, asOf: '2026-11-02',
    link: { label: 'View the tax bill on the county treasurer site', url: 'https://example.gov/treasurer' }
  }
});

for (const [label, data, expect] of [['plain', fixture, null], ['with property tax', withTax, /Estimated 2026 property tax|1,23[45]/]]) {
  test(`a saved report renders from its JSON snapshot exactly like the live report (${label})`, () => {
    const h = reportContext();
    const R = h.context.AcresXReport;
    const model = R.buildModel('Smith parcel', data());
    model.generatedAt = new Date().toISOString();
    const live = R.renderHtml(model, { brand: null });
    if (expect) assert.match(live, expect, 'the fixture exercises the tax line');
    const snap = JSON.parse(JSON.stringify(R.snapshot(model)));
    assert.equal(snap.v, 1);
    assert.deepEqual(snap.data.parcel.properties, {}, 'no parcel attributes are kept');
    assert.equal(snap.f.brand, undefined, 'branding is applied when the report is shown, not stored');
    assert.ok(JSON.stringify(snap).length < 900 * 1024, 'fits the server cap');
    const again = R.renderHtml(snap, { brand: null, date: snap.generatedAt });
    assert.equal(again, live);
    // The shared view's checks change nothing for a real report.
    h.context.__acresxSharedReportTest = true;
    h.run(readPublic('shared-report.js'));
    assert.equal(R.renderHtml(h.context.AcresXSharedReport.cleanModel(snap), { brand: null, date: snap.generatedAt }), live);
    // The live button path still opens the same report.
    h.context.__acresxLast = data();
    h.context.prompt = () => 'Smith parcel';
    h.el('generateReportBtn').listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(h.opened.at(-1), live);
  });
}

test('a shared report carries the agent branding and its generation date', () => {
  const h = reportContext();
  const R = h.context.AcresXReport, B = h.context.AcresXBranding;
  const model = R.buildModel('Smith parcel', fixture());
  const snap = JSON.parse(JSON.stringify(R.snapshot({ ...model, generatedAt: '2026-03-04T12:00:00.000Z' })));
  const html = R.renderHtml(snap, { brand: B.parts(B.normalize({ name: 'Jane Example', brokerage: 'Example Realty', phone: '(509) 555-0100' })), date: snap.generatedAt });
  assert.match(html, /Prepared by <strong>Jane Example<\/strong>, Example Realty/);
  assert.match(html, /Powered by AcresX/);
  assert.match(html, /Generated March 4, 2026/);
  assert.match(html, /Verify material findings/);
});

test('shared view: values used as class names are checked, so a tampered snapshot cannot inject markup', () => {
  const h = reportContext();
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
  assert.ok(!html.includes('<script>alert'), 'no injected script element');
  assert.ok(!html.includes('<img src=x'), 'text is escaped');
  assert.match(html, /class="flag verify"/);
  assert.match(html, /band-na/);
});

test('/r/ pages and new modules are wired: accounts.js injected before browser-fallback, shared page loads its scripts', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /'accounts','browser-fallback'\]/);
  const html = readPublic('shared-report.html');
  for (const s of ['report-branding.js', 'public-utilities.js', 'property-tax.js', 'property-report-v2.js', 'shared-report.js']) assert.match(html, new RegExp(`<script src="/${s.replace('.', '\\.')}"></script>`));
  assert.doesNotMatch(html.replace(/<script src="[^"]+"><\/script>/g, ''), /<script/i, 'no inline script (the CSP would block it)');
});
