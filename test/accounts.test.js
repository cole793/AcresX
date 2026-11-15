// Offline tests for accounts (src/services/accounts*.js): magic-link sign-in, sessions, CSRF,
// rate limits, size caps, saved properties / reports / branding, share links, the preview and
// tables-missing refusals. D1 is an in-memory SQLite running the real migration (test/fake-d1.js);
// fetch is stubbed, and the only host it answers for is the Resend email API.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import { fakeD1 } from './fake-d1.js';
import { isPreviewHost } from '../src/services/accounts-store.js';
import { SESSION_TTL_MS } from '../src/services/accounts-auth.js';

const ORIGIN = 'https://acresx.test';
const sha = s => createHash('sha256').update(s).digest('hex');
const sharedHtml = readFileSync(new URL('../public/shared-report.html', import.meta.url), 'utf8');

let emails, pending;
const realFetch = globalThis.fetch;
beforeEach(() => {
  emails = []; pending = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.resend.com/emails') {
      emails.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`network disabled in tests: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function makeEnv(overrides = {}) {
  return {
    ACCOUNTS_ENABLED: 'true', RESEND_API_KEY: 're_test_key', ACCOUNTS_EMAIL_FROM: 'AcresX <login@acresx.info>',
    MLS_DB: fakeD1(),
    ASSETS: { fetch: async () => new Response(sharedHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
    ...overrides
  };
}
const ctx = { waitUntil: p => pending.push(p) };
async function call(env, path, { method = 'GET', body, origin = ORIGIN, cookie, headers = {}, host = ORIGIN, rawBody, contentType = 'application/json' } = {}) {
  const h = new Headers(headers);
  if (origin && method !== 'GET') h.set('Origin', origin);
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined || rawBody !== undefined) h.set('Content-Type', contentType);
  if (!h.has('CF-Connecting-IP')) h.set('CF-Connecting-IP', '203.0.113.7');
  const response = await worker.fetch(new Request(`${host}${path}`, { method, headers: h, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) }), env, ctx);
  await Promise.all(pending.splice(0));
  return response;
}
const jsonOf = async r => r.json();
// The "Continue to AcresX" button: a same-origin form POST of the token.
const confirmLink = (env, token, opts = {}) => call(env, '/api/auth/callback', { method: 'POST', rawBody: `token=${token}`, contentType: 'application/x-www-form-urlencoded', ...opts });
const tokenFromEmail = e => e.body.text.match(/token=([A-Za-z0-9_-]{43})/)[1];

async function signIn(env, email = 'Jane@Example.com', ip = '203.0.113.7') {
  const r = await call(env, '/api/auth/request-link', { method: 'POST', body: { email }, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(r.status, 200);
  const token = tokenFromEmail(emails.at(-1));
  const cb = await confirmLink(env, token);
  assert.equal(cb.status, 303);
  const cookie = cb.headers.get('Set-Cookie').split(';')[0];
  return { cookie, token };
}

const snapshot = (extra = {}) => ({ v: 1, name: 'Smith parcel', generatedAt: '2026-11-15T10:00:00.000Z', f: { address: '123 Pine Rd', pid: '12345.6789', findings: [] }, score: { value: '7.2', band: 'good', drivers: [] }, data: { parcel: null }, ...extra });

// ---- Off unless everything is set up; previews refused

test('accounts are off, with no database writes, until the flag, the email key and the tables all exist', async () => {
  for (const [env, reason] of [
    [makeEnv({ ACCOUNTS_ENABLED: undefined }), 'off'],
    [makeEnv({ ACCOUNTS_ENABLED: 'false' }), 'off'],
    [makeEnv({ RESEND_API_KEY: undefined }), 'email'],
    [makeEnv({ MLS_DB: fakeD1({ migrate: false }) }), 'database'],
    [makeEnv({ MLS_DB: undefined }), 'database']
  ]) {
    const me = await call(env, '/api/me');
    assert.equal(me.status, 200, 'never a 500');
    assert.equal(me.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await me.json(), { enabled: false, signedIn: false, reason });
    const r = await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'a@example.com' } });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).enabled, false);
    const saved = await call(env, '/api/saved-properties/WA%3ASpokane%3A1', { method: 'PUT', body: { data: { name: 'x' } } });
    assert.equal(saved.status, 503);
    const cb = await confirmLink(env, 'a'.repeat(43));
    assert.equal(cb.status, 303); assert.equal(cb.headers.get('Location'), '/?signin=unavailable');
    if (env.MLS_DB) assert.equal(env.MLS_DB.log.writes, 0, `no writes when ${reason}`);
  }
  assert.equal(emails.length, 0);
});

test('preview hosts are refused even with the flag on, and nothing is written', async () => {
  assert.equal(isPreviewHost('pr-12-acresx.cole793.workers.dev'), true);
  assert.equal(isPreviewHost('1a2b3c4d-acresx.cole793.workers.dev'), true);
  assert.equal(isPreviewHost('acresx.cole793.workers.dev'), false);
  assert.equal(isPreviewHost('acresx.info'), false);
  for (const host of ['https://pr-12-acresx.cole793.workers.dev', 'https://1a2b3c4d-acresx.cole793.workers.dev']) {
    const env = makeEnv();
    const me = await jsonOf(await call(env, '/api/me', { host }));
    assert.deepEqual(me, { enabled: false, signedIn: false, reason: 'preview' });
    const r = await call(env, '/api/auth/request-link', { method: 'POST', host, origin: host, body: { email: 'a@example.com' } });
    assert.equal(r.status, 503);
    for (const [path, method, body] of [['/api/reports', 'POST', { title: 'x', summary: {} }], ['/api/branding', 'PUT', { name: 'Jane' }], ['/api/account/import', 'POST', {}], ['/api/auth/logout', 'POST', {}]]) {
      const w = await call(env, path, { method, host, origin: host, body, cookie: `__Host-acresx_session=${'b'.repeat(43)}` });
      assert.ok([200, 503].includes(w.status), `${path} answers without writing`);
    }
    assert.equal(env.MLS_DB.log.writes, 0);
  }
  assert.equal(emails.length, 0);
  // The production workers.dev name is allowed.
  const env = makeEnv();
  assert.equal((await jsonOf(await call(env, '/api/me', { host: 'https://acresx.cole793.workers.dev' }))).enabled, true);
});

test('ACCOUNTS_ALLOWED_HOSTS, when set, limits accounts to those hosts', async () => {
  const env = makeEnv({ ACCOUNTS_ALLOWED_HOSTS: 'acresx.info, www.acresx.info' });
  assert.equal((await jsonOf(await call(env, '/api/me', { host: 'https://acresx.info' }))).enabled, true);
  assert.equal((await jsonOf(await call(env, '/api/me', { host: 'https://other.example' }))).reason, 'host');
});

test('previews are uploaded with accounts switched off; migrations run only by hand from main', () => {
  const preview = readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
  assert.match(preview, /wrangler versions upload[^\n]*--var ACCOUNTS_ENABLED:false/);
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"ACCOUNTS_ENABLED": "true"/);
  assert.doesNotMatch(wrangler, /"RESEND_API_KEY"\s*:/, 'the key is a secret, never a var');
  const migrations = readFileSync(new URL('../.github/workflows/d1-migrations.yml', import.meta.url), 'utf8');
  const on = migrations.slice(migrations.indexOf('\non:'), migrations.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch/);
  assert.doesNotMatch(on, /push|pull_request|schedule/);
  assert.match(migrations, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(migrations, /npx wrangler d1 migrations apply acresx-mls --remote/);
  assert.match(migrations, /secrets\.CLOUDFLARE_API_TOKEN/);
});

test('the migration creates every account table and is safe to apply twice', () => {
  const db = fakeD1();
  db.sqlite.exec(readFileSync(new URL('../migrations/0002_accounts.sql', import.meta.url), 'utf8'));
  const names = db.rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(r => r.name);
  for (const t of ['branding', 'login_tokens', 'reports', 'saved_properties', 'sessions', 'share_links', 'users']) assert.ok(names.includes(t), t);
  assert.throws(() => db.sqlite.prepare("INSERT INTO users (id, email, created_at) VALUES ('u', 'Upper@Example.com', 1)").run(), /CHECK/);
});

// ---- Magic link

test('request-link answers the same for any address, stores only the token hash, and emails a plain 15-minute link', async () => {
  const env = makeEnv();
  await signIn(env, 'known@example.com');
  emails.length = 0;
  const a = await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'known@example.com' } });
  const b = await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'nobody-yet@example.com' } });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json(), 'no difference between a known and a new address');
  assert.equal(a.headers.get('Cache-Control'), 'no-store');
  assert.equal(emails.length, 2);
  const mail = emails[1];
  assert.equal(mail.headers.get('Authorization'), 'Bearer re_test_key');
  assert.equal(mail.body.from, 'AcresX <login@acresx.info>');
  assert.deepEqual(mail.body.to, ['nobody-yet@example.com']);
  assert.equal(mail.body.html, undefined, 'plain text only, no tracking pixel');
  assert.match(mail.body.text, /expires in 15 minutes/);
  assert.match(mail.body.text, /^Sign in to AcresX:\n\nhttps:\/\/acresx\.test\/api\/auth\/callback\?token=[A-Za-z0-9_-]{43}\n/);
  const token = tokenFromEmail(mail);
  const rows = env.MLS_DB.rows('SELECT * FROM login_tokens WHERE email = ?', 'nobody-yet@example.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, sha(token));
  assert.ok(!JSON.stringify(env.MLS_DB.rows('SELECT * FROM login_tokens')).includes(token), 'the raw token is never stored');
  assert.equal(rows[0].expires_at - rows[0].created_at, 15 * 60 * 1000);
  assert.match(rows[0].created_ip_hash, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(rows).includes('203.0.113.7'), 'the IP is stored only as a hash');
  // No user row until the link is used.
  assert.equal(env.MLS_DB.rows('SELECT * FROM users WHERE email = ?', 'nobody-yet@example.com').length, 0);
  const bad = await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'not-an-email' } });
  assert.equal(bad.status, 400);
});

test('request-link is limited to 5 per email and 10 per IP an hour, with the same answer', async () => {
  const env = makeEnv();
  const answers = [];
  for (let i = 0; i < 7; i++) answers.push(await (await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'busy@example.com' }, headers: { 'CF-Connecting-IP': `198.51.100.${i}` } })).text());
  assert.equal(new Set(answers).size, 1);
  assert.equal(emails.length, 5);
  assert.equal(env.MLS_DB.rows('SELECT * FROM login_tokens WHERE email = ?', 'busy@example.com').length, 5);
  emails.length = 0;
  for (let i = 0; i < 12; i++) await call(env, '/api/auth/request-link', { method: 'POST', body: { email: `agent${i}@example.com` }, headers: { 'CF-Connecting-IP': '192.0.2.50' } });
  assert.equal(emails.length, 10);
  // An hour later the address can ask again.
  env.MLS_DB.sqlite.prepare('UPDATE login_tokens SET created_at = created_at - 3700000').run();
  await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'busy@example.com' } });
  assert.equal(emails.length, 11);
});

test('the callback signs in once with a Secure HttpOnly SameSite=Lax 30-day cookie; reuse and expiry are refused', async () => {
  const env = makeEnv();
  await call(env, '/api/auth/request-link', { method: 'POST', body: { email: '  Jane@Example.COM ' } });
  const token = tokenFromEmail(emails[0]);
  const cb = await confirmLink(env, token, { headers: { 'User-Agent': 'Mozilla/5.0 '.repeat(40) } });
  assert.equal(cb.status, 303);
  assert.equal(cb.headers.get('Location'), '/?signedIn=1');
  assert.equal(cb.headers.get('Cache-Control'), 'no-store');
  const cookie = cb.headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-acresx_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  const sessionId = cookie.split(';')[0].split('=')[1];
  const sessions = env.MLS_DB.rows('SELECT * FROM sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id_hash, sha(sessionId), 'only the session hash is stored');
  assert.ok(sessions[0].user_agent.length <= 120);
  assert.equal(env.MLS_DB.rows('SELECT email FROM users')[0].email, 'jane@example.com', 'stored lower-cased');
  // Single use.
  const again = await confirmLink(env, token);
  assert.equal(again.headers.get('Location'), '/?signin=expired');
  assert.equal(again.headers.get('Set-Cookie'), null);
  // Expired.
  await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'jane@example.com' } });
  const late = tokenFromEmail(emails[1]);
  env.MLS_DB.sqlite.prepare('UPDATE login_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, sha(late));
  assert.equal((await confirmLink(env, late)).headers.get('Location'), '/?signin=expired');
  assert.equal((await confirmLink(env, 'short')).headers.get('Location'), '/?signin=invalid');
  // /api/me with the cookie.
  const me = await call(env, '/api/me', { cookie: cookie.split(';')[0] });
  assert.equal(me.headers.get('Cache-Control'), 'no-store');
  const body = await me.json();
  assert.equal(body.signedIn, true); assert.equal(body.user.email, 'jane@example.com');
  // A second sign-in reuses the same user.
  await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'JANE@example.com' } });
  await confirmLink(env, tokenFromEmail(emails[2]));
  assert.equal(env.MLS_DB.rows('SELECT * FROM users').length, 1);
});

test('opening the emailed link only shows a Continue button; the token is spent only by a same-origin POST', async () => {
  const env = makeEnv();
  await call(env, '/api/auth/request-link', { method: 'POST', body: { email: 'jane@example.com' } });
  const token = tokenFromEmail(emails[0]);
  const writes = env.MLS_DB.log.writes;
  // A link scanner (or the person) opening the link, several times.
  for (let i = 0; i < 3; i++) {
    const page = await call(env, `/api/auth/callback?token=${token}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('Set-Cookie'), null);
    assert.equal(page.headers.get('Cache-Control'), 'no-store');
    assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(page.headers.get('Content-Security-Policy'), /default-src 'none'.*form-action 'self'/);
    const html = await page.text();
    assert.match(html, /<form method="post" action="\/api\/auth\/callback"><input type="hidden" name="token" value="[A-Za-z0-9_-]{43}"><button type="submit">Continue to AcresX<\/button><\/form>/);
    assert.doesNotMatch(html, /<script/i);
  }
  assert.equal(env.MLS_DB.log.writes, writes, 'GET reads and writes nothing');
  assert.equal(env.MLS_DB.rows('SELECT used_at FROM login_tokens')[0].used_at, null);
  assert.equal(env.MLS_DB.rows('SELECT * FROM sessions').length, 0);
  const bad = await call(env, '/api/auth/callback?token=%22%3E%3Cscript%3E');
  assert.equal(bad.status, 400);
  assert.doesNotMatch(await bad.text(), /<script>|"><script/);
  // The POST must come from this site and carry the token as a form field.
  for (const opts of [{ origin: null }, { origin: 'https://evil.example' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]) {
    const r = await confirmLink(env, token, opts);
    assert.equal(r.status, 403);
  }
  assert.equal((await call(env, '/api/auth/callback', { method: 'POST', body: { token } })).headers.get('Location'), '/?signin=invalid', 'JSON is not accepted');
  assert.equal(env.MLS_DB.rows('SELECT used_at FROM login_tokens')[0].used_at, null, 'still unspent');
  const ok = await confirmLink(env, token);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('Location'), '/?signedIn=1');
  assert.match(ok.headers.get('Set-Cookie'), /^__Host-acresx_session=/);
  assert.notEqual(env.MLS_DB.rows('SELECT used_at FROM login_tokens')[0].used_at, null);
  assert.equal((await confirmLink(env, token)).headers.get('Location'), '/?signin=expired');
});

