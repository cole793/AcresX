// Shared client and parsing helpers for the county treasurer/assessor HTML pages the property
// tax layer reads (src/services/property-tax.js and the src/counties/*-tax.js adapters).
//
// Rules (owner decision, 2026-11-15):
// - One GET per page, through the shared upstream client (per-host cap, timeout covering the
//   body, one log line without the query string), with an honest User-Agent and a size cap.
//   No retry: a treasurer site is asked once per lookup (Yellowstone's robots.txt asks for a
//   10 s crawl delay), and found answers are cached for 7 days by the service.
// - A 403/429, or a page that looks like a bot challenge or captcha, is "blocked": the layer
//   stops and degrades to a "View tax bill" link. Nothing tries to get past it.
// - Pages are never returned, stored or logged. Adapters read only named labels and tables with
//   strict patterns, and copy amounts, years and rates; owner, taxpayer, mailing, receipt,
//   statement and grantor/grantee details are never read.
import { upstreamFetch } from './upstream.js';

export const TAX_USER_AGENT = 'AcresX (https://acresx.info)';
export const TAX_PAGE_TIMEOUT_MS = 10000;
export const TAX_PAGE_MAX_BYTES = 1_500_000;

export class TaxPageError extends Error {
  // kind: 'blocked' (403/429/challenge) | 'unavailable' (timeout, network, 5xx, other HTTP, too large)
  constructor(message, kind) { super(message); this.name = 'TaxPageError'; this.kind = kind; }
}

// Bot-challenge and captcha pages (Cloudflare, reCAPTCHA, hCaptcha, Incapsula, Akamai, generic).
const CHALLENGE = /cf-chl-|cf_chl_opt|challenge-platform|<title>\s*(just a moment|attention required|access denied|request rejected)|g-recaptcha|recaptcha\/api|h-captcha|hcaptcha\.com|captcha|_incapsula_resource|are you a (human|robot)/i;
export function isChallengePage(text) {
  return CHALLENGE.test(String(text || ''));
}

// GET url -> page text, or throws TaxPageError.
export async function fetchTaxPage(url, { agency, label, maxBytes = TAX_PAGE_MAX_BYTES, timeoutMs = TAX_PAGE_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await upstreamFetch(url, {
      method: 'GET', headers: { 'User-Agent': TAX_USER_AGENT, Accept: 'text/html' },
      timeoutMs, maxBytes, label, agency
    });
  } catch (error) {
    const why = error?.name === 'AbortError' ? 'timed out' : /larger than/.test(String(error?.message)) ? 'page too large' : 'unreachable';
    throw new TaxPageError(`${agency} ${why}`, 'unavailable');
  }
  if (response.status === 403 || response.status === 429) throw new TaxPageError(`${agency} refused the request (${response.status})`, 'blocked');
  if (response.status < 200 || response.status > 299) throw new TaxPageError(`${agency} returned ${response.status}`, 'unavailable');
  const text = await response.text();
  if (isChallengePage(text)) throw new TaxPageError(`${agency} showed a bot check`, 'blocked');
  return text;
}

// ---- Parsing helpers (strict; they return null instead of guessing).

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#36;': '$' };
// Cell text: tags removed, a few entities decoded, whitespace collapsed.
export function cellText(html) {
  return String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|#39|#36);/g, m => ENTITIES[m]).replace(/\s+/g, ' ').trim();
}

// "$1,877.65" | "1,877.65" | "178.82" -> 1877.65; anything else (words, blank, negative) -> null.
export function money(text) {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const n = Number(`${m[1].replace(/,/g, '')}${m[2] || ''}`);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// "11/14/2026" -> "2026-11-14"; else null.
export function usDate(text) {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(String(text ?? ''));
  if (!m) return null;
  const [, mo, d, y] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// The inner HTML of the element with exactly this id (span, td, table, ...), or null. The element
// must not nest another element of the same tag (true of the labels and tables read here).
export function elementById(html, tag, id) {
  const open = new RegExp(`<${tag}\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'i');
  const m = open.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
  return end < 0 ? null : html.slice(start, end);
}

// Rows of a table fragment as arrays of cell texts (th and td).
export function tableRows(tableHtml) {
  const rows = [];
  for (const row of String(tableHtml ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    rows.push([...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cellText(c[1])));
  }
  return rows;
}

export const sum2 = (...values) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
