// POST /api/property-tax { state, county, parcelId } -> the parcel's annual property tax.
//
// New, additive route (owner-approved 2026-11-15); /api/property-assessment is unchanged.
// No GIS layer in any covered county carries a tax amount, so the amounts come from the official
// public treasurer/assessor pages, amounts only (src/counties/*-tax.js):
//   Spokane WA      SCOUT property summary            billed
//   Stevens WA      county property search (True Automation)  billed
//   Kootenai ID     2026 levy rate by TAG x net taxable value  estimate (the treasurer site
//                   answers 403 to automated requests; not worked around)
//   Yellowstone MT  Treasurer csatydet.asp yearly detail     billed
//   Gallatin MT     Treasurer iTax detail.aspx             billed
// Any other county: status 'not_supported' ("not available"), with a lookup link where one is known.
//
// Answer (HTTP 200 for every lookup; 400 only for a missing parcel number):
//   { available, state, county, parcelId, status, basis, taxYear, total, installments?,
//     levyRate? (dollars per $1,000), taxableValue?, levyDistrict?, exempt?, label, note?,
//     source: { name, url }, asOf, link: { label, url } }
//   status: 'found' | 'not_found' | 'unavailable' (source down, blocked or a bot check: the
//   answer degrades to the "View tax bill" link) | 'not_supported'.
// Only this layer degrades on failure. Never returned, stored or logged: owner, taxpayer, mailing,
// receipt, statement or grantor/grantee details (the adapters never read them, and the answer is
// rebuilt from named fields here). Found answers are cached 7 days per parcel; nothing else is.
import { json } from '../shared/http.js';
import { cachedJson } from '../shared/upstream.js';
import { getSpokaneTax } from '../counties/spokane-tax.js';
import { getStevensTax } from '../counties/stevens-tax.js';
import { getKootenaiTax } from '../counties/kootenai-tax.js';
import { getYellowstoneTax } from '../counties/yellowstone-tax.js';
import { getGallatinTax } from '../counties/gallatin-tax.js';

export const PROPERTY_TAX_CACHE_PREFIX = 'https://acresx.internal/cache/property-tax/v1/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const ADAPTERS = {
  'WA:spokane': getSpokaneTax,
  'WA:stevens': getStevensTax,
  'ID:kootenai': getKootenaiTax,
  'MT:yellowstone': getYellowstoneTax,
  'MT:gallatin': getGallatinTax
};
const DISPLAY = { spokane: 'Spokane', stevens: 'Stevens', kootenai: 'Kootenai', yellowstone: 'Yellowstone', gallatin: 'Gallatin' };

// Statewide lookup directories for counties without an adapter (Montana DOR lists every county's
// tax lookup). WA and ID have no such page we have checked.
const STATE_LINKS = {
  MT: { label: 'Montana county property tax lookups (Montana DOR)', url: 'https://revenue.mt.gov/taxes/property-tax-rebate/county-property-tax-lookup' }
};

const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const shortText = (v, max = 200) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
const httpsUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; } };
// The tax bill link is kept only for https pages on these county/state tax hosts (the same list
// public/property-tax.js checks before showing it), with no user info or port.
export const TAX_LINK_HOSTS = Object.freeze(['cp.spokanecounty.org', 'propertysearch.trueautomation.com', 'id-kootenai.publicaccessnow.com',
  'www.kcgov.us', 'www.yellowstonecountymt.gov', 'itax.gallatin.mt.gov', 'revenue.mt.gov']);
const TAX_LINK_HOST_SET = new Set(TAX_LINK_HOSTS);
export function taxLinkUrl(value) {
  try {
    const u = new URL(String(value ?? ''));
    return u.protocol === 'https:' && TAX_LINK_HOST_SET.has(u.hostname) && !u.username && !u.password && !u.port ? u.href : undefined;
  } catch { return undefined; }
}
function cleanLink(link) {
  const url = taxLinkUrl(link?.url), label = shortText(link?.label, 120);
  return url && label ? { label, url } : null;
}