test('sessions slide: an older session is extended to 30 days and the cookie is re-sent', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const fresh = await call(env, '/api/me', { cookie });
  assert.equal(fresh.headers.get('Set-Cookie'), null, 'no refresh for a new session');
  env.MLS_DB.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() + 10 * 24 * 3600 * 1000);
  const old = await call(env, '/api/me', { cookie });
  assert.match(old.headers.get('Set-Cookie'), /Max-Age=2592000/);
  const [s] = env.MLS_DB.rows('SELECT expires_at FROM sessions');
  assert.ok(s.expires_at > Date.now() + SESSION_TTL_MS - 60000);
  env.MLS_DB.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await jsonOf(await call(env, '/api/me', { cookie }))).signedIn, false, 'an expired session is signed out');
});

test('logout deletes the session and clears the cookie', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const out = await call(env, '/api/auth/logout', { method: 'POST', cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('Set-Cookie'), /^__Host-acresx_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
  assert.equal(env.MLS_DB.rows('SELECT * FROM sessions').length, 0);
  assert.equal((await jsonOf(await call(env, '/api/me', { cookie }))).signedIn, false);
});

// ---- CSRF and size caps

test('state-changing requests from another site (or with no Origin) are refused before anything is written', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const before = env.MLS_DB.log.writes;
  const cases = [
    { origin: null }, { origin: 'https://evil.example' }, { origin: 'null' },
    { origin: ORIGIN, headers: { 'Sec-Fetch-Site': 'cross-site' } }
  ];
  for (const c of cases) {
    for (const [path, method, body] of [
      ['/api/auth/request-link', 'POST', { email: 'x@example.com' }], ['/api/auth/logout', 'POST', {}],
      ['/api/saved-properties/k1', 'PUT', { data: { name: 'x' } }], ['/api/saved-properties/k1', 'DELETE', undefined],
      ['/api/reports', 'POST', { title: 't', summary: {} }], ['/api/branding', 'PUT', { name: 'Jane' }],
      ['/api/account/import', 'POST', {}]
    ]) {
      const r = await call(env, path, { method, body, cookie, origin: c.origin, headers: c.headers });
      assert.equal(r.status, 403, `${method} ${path} from ${c.origin}`);
    }
  }
  assert.equal(env.MLS_DB.log.writes, before);
  assert.equal((await jsonOf(await call(env, '/api/me', { cookie }))).signedIn, true, 'the cross-site logout did nothing');
});

