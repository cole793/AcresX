// Accounts: when the feature is on, the D1 handle, and the small crypto helpers the account
// routes share (src/services/accounts-auth.js, accounts-data.js).
//
// Accounts are ON only when every one of these holds; otherwise every account route answers
// "unavailable" and the browser keeps using localStorage exactly as before:
//   1. env.ACCOUNTS_ENABLED === 'true'. wrangler.jsonc sets it for the Worker, and
//      .github/workflows/preview.yml overrides it to "false" on every preview upload.
//   2. The request is not on a preview host. Previews share the live D1 database (CLAUDE.md), so
//      writes from them are refused even if the flag were somehow on: on *.workers.dev only the
//      production name `acresx.<subdomain>.workers.dev` is allowed; version and alias previews
//      are `<id or alias>-acresx.<subdomain>.workers.dev`. ACCOUNTS_ALLOWED_HOSTS (optional,
//      comma-separated) narrows it further to exact host names.
//   3. The RESEND_API_KEY secret exists (sign-in emails cannot be sent without it).
//   4. The MLS_DB binding exists and migrations/0002_accounts.sql has been applied (all seven
//      tables are present).
//
// The only way an account route gets a database handle it may write to is accountsDb(), which
// applies all four checks. sharedDb() is for the read-only shared-report view and needs only
// the tables.

export const ACCOUNT_TABLES = Object.freeze(['users', 'login_tokens', 'sessions', 'saved_properties', 'reports', 'branding', 'share_links']);
const WORKER_NAME = 'acresx';

// Per isolate and per database binding: true once the tables were seen; a miss is re-checked
// after a minute, so applying the migration takes effect without a deploy.
const tableCheck = new WeakMap();
const RECHECK_MS = 60_000;

export function isPreviewHost(hostname, workerName = WORKER_NAME) {
  const host = String(hostname || '').toLowerCase();
  if (!host.endsWith('.workers.dev')) return false;
  return host.split('.')[0] !== workerName;
}

function hostAllowed(hostname, env) {
  const list = String(env?.ACCOUNTS_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(String(hostname || '').toLowerCase());
}

export async function tablesPresent(db) {
  if (!db || typeof db.prepare !== 'function') return false;
  const seen = tableCheck.get(db);
  if (seen && (seen.ok || Date.now() - seen.at < RECHECK_MS)) return seen.ok;
  let ok = false;
  try {
    const placeholders = ACCOUNT_TABLES.map(() => '?').join(',');
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`).bind(...ACCOUNT_TABLES).first();
    ok = Number(row?.n) === ACCOUNT_TABLES.length;
  } catch { ok = false; }
  tableCheck.set(db, { ok, at: Date.now() });
  return ok;
}

// { enabled, reason } for this request. reason: 'off' | 'preview' | 'host' | 'email' | 'database'.
export async function accountsStatus(env, request) {
  const hostname = (() => { try { return new URL(request.url).hostname; } catch { return ''; } })();
  if (String(env?.ACCOUNTS_ENABLED || '') !== 'true') return { enabled: false, reason: 'off' };
  if (isPreviewHost(hostname, env?.ACCOUNTS_WORKER_NAME || WORKER_NAME)) return { enabled: false, reason: 'preview' };
  if (!hostAllowed(hostname, env)) return { enabled: false, reason: 'host' };
  if (!env?.RESEND_API_KEY) return { enabled: false, reason: 'email' };
  if (!(await tablesPresent(env?.MLS_DB))) return { enabled: false, reason: 'database' };
  return { enabled: true, reason: '' };
}

// The writable database, or null when accounts are off for this request.
export async function accountsDb(env, request) {
  const status = await accountsStatus(env, request);
  return { status, db: status.enabled ? env.MLS_DB : null };
}

// Read-only use (GET /api/shared/:token). Never used for a write.
export async function sharedDb(env) {
  return (await tablesPresent(env?.MLS_DB)) ? env.MLS_DB : null;
}

// ---- Crypto helpers (Web Crypto; the same in Workers and Node 22)

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// A 32-byte random token in base64url is 43 characters.
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// JSON answer that is never cached (every account answer).
export function noStore(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

export const unavailable = status => noStore({ enabled: false, reason: status?.reason || 'off', error: 'Accounts are not available yet. Your work is saved in this browser.' }, 503);
