// Email magic-link sign-in (owner choice, 2026-11-15).
//
//   POST /api/auth/request-link {email}  always the same 200 answer for any well-formed address
//                                         (no account enumeration); at most 5 links per email and
//                                         10 per IP per hour (counted from login_tokens; over the
//                                         limit nothing is sent, the answer is the same)
//   GET  /api/auth/callback?token=        single-use, 15-minute token -> session cookie -> /
//   POST /api/auth/logout
//   GET  /api/me                          { enabled, signedIn, user: { id, email } }
//
// Tokens and session ids are 32 random bytes; only their SHA-256 hashes are stored. The session
// cookie is __Host-acresx_session (HttpOnly, Secure, SameSite=Lax, Path=/), 30 days, extended
// (sliding) when less than 29 days remain. IPs are stored only as a salted hash, for the limit.
// The email is plain text with the link and its expiry; no HTML, no tracking.
import { upstreamFetch } from '../shared/upstream.js';
import { accountsDb, accountsStatus, noStore, unavailable, randomToken, randomId, sha256Hex, TOKEN_PATTERN } from './accounts-store.js';
import { readJson, normalizeEmail, LIMITS, BadRequest } from './accounts-validate.js';

export const SESSION_COOKIE = '__Host-acresx_session';
export const LOGIN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
export const RATE = Object.freeze({ perEmail: 5, perIp: 10, windowMs: 60 * 60 * 1000 });
export const LINK_SENT_MESSAGE = 'If that address can sign in, a sign-in link is on its way. It expires in 15 minutes.';
const DEFAULT_FROM = 'AcresX <login@acresx.info>';
const IP_SALT = 'acresx-accounts-ip-v1';

// ---- CSRF: state-changing account requests must come from this site

export function allowedOrigins(request, env) {
  const own = new URL(request.url).origin;
  const extra = String(env?.ACCOUNTS_APP_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  return new Set([own, ...extra]);
}
// null when the request is same-origin; otherwise the 403 answer.
export function refuseCrossSite(request, env) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (!origin || !allowedOrigins(request, env).has(origin) || (site && site !== 'same-origin')) {
    return noStore({ error: 'This request must come from the AcresX site.' }, 403);
  }
  return null;
}

// ---- Cookies

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}
export function sessionCookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
const clearCookie = () => sessionCookie('', 0);

// ---- Sessions

// { user: { id, email }, idHash, refresh: Set-Cookie value or '' } or null. Extends the session
// when less than 29 days remain.
export async function currentSession(request, db, now = Date.now()) {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw || !TOKEN_PATTERN.test(raw)) return null;
  const idHash = await sha256Hex(raw);
  const row = await db.prepare('SELECT s.user_id AS user_id, s.expires_at AS expires_at, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?').bind(idHash, now).first();
  if (!row) return null;
  let refresh = '';
  if (Number(row.expires_at) - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(now + SESSION_TTL_MS, idHash).run();
    refresh = sessionCookie(raw, SESSION_TTL_MS / 1000);
  }
  return { user: { id: row.user_id, email: row.email }, idHash, refresh };
}

// A JSON answer that also carries the sliding-session cookie when it was extended.
export function withSession(response, session) {
  if (session?.refresh) response.headers.append('Set-Cookie', session.refresh);
  return response;
}

// ---- Email (Resend HTTPS API)

export function loginEmail(link) {
  return {
    subject: 'Your AcresX sign-in link',
    text: `Sign in to AcresX:\n\n${link}\n\nThis link expires in 15 minutes and works once.\n\nIf you did not ask to sign in, ignore this email.\n`
  };
}
async function sendLoginEmail(env, to, link) {
  const { subject, text } = loginEmail(link);
  const response = await upstreamFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.ACCOUNTS_EMAIL_FROM || DEFAULT_FROM, to: [to], subject, text }),
    timeoutMs: 10000, label: 'emails', agency: 'Resend'
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
}