test('bodies are size-capped and must be JSON', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const big = await call(env, '/api/saved-properties/k1', { method: 'PUT', cookie, body: { data: { name: 'x', address: 'y'.repeat(300), extra: 'z'.repeat(10000) } } });
  assert.equal(big.status, 413);
  const huge = await call(env, '/api/reports', { method: 'POST', cookie, body: { title: 'big', summary: {}, snapshot: snapshot({ data: { blob: 'x'.repeat(950 * 1024) } }) } });
  assert.equal(huge.status, 413);
  const logo = await call(env, '/api/branding', { method: 'PUT', cookie, body: { name: 'Jane', logo: `data:image/png;base64,${'A'.repeat(210 * 1024)}` } });
  assert.equal(logo.status, 400, 'logo over 200 KB');
  const badLogo = await call(env, '/api/branding', { method: 'PUT', cookie, body: { name: 'Jane', logo: 'data:image/svg+xml;base64,PHN2Zz4=' } });
  assert.equal(badLogo.status, 400);
  const form = await call(env, '/api/reports', { method: 'POST', cookie, rawBody: 'title=x', contentType: 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const notJson = await call(env, '/api/reports', { method: 'POST', cookie, rawBody: '{nope' });
  assert.equal(notJson.status, 400);
  const badShape = await call(env, '/api/reports', { method: 'POST', cookie, body: { title: 'x', summary: {}, snapshot: { v: 2, html: '<script>' } } });
  assert.equal(badShape.status, 400);
  assert.equal(env.MLS_DB.rows('SELECT * FROM reports').length, 0);
});

test('account routes need a session', async () => {
  const env = makeEnv();
  for (const [path, method] of [['/api/saved-properties', 'GET'], ['/api/reports', 'GET'], ['/api/branding', 'GET'], ['/api/reports', 'POST']]) {
    const r = await call(env, path, { method, body: method === 'POST' ? { title: 'x' } : undefined, cookie: `__Host-acresx_session=${'c'.repeat(43)}` });
    assert.equal(r.status, 401, path);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
});

// ---- Saved properties, reports, branding

test('saved properties: put, list, update, delete; unknown and personal fields are not stored', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const key = 'WA:Spokane:35204.2729';
  const item = { key, name: 'Smith parcel', state: 'WA', county: 'Spokane', parcelId: '35204.2729', address: '123 Pine Rd', acreage: '5.00 acres', score: '7.4', location: { lat: 47.6, lng: -117.4 }, savedAt: '2026-11-15T10:00:00.000Z', OWNER_NAME: 'Private Person', owner_mailing: 'PO Box 1', html: '<b>x</b>' };
  const put = await call(env, `/api/saved-properties/${encodeURIComponent(key)}`, { method: 'PUT', cookie, body: { data: item } });
  assert.equal(put.status, 200);
  const list = await jsonOf(await call(env, '/api/saved-properties', { cookie }));
  assert.equal(list.items.length, 1);
  assert.deepEqual(list.items[0], { key, name: 'Smith parcel', state: 'WA', county: 'Spokane', parcelId: '35204.2729', address: '123 Pine Rd', acreage: '5.00 acres', score: '7.4', savedAt: '2026-11-15T10:00:00.000Z', location: { lat: 47.6, lng: -117.4 } });
  assert.ok(!JSON.stringify(env.MLS_DB.rows('SELECT * FROM saved_properties')).includes('Private Person'));
  await call(env, `/api/saved-properties/${encodeURIComponent(key)}`, { method: 'PUT', cookie, body: { data: { ...item, name: 'Renamed' } } });
  assert.equal((await jsonOf(await call(env, '/api/saved-properties', { cookie }))).items[0].name, 'Renamed');
  // Another user sees nothing.
  const other = await signIn(env, 'other@example.com');
  assert.equal((await jsonOf(await call(env, '/api/saved-properties', { cookie: other.cookie }))).items.length, 0);
  await call(env, `/api/saved-properties/${encodeURIComponent(key)}`, { method: 'DELETE', cookie });
  assert.equal((await jsonOf(await call(env, '/api/saved-properties', { cookie }))).items.length, 0);
});

test('reports: save with a snapshot, list without it, read back; personal fields are stripped; other users get 404', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const snap = snapshot({ data: { parcel: null, existingWell: { best: { evidence: { insideParcel: true }, owner_name: 'Private Person' } } } });
  const created = await jsonOf(await call(env, '/api/reports', { method: 'POST', cookie, body: { title: 'Smith parcel', summary: { name: 'Smith parcel', county: 'Spokane', parcelId: '12345.6789', score: '7.2' }, snapshot: snap } }));
  assert.match(created.id, /^[0-9a-f]{32}$/);
  const list = await jsonOf(await call(env, '/api/reports', { cookie }));
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].hasSnapshot, true);
  assert.equal(list.reports[0].summary.county, 'Spokane');
  assert.equal(list.reports[0].snapshot, undefined, 'the list does not carry the report data');
  const one = await jsonOf(await call(env, `/api/reports/${created.id}`, { cookie }));
  assert.equal(one.snapshot.f.address, '123 Pine Rd');
  assert.equal(one.snapshot.data.existingWell.best.owner_name, undefined);
  assert.ok(!JSON.stringify(env.MLS_DB.rows('SELECT * FROM reports')).includes('Private Person'));
  const other = await signIn(env, 'other@example.com');
  assert.equal((await call(env, `/api/reports/${created.id}`, { cookie: other.cookie })).status, 404);
  assert.equal((await call(env, `/api/reports/${created.id}`, { method: 'DELETE', cookie: other.cookie })).status, 404);
  assert.equal((await call(env, `/api/reports/${created.id}/share`, { method: 'POST', cookie: other.cookie })).status, 404);
});