// Adapter result -> the public answer, copying named fields only.
export function taxAnswer({ state, county, parcelId }, result = {}) {
  const status = ['found', 'not_found', 'unavailable', 'not_supported'].includes(result.status) ? result.status : 'unavailable';
  const basis = result.basis === 'estimate' ? 'estimate' : result.basis === 'billed' ? 'billed' : null;
  const taxYear = Number.isInteger(result.taxYear) ? result.taxYear : null;
  const out = {
    available: status === 'found' && finite(result.total) !== undefined,
    state, county, parcelId, status, basis, taxYear,
    total: finite(result.total) ?? null
  };
  if (out.available === false && status === 'found') out.status = 'unavailable';
  if (Array.isArray(result.installments)) {
    const list = result.installments.filter(i => finite(i?.amount) !== undefined && shortText(i?.label, 40)).map(i => ({ label: i.label, amount: i.amount }));
    if (list.length) out.installments = list;
  }
  for (const key of ['levyRate', 'taxableValue']) if (finite(result[key]) !== undefined) out[key] = result[key];
  if (shortText(result.levyDistrict, 80)) out.levyDistrict = result.levyDistrict;
  if (shortText(result.taxArea, 20)) out.taxArea = result.taxArea;
  if (result.exempt === true) out.exempt = true;
  out.label = out.available
    ? `${basis === 'estimate' ? 'Estimated' : 'Billed'} ${taxYear ?? ''} property tax`.replace(/\s+/g, ' ')
    : 'Property tax not available';
  const note = shortText(result.note, 300);
  if (note) out.note = note;
  if (!out.available && result.reason === 'blocked') out.note = 'The county tax site did not answer automated lookups. Open the tax bill on the county site.';
  out.source = result.source && httpsUrl(result.source.url) && shortText(result.source.name, 160) ? { name: result.source.name, url: httpsUrl(result.source.url) } : null;
  out.asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(result.asOf || '')) ? result.asOf : null;
  out.link = cleanLink(result.link);
  return out;
}

export async function getPropertyTax({ state, county, parcelId }, { ctx, now } = {}) {
  const st = String(state || '').toUpperCase().trim();
  const key = String(county || '').replace(/\s+County$/i, '').trim().toLowerCase();
  const adapter = ADAPTERS[`${st}:${key}`];
  const ids = { state: st, county: DISPLAY[key] || String(county || '').replace(/\s+County$/i, '').trim(), parcelId };
  if (!adapter) {
    return taxAnswer(ids, { status: 'not_supported', note: 'Property tax amounts are not connected for this county yet. Check the county treasurer.', link: STATE_LINKS[st] || null });
  }
  const cacheKey = `${st}:${key}:${String(parcelId).trim().toUpperCase()}`;
  return cachedJson(PROPERTY_TAX_CACHE_PREFIX, cacheKey, CACHE_TTL_SECONDS, async () => {
    let result;
    try { result = await adapter(parcelId, { ctx, now }); }
    catch (error) { result = { status: 'unavailable', reason: 'unavailable', error: error?.message }; }
    // Log the reason only (agency + status); never a page or a URL query.
    if (result?.status === 'unavailable') console.warn('Property tax lookup unavailable', ids.county, result.reason || '', String(result.error || '').slice(0, 160));
    return taxAnswer(ids, result);
  }, { ctx, isValid: answer => answer?.status === 'found' && answer.available === true });
}

export async function handlePropertyTax(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'JSON body required' }, 400, 'no-store'); }
  const parcelId = String(body?.parcelId || '').trim();
  if (!parcelId) return json({ error: 'parcelId is required' }, 400, 'no-store');
  if (parcelId.length > 40) return json({ error: 'parcelId is too long' }, 400, 'no-store');
  const answer = await getPropertyTax({ state: body.state, county: body.county, parcelId }, { ctx });
  return json(answer, 200, 'no-store');
}
