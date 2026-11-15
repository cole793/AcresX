// Account data: saved properties, reports, report branding and read-only share links.
//
//   GET    /api/saved-properties              { items: [...] }
//   PUT    /api/saved-properties/:key         { data }        upsert one (key = state:county:parcel)
//   DELETE /api/saved-properties/:key
//   GET    /api/reports                       { reports: [{ id, title, createdAt, summary, hasSnapshot, activeShares }] }
//   POST   /api/reports                       { title, summary, snapshot? } -> { id }
//   GET    /api/reports/:id                   { id, title, createdAt, summary, snapshot }
//   DELETE /api/reports/:id                   also turns its share links off
//   POST   /api/reports/:id/share             -> { path: '/r/<token>', url }  (new link each time)
//   DELETE /api/reports/:id/share             turns every link for the report off
//   GET    /api/branding  PUT /api/branding  DELETE /api/branding
//   POST   /api/account/import                { savedProperties, reports, branding } (first sign-in)
//   GET    /api/shared/:token                 read-only report + the agent's branding; never the
//                                             account email or id
//
// Every route but /api/shared needs a signed-in session and the accounts flag (accounts-store.js);
// state-changing ones also need a same-origin Origin header. Answers are never cached.
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { accountsDb, sharedDb, noStore, unavailable, randomToken, randomId, sha256Hex, TOKEN_PATTERN } from './accounts-store.js';
import { refuseCrossSite, currentSession, withSession } from './accounts-auth.js';
import { readJson, LIMITS, BadRequest, validKey, cleanSavedProperty, cleanReport, cleanBranding, storedBranding, cleanSummary } from './accounts-validate.js';

const parse = json => { try { return JSON.parse(json); } catch { return null; } };
const notFound = () => noStore({ error: 'Not found.' }, 404);
const REPORT_ID = /^[0-9a-f]{32}$/;

// ---- Saved properties

async function listSaved(db, user) {
  const { results = [] } = await db.prepare('SELECT key, data_json, updated_at FROM saved_properties WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all();
  return noStore({ items: results.map(r => parse(r.data_json)).filter(Boolean) });
}
async function putSaved(request, db, user, rawKey) {
  const key = validKey(rawKey);
  if (!key) throw new BadRequest('That saved-property key is not valid.');
  const body = await readJson(request, LIMITS.savedPropertyBytes + 1024);
  const json = cleanSavedProperty(body?.data, key);
  const exists = await db.prepare('SELECT 1 AS x FROM saved_properties WHERE user_id = ? AND key = ?').bind(user.id, key).first();
  if (!exists) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM saved_properties WHERE user_id = ?').bind(user.id).first();
    if (Number(count?.n) >= LIMITS.savedProperties) throw new BadRequest(`You can keep up to ${LIMITS.savedProperties} saved properties. Remove some first.`, 409);
  }
  await db.prepare('INSERT INTO saved_properties (user_id, key, data_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at').bind(user.id, key, json, Date.now()).run();
  return noStore({ ok: true, item: parse(json) });
}
async function deleteSaved(db, user, rawKey) {
  const key = validKey(rawKey);
  if (!key) throw new BadRequest('That saved-property key is not valid.');
  await db.prepare('DELETE FROM saved_properties WHERE user_id = ? AND key = ?').bind(user.id, key).run();
  return noStore({ ok: true });
}

// ---- Reports