test('branding: put, get, delete with the report-branding rules', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const put = await call(env, '/api/branding', { method: 'PUT', cookie, body: { branding: { name: ' Jane‮ Example ', brokerage: 'Example Realty', phone: '(509) 555-0100', email: 'jane@example.com', website: 'example.com', logo: PNG } } });
  assert.equal(put.status, 200);
  const got = (await jsonOf(await call(env, '/api/branding', { cookie }))).branding;
  assert.equal(got.name, 'Jane Example'); assert.equal(got.website, 'https://example.com'); assert.equal(got.logo, PNG);
  const bad = await call(env, '/api/branding', { method: 'PUT', cookie, body: { name: 'Jane', website: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).errors.website);
  await call(env, '/api/branding', { method: 'DELETE', cookie });
  assert.equal((await jsonOf(await call(env, '/api/branding', { cookie }))).branding, null);
});

// ---- Share links

test('share links: read-only report with branding, never the account email or id; revocation and deletion turn them off', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env, 'jane.private@example.com');
  await call(env, '/api/branding', { method: 'PUT', cookie, body: { name: 'Jane Example', brokerage: 'Example Realty', phone: '(509) 555-0100' } });
  const { id } = await jsonOf(await call(env, '/api/reports', { method: 'POST', cookie, body: { title: 'Smith parcel', summary: { name: 'Smith parcel' }, snapshot: snapshot() } }));
  const share = await call(env, `/api/reports/${id}/share`, { method: 'POST', cookie });
  assert.equal(share.status, 200);
  const { path, url } = await share.json();
  assert.match(path, /^\/r\/[A-Za-z0-9_-]{43}$/);
  assert.equal(url, `${ORIGIN}${path}`);
  const token = path.slice(3);
  assert.equal(env.MLS_DB.rows('SELECT * FROM share_links')[0].token_hash, sha(token));
  assert.ok(!JSON.stringify(env.MLS_DB.rows('SELECT * FROM share_links')).includes(token));
  const listed = await jsonOf(await call(env, '/api/reports', { cookie }));
  assert.equal(listed.reports[0].activeShares, 1);

  // Anyone with the link, no cookie.
  const shared = await call(env, `/api/shared/${token}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get('Cache-Control'), 'no-store');
  const text = await shared.text();
  const body = JSON.parse(text);
  assert.equal(body.readOnly, true);
  assert.equal(body.snapshot.f.address, '123 Pine Rd');
  assert.equal(body.branding.name, 'Jane Example');
  assert.ok(!text.includes('jane.private@example.com'), 'the account email is never in the shared view');
  const userId = env.MLS_DB.rows('SELECT id FROM users')[0].id;
  assert.ok(!text.includes(userId), 'nor the account id');
  // Read-only: there is no way to change the report through the link.
  for (const method of ['PUT', 'POST', 'DELETE']) assert.equal((await call(env, `/api/shared/${token}`, { method, body: {} })).status, 404);

  // The /r/<token> page.
  const page = await call(env, path);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Security-Policy'), /script-src 'self';/);
  assert.doesNotMatch(page.headers.get('Content-Security-Policy'), /script-src[^;]*unsafe-inline/);
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(page.headers.get('X-Robots-Tag'), /noindex/);
  assert.match(await page.text(), /shared-report\.js/);
  assert.equal((await call(env, '/r/not-a-token')).status, 404);

  // Revoke.
  const revoke = await jsonOf(await call(env, `/api/reports/${id}/share`, { method: 'DELETE', cookie }));
  assert.equal(revoke.revoked, 1);
  assert.equal((await call(env, `/api/shared/${token}`)).status, 404);
  // A new link works; deleting the report turns it off.
  const second = (await jsonOf(await call(env, `/api/reports/${id}/share`, { method: 'POST', cookie }))).path.slice(3);
  assert.equal((await call(env, `/api/shared/${second}`)).status, 200);
  await call(env, `/api/reports/${id}`, { method: 'DELETE', cookie });
  assert.equal((await call(env, `/api/shared/${second}`)).status, 404);
  assert.equal((await call(env, `/api/shared/${'x'.repeat(43)}`)).status, 404);
  assert.equal((await call(env, '/api/shared/short')).status, 404);
});

test('a report saved without a snapshot (imported from a browser) cannot be shared', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  const { id } = await jsonOf(await call(env, '/api/reports', { method: 'POST', cookie, body: { title: 'Old', summary: { name: 'Old' } } }));
  const r = await call(env, `/api/reports/${id}/share`, { method: 'POST', cookie });
  assert.equal(r.status, 409);
  assert.equal(env.MLS_DB.rows('SELECT * FROM share_links').length, 0);
});

test('shared links still read when the tables are missing: 503, not 500', async () => {
  const env = makeEnv({ MLS_DB: fakeD1({ migrate: false }) });
  assert.equal((await call(env, `/api/shared/${'a'.repeat(43)}`)).status, 503);
});

// ---- Import

test('import adds this browser\'s work once; the account wins on a clash', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  await call(env, '/api/saved-properties/WA%3ASpokane%3A1', { method: 'PUT', cookie, body: { data: { key: 'WA:Spokane:1', name: 'Account copy' } } });
  const work = {
    savedProperties: [{ key: 'WA:Spokane:1', name: 'Browser copy' }, { key: 'ID:Kootenai:2', name: 'Lake lot', state: 'ID', county: 'Kootenai', parcelId: '2' }, { name: 'no key' }],
    reports: [{ id: '1700000000000-abcde', name: 'Old report', state: 'WA', county: 'Spokane', parcelId: '1', generatedAt: '2026-10-01T00:00:00.000Z' }],
    branding: { name: 'Jane Example', brokerage: 'Example Realty' }
  };
  const r = await jsonOf(await call(env, '/api/account/import', { method: 'POST', cookie, body: work }));
  assert.equal(r.ok, true); assert.equal(r.branding, true); assert.equal(r.skipped, 1);
  const saved = (await jsonOf(await call(env, '/api/saved-properties', { cookie }))).items;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(x => x.key === 'WA:Spokane:1').name, 'Account copy');
  const reports = (await jsonOf(await call(env, '/api/reports', { cookie }))).reports;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].hasSnapshot, false);
  assert.equal(reports[0].createdAt, Date.parse('2026-10-01T00:00:00.000Z'));
  await call(env, '/api/account/import', { method: 'POST', cookie, body: { ...work, branding: { name: 'Someone Else' } } });
  assert.equal((await jsonOf(await call(env, '/api/reports', { cookie }))).reports.length, 1, 'the same report is not imported twice');
  assert.equal((await jsonOf(await call(env, '/api/branding', { cookie }))).branding.name, 'Jane Example');
});

test('a database failure answers 503 for that route only', async () => {
  const env = makeEnv();
  const { cookie } = await signIn(env);
  env.MLS_DB.sqlite.exec('DROP TABLE saved_properties');
  const r = await call(env, '/api/saved-properties', { cookie });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /temporarily unavailable/);
  assert.equal((await call(env, '/api/me', { cookie })).status, 200);
});