function appOrigin(request, env) {
  const configured = String(env?.ACCOUNTS_APP_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');
  return configured || new URL(request.url).origin;
}
const clientIp = request => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || '';

// ---- Routes

async function requestLink(request, env, ctx) {
  const refused = refuseCrossSite(request, env);
  if (refused) return refused;
  const { status, db } = await accountsDb(env, request);
  if (!db) return unavailable(status);
  let body;
  try { body = await readJson(request, LIMITS.authBody); } catch (e) { return noStore({ error: e.message }, e.status || 400); }
  const email = normalizeEmail(body?.email);
  if (!email) return noStore({ error: 'Enter an email address like name@example.com.' }, 400);
  const same = noStore({ ok: true, message: LINK_SENT_MESSAGE });
  const now = Date.now();
  const ipHash = (await sha256Hex(`${IP_SALT}:${clientIp(request)}`)).slice(0, 32);
  const since = now - RATE.windowMs;
  const [byEmail, byIp] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?').bind(email, since).first(),
    db.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE created_ip_hash = ? AND created_at > ?').bind(ipHash, since).first()
  ]);
  if (Number(byEmail?.n) >= RATE.perEmail || Number(byIp?.n) >= RATE.perIp) {
    console.log(JSON.stringify({ evt: 'accounts', action: 'request-link', limited: true }));
    return same;
  }
  const token = randomToken();
  await db.batch([
    db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - RATE.windowMs * 24),
    db.prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at, used_at, created_ip_hash) VALUES (?, ?, ?, ?, NULL, ?)').bind(await sha256Hex(token), email, now, now + LOGIN_TTL_MS, ipHash)
  ]);
  const link = `${appOrigin(request, env)}/api/auth/callback?token=${token}`;
  const send = sendLoginEmail(env, email, link).catch(error => console.warn(JSON.stringify({ evt: 'accounts', action: 'send-email', ok: false, err: String(error?.message || error) })));
  if (ctx?.waitUntil) ctx.waitUntil(send); else await send;
  return same;
}

function redirect(location, cookie) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

async function callback(request, env) {
  const { db } = await accountsDb(env, request);
  if (!db) return redirect('/?signin=unavailable');
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!TOKEN_PATTERN.test(token)) return redirect('/?signin=invalid');
  const now = Date.now();
  const hash = await sha256Hex(token);
  // Single use: only the request that flips used_at from NULL gets a session.
  const claimed = await db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').bind(now, hash, now).run();
  if (Number(claimed?.meta?.changes) !== 1) return redirect('/?signin=expired');
  const row = await db.prepare('SELECT email FROM login_tokens WHERE token_hash = ?').bind(hash).first();
  const email = normalizeEmail(row?.email);
  if (!email) return redirect('/?signin=invalid');
  await db.prepare('INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at').bind(randomId(), email, now, now).run();
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  const sessionId = randomToken();
  const agent = String(request.headers.get('User-Agent') || '').slice(0, 120);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)').bind(await sha256Hex(sessionId), user.id, now + SESSION_TTL_MS, now, agent)
  ]);
  return redirect('/?signedIn=1', sessionCookie(sessionId, SESSION_TTL_MS / 1000));
}

async function logout(request, env) {
  const refused = refuseCrossSite(request, env);
  if (refused) return refused;
  const { db } = await accountsDb(env, request);
  const raw = readCookie(request, SESSION_COOKIE);
  if (db && raw && TOKEN_PATTERN.test(raw)) await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(raw)).run();
  return noStore({ ok: true, signedIn: false }, 200, { 'Set-Cookie': clearCookie() });
}

async function me(request, env) {
  const { status, db } = await accountsDb(env, request);
  if (!db) return noStore({ enabled: false, signedIn: false, reason: status.reason });
  const session = await currentSession(request, db);
  if (!session) return noStore({ enabled: true, signedIn: false });
  return withSession(noStore({ enabled: true, signedIn: true, user: session.user }), session);
}

export async function handleAuthRoutes(request, env, ctx, url) {
  const { pathname } = url;
  const m = request.method;
  if (pathname === '/api/auth/request-link' && m === 'POST') return requestLink(request, env, ctx);
  if (pathname === '/api/auth/callback' && m === 'GET') return callback(request, env);
  if (pathname === '/api/auth/logout' && m === 'POST') return logout(request, env);
  if (pathname === '/api/me' && m === 'GET') return me(request, env);
  return null;
}

export { accountsStatus, BadRequest };