async function listReports(db, user) {
  const { results = [] } = await db.prepare(`SELECT r.id AS id, r.title AS title, r.created_at AS created_at,
      json_extract(r.data_json, '$.summary') AS summary, json_type(r.data_json, '$.snapshot') AS snapshot_type,
      (SELECT COUNT(*) FROM share_links s WHERE s.report_id = r.id AND s.revoked_at IS NULL) AS active_shares
    FROM reports r WHERE r.user_id = ? ORDER BY r.created_at DESC`).bind(user.id).all();
  return noStore({ reports: results.map(r => ({ id: r.id, title: r.title, createdAt: r.created_at, summary: parse(r.summary) || {}, hasSnapshot: r.snapshot_type === 'object', activeShares: Number(r.active_shares) || 0 })) });
}
async function createReport(request, db, user) {
  const { title, json } = cleanReport(await readJson(request, LIMITS.reportBytes + 4096));
  const count = await db.prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id = ?').bind(user.id).first();
  if (Number(count?.n) >= LIMITS.reports) throw new BadRequest(`You can keep up to ${LIMITS.reports} reports. Remove some first.`, 409);
  const id = randomId();
  await db.prepare('INSERT INTO reports (id, user_id, title, data_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, title, json, Date.now()).run();
  return noStore({ ok: true, id });
}
async function ownReport(db, user, id) {
  if (!REPORT_ID.test(id)) return null;
  return db.prepare('SELECT id, title, data_json, created_at FROM reports WHERE id = ? AND user_id = ?').bind(id, user.id).first();
}
async function getReport(db, user, id) {
  const row = await ownReport(db, user, id);
  if (!row) return notFound();
  const data = parse(row.data_json) || {};
  return noStore({ id: row.id, title: row.title, createdAt: row.created_at, summary: data.summary || {}, snapshot: data.snapshot || null });
}
async function deleteReport(db, user, id) {
  const row = await ownReport(db, user, id);
  if (!row) return notFound();
  await db.batch([
    db.prepare('DELETE FROM share_links WHERE report_id = ? AND user_id = ?').bind(id, user.id),
    db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').bind(id, user.id)
  ]);
  return noStore({ ok: true });
}
async function shareReport(request, db, user, id) {
  const row = await ownReport(db, user, id);
  if (!row) return notFound();
  if (!parse(row.data_json)?.snapshot) throw new BadRequest('This report was saved before share links existed. Generate it again to share it.', 409);
  const token = randomToken();
  await db.prepare('INSERT INTO share_links (token_hash, report_id, user_id, created_at, revoked_at, expires_at) VALUES (?, ?, ?, ?, NULL, NULL)').bind(await sha256Hex(token), id, user.id, Date.now()).run();
  const path = `/r/${token}`;
  return noStore({ ok: true, path, url: `${new URL(request.url).origin}${path}` });
}
async function revokeShares(db, user, id) {
  const row = await ownReport(db, user, id);
  if (!row) return notFound();
  const r = await db.prepare('UPDATE share_links SET revoked_at = ? WHERE report_id = ? AND user_id = ? AND revoked_at IS NULL').bind(Date.now(), id, user.id).run();
  return noStore({ ok: true, revoked: Number(r?.meta?.changes) || 0 });
}

// ---- Branding

async function getBranding(db, user) {
  const row = await db.prepare('SELECT data_json FROM branding WHERE user_id = ?').bind(user.id).first();
  return noStore({ branding: row ? storedBranding(row.data_json) : null });
}
async function putBranding(request, db, user) {
  const body = await readJson(request, LIMITS.brandingBytes);
  const branding = { ...cleanBranding(body?.branding ?? body), updatedAt: new Date().toISOString() };
  await db.prepare('INSERT INTO branding (user_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at').bind(user.id, JSON.stringify(branding), Date.now()).run();
  return noStore({ ok: true, branding });
}
async function deleteBranding(db, user) {
  await db.prepare('DELETE FROM branding WHERE user_id = ?').bind(user.id).run();
  return noStore({ ok: true, branding: null });
}

// ---- Import this browser's data (first sign-in). The account wins on a clash: existing saved
// properties and branding are kept; a report already imported (same localId) is skipped.

async function importLocal(request, db, user) {
  const body = await readJson(request, LIMITS.importBytes);
  const now = Date.now();
  const saved = (Array.isArray(body?.savedProperties) ? body.savedProperties : []).slice(0, LIMITS.savedProperties);
  const reports = (Array.isArray(body?.reports) ? body.reports : []).slice(0, LIMITS.reports);
  const statements = [];
  let skipped = 0;
  const savedCount = Number((await db.prepare('SELECT COUNT(*) AS n FROM saved_properties WHERE user_id = ?').bind(user.id).first())?.n) || 0;
  let room = LIMITS.savedProperties - savedCount;
  for (const item of saved) {
    const key = validKey(item?.key);
    if (!key || room <= 0) { skipped++; continue; }
    let json;
    try { json = cleanSavedProperty(item, key); } catch { skipped++; continue; }
    statements.push(db.prepare('INSERT INTO saved_properties (user_id, key, data_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO NOTHING').bind(user.id, key, json, now));
    room--;
  }
  const existing = await db.prepare("SELECT json_extract(data_json, '$.summary.localId') AS local_id FROM reports WHERE user_id = ?").bind(user.id).all();
  const known = new Set((existing.results || []).map(r => r.local_id).filter(Boolean));
  let reportRoom = LIMITS.reports - (existing.results || []).length;
  for (const item of reports) {
    const summary = cleanSummary({ ...item, localId: item?.id });
    if (!summary.localId || known.has(summary.localId) || reportRoom <= 0) { skipped++; continue; }
    let clean;
    try { clean = cleanReport({ title: item?.name, summary }); } catch { skipped++; continue; }
    known.add(summary.localId);
    const created = Date.parse(item?.generatedAt);
    statements.push(db.prepare('INSERT INTO reports (id, user_id, title, data_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId(), user.id, clean.title, clean.json, Number.isFinite(created) ? created : now));
    reportRoom--;
  }
  let brandingImported = false;
  if (body?.branding) {
    try {
      const branding = cleanBranding(body.branding);
      statements.push(db.prepare('INSERT INTO branding (user_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(user.id, JSON.stringify(branding), now));
      brandingImported = true;
    } catch { skipped++; }
  }
  if (statements.length) await db.batch(statements);
  return noStore({ ok: true, savedProperties: saved.length, reports: reports.length, branding: brandingImported, skipped });
}

// ---- Shared report (read-only, no session)

async function sharedReport(env, token) {
  const db = await sharedDb(env);
  const gone = noStore({ error: 'This shared report link is not valid or was turned off.' }, 404);
  if (!db) return noStore({ error: 'Shared reports are not available yet.' }, 503);
  if (!TOKEN_PATTERN.test(token)) return gone;
  const now = Date.now();
  const row = await db.prepare(`SELECT r.title AS title, r.created_at AS created_at, r.data_json AS data_json, b.data_json AS branding_json
    FROM share_links s JOIN reports r ON r.id = s.report_id AND r.user_id = s.user_id
    LEFT JOIN branding b ON b.user_id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)`).bind(await sha256Hex(token), now).first();
  if (!row) return gone;
  const data = parse(row.data_json) || {};
  if (!data.snapshot) return gone;
  // Only the report facts and the agent's report branding (what the agent chose to print).
  return noStore(withoutPersonalFields({ readOnly: true, title: row.title, createdAt: row.created_at, snapshot: data.snapshot, branding: row.branding_json ? storedBranding(row.branding_json) : null }), 200, { 'X-Robots-Tag': 'noindex' });
}

// ---- Router

const routes = [
  ['GET', /^\/api\/saved-properties$/, (r, db, u) => listSaved(db, u)],
  ['PUT', /^\/api\/saved-properties\/([^/]+)$/, (r, db, u, m) => putSaved(r, db, u, m[1])],
  ['DELETE', /^\/api\/saved-properties\/([^/]+)$/, (r, db, u, m) => deleteSaved(db, u, m[1])],
  ['GET', /^\/api\/reports$/, (r, db, u) => listReports(db, u)],
  ['POST', /^\/api\/reports$/, (r, db, u) => createReport(r, db, u)],
  ['GET', /^\/api\/reports\/([^/]+)$/, (r, db, u, m) => getReport(db, u, m[1])],
  ['DELETE', /^\/api\/reports\/([^/]+)$/, (r, db, u, m) => deleteReport(db, u, m[1])],
  ['POST', /^\/api\/reports\/([^/]+)\/share$/, (r, db, u, m) => shareReport(r, db, u, m[1])],
  ['DELETE', /^\/api\/reports\/([^/]+)\/share$/, (r, db, u, m) => revokeShares(db, u, m[1])],
  ['GET', /^\/api\/branding$/, (r, db, u) => getBranding(db, u)],
  ['PUT', /^\/api\/branding$/, (r, db, u) => putBranding(r, db, u)],
  ['DELETE', /^\/api\/branding$/, (r, db, u) => deleteBranding(db, u)],
  ['POST', /^\/api\/account\/import$/, (r, db, u) => importLocal(r, db, u)]
];
const ACCOUNT_PATH = /^\/api\/(saved-properties|reports|branding|account)(\/|$)/;

export async function handleDataRoutes(request, env, ctx, url) {
  const shared = url.pathname.match(/^\/api\/shared\/([^/]+)$/);
  if (shared && request.method === 'GET') return sharedReport(env, shared[1]);
  if (!ACCOUNT_PATH.test(url.pathname)) return null;
  let match = null, handler = null;
  for (const [method, pattern, fn] of routes) {
    const m = url.pathname.match(pattern);
    if (m && method === request.method) { match = m; handler = fn; break; }
  }
  if (!handler) return noStore({ error: 'Not found.' }, 404);
  if (request.method !== 'GET') { const refused = refuseCrossSite(request, env); if (refused) return refused; }
  const { status, db } = await accountsDb(env, request);
  if (!db) return unavailable(status);
  const session = await currentSession(request, db);
  if (!session) return noStore({ error: 'Sign in to use your AcresX account.', signedIn: false }, 401);
  let decoded;
  try { decoded = match.map((part, i) => (i ? decodeURIComponent(part) : part)); } catch { return noStore({ error: 'That address is not valid.' }, 400); }
  try { return withSession(await handler(request, db, session.user, decoded), session); }
  catch (error) {
    if (error instanceof BadRequest) return withSession(noStore({ error: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status), session);
    throw error;
  }
}
