// Request validation for the account routes: body size caps, field allowlists and the same
// branding rules as public/report-branding.js. Everything stored goes through
// withoutPersonalFields() too, so no owner or mailing field is ever written (owner decision,
// 2026-10-29).
import { withoutPersonalFields } from '../shared/personal-fields.js';

export const LIMITS = Object.freeze({
  authBody: 2 * 1024,
  savedPropertyBytes: 8 * 1024,
  savedProperties: 500,
  reportBytes: 900 * 1024,
  reports: 200,
  brandingBytes: 260 * 1024,
  logoChars: 200 * 1024,
  importBytes: 2 * 1024 * 1024,
  title: 120,
  key: 200,
  text: 300
});

export class BadRequest extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// The body as parsed JSON, refusing anything over maxBytes or not JSON.
export async function readJson(request, maxBytes) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) throw new BadRequest('Send JSON (Content-Type: application/json).', 415);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BadRequest('That is too large to save.', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BadRequest('That is too large to save.', 413);
  try { return JSON.parse(text); } catch { throw new BadRequest('The request body is not valid JSON.'); }
}

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const byteLength = s => new TextEncoder().encode(s).length;
// eslint-disable-next-line no-control-regex
const CONTROL_CLASS = '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]';
const CONTROL = new RegExp(CONTROL_CLASS, 'g');
const HAS_CONTROL = new RegExp(CONTROL_CLASS);
export const cleanText = (value, max = LIMITS.text) => String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const EMAIL = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
// Lower-cased, trimmed email, or '' when it is not an address.
export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email) || !/\.[a-z]{2,}$/.test(email)) return '';
  return email;
}

// ---- Saved properties (the entries public/property-actions.js keeps)

const PROPERTY_FIELDS = ['key', 'name', 'state', 'county', 'parcelId', 'address', 'acreage', 'score', 'savedAt'];
export function validKey(key) {
  const k = String(key ?? '');
  return k.length > 0 && k.length <= LIMITS.key && !HAS_CONTROL.test(k) ? k : '';
}
function location(value) {
  if (!isObject(value)) return null;
  const lat = Number(value.lat), lng = Number(value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
export function cleanSavedProperty(input, key) {
  if (!isObject(input)) throw new BadRequest('A saved property must be an object.');
  const out = {};
  for (const f of PROPERTY_FIELDS) if (input[f] !== undefined && input[f] !== null) out[f] = cleanText(input[f], f === 'key' ? LIMITS.key : LIMITS.text);
  out.key = key;
  const loc = location(input.location);
  if (loc) out.location = loc;
  const json = JSON.stringify(withoutPersonalFields(out));
  if (byteLength(json) > LIMITS.savedPropertyBytes) throw new BadRequest('That saved property is too large.', 413);
  return json;
}

// ---- Reports: { title, summary, snapshot? }

const SUMMARY_FIELDS = ['name', 'state', 'county', 'parcelId', 'address', 'acreage', 'score', 'key', 'generatedAt', 'localId'];
export function cleanSummary(input) {
  const s = isObject(input) ? input : {};
  const out = {};
  for (const f of SUMMARY_FIELDS) if (s[f] !== undefined && s[f] !== null && s[f] !== '') out[f] = cleanText(s[f]);
  const loc = location(s.location);
  if (loc) out.location = loc;
  return out;
}
// The report snapshot from public/property-report-v2.js snapshot(): { v: 1, name, generatedAt,
// f, score, data }. It is facts AcresX computed, rendered client-side by the same renderer; never
// HTML. The shape is checked here and the renderer escapes every value.
export function cleanSnapshot(input) {
  if (input === undefined || input === null) return null;
  if (!isObject(input) || input.v !== 1 || !isObject(input.f) || !isObject(input.score) || !isObject(input.data)) throw new BadRequest('The report data is not in the expected format.');
  return withoutPersonalFields(input);
}
export function cleanReport(input) {
  if (!isObject(input)) throw new BadRequest('A report must be an object.');
  const summary = cleanSummary(input.summary);
  const title = cleanText(input.title || summary.name || summary.address || 'Property report', LIMITS.title) || 'Property report';
  const snapshot = cleanSnapshot(input.snapshot);
  const json = JSON.stringify(snapshot ? { summary, snapshot } : { summary });
  if (byteLength(json) > LIMITS.reportBytes) throw new BadRequest('That report is too large to save.', 413);
  return { title, json };
}

// ---- Branding (the same rules as public/report-branding.js validate())

const BRAND_LIMITS = Object.freeze({ name: 80, brokerage: 100, phone: 30, email: 120, website: 200, license: 40 });
const PHONE = /^\+?[0-9().\-\s]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;
const LOGO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
function website(v) {
  if (!v) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let u;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
  const out = u.href.replace(/\/$/, '');
  return out.length <= BRAND_LIMITS.website ? out : null;
}
// { branding, errors }. A branding needs at least a name; null branding means "none".
export function cleanBranding(input) {
  if (!isObject(input)) throw new BadRequest('Branding must be an object.');
  const b = {}, errors = {};
  for (const k of Object.keys(BRAND_LIMITS)) b[k] = cleanText(input[k], BRAND_LIMITS[k]);
  if (b.email && !(EMAIL.test(b.email) && /\.[A-Za-z]{2,}$/.test(b.email))) errors.email = 'Enter an email like name@example.com.';
  if (b.phone) { const d = b.phone.replace(/(?:x|ext\.?)\s*\d+$/i, '').replace(/\D/g, ''); if (!PHONE.test(b.phone) || d.length < 7 || d.length > 15) errors.phone = 'Enter a phone number with 7 to 15 digits.'; }
  if (b.website) { const w = website(b.website); if (w === null) errors.website = 'Enter a web address starting with http:// or https://.'; else b.website = w; }
  const logo = input.logo ? String(input.logo) : '';
  if (logo && !(logo.length <= LIMITS.logoChars && LOGO.test(logo))) errors.logo = 'The logo must be a PNG or JPG under 200 KB.';
  b.logo = errors.logo ? '' : logo;
  if (!b.name) errors.name = 'Add your name so the report can say who prepared it.';
  if (Object.keys(errors).length) { const e = new BadRequest(Object.values(errors)[0]); e.errors = errors; throw e; }
  if (input.updatedAt) b.updatedAt = cleanText(input.updatedAt, 40);
  return b;
}
// Stored branding read back for display: anything invalid is dropped, never thrown.
export function storedBranding(json) {
  try { return cleanBranding(JSON.parse(json)); } catch { return null; }
}
