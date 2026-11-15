// Yellowstone County (MT) billed property tax, from the County Treasurer's yearly detail page.
//
// Step 1: the treasurer tax ID from the county GIS, TaxparcelOrion/MapServer/1 TAX_ID by GEOCODE
//   (stored without dashes; a dashed query finds nothing). 03072527101010000 -> D03781.
// Step 2: https://www.yellowstonecountymt.gov/treasurer/PropertySearch/csatydet.asp?propid=<TAX_ID>&lyear=<year>
//   (plain GET; the county's own printouts use it). This page has no owner fields. Read, and
//   nothing else: the "Tax ID: <b>..</b> Tax Year: <b>..</b>" line (checked against the request),
//   the "Totals" row of the district table (1st half, 2nd half, total), and "The tax information
//   was updated on <date>". The "Date Paid" row is not read.
// robots.txt (User-Agent *) sets Crawl-delay: 10 and does not disallow /treasurer/. So: one page
// request per lookup (the year is chosen up front, no second try), and found answers are cached
// 7 days by the service. The search form (POST) answered 403 and is not used.
// Sample (updated 11/14/2026): D03781 2026 Totals $89.42 + $89.40 = $178.82.
import { arcgisQuery } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { fetchTaxPage, tableRows, money, usDate, cellText, TaxPageError } from '../shared/tax-page.js';

export const YELLOWSTONE_TAX_PARCELS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Parcel/TaxparcelOrion/MapServer/1';
export const YELLOWSTONE_TREASURER_SEARCH = 'https://www.yellowstonecountymt.gov/treasurer/PropertySearch/';
export const YELLOWSTONE_TAX_SOURCE_NAME = 'Yellowstone County Treasurer (property tax detail)';

// Montana mails bills in late October/November (first half due November 30), so from November
// on the current year's bill is the newest; before that, last year's.
export function montanaBillYear(now = new Date()) {
  return now.getUTCMonth() >= 10 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function yellowstoneTaxUrl(taxId, year) {
  const id = String(taxId ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(id) || !/^\d{4}$/.test(String(year))) return null;
  return `https://www.yellowstonecountymt.gov/treasurer/PropertySearch/csatydet.asp?propid=${id}&lyear=${year}`;
}

// csatydet.asp HTML -> { taxYear, total, installments, asOf } or null when the page is not the
// requested tax ID and year, or has no Totals row (no bill for that year yet).
export function parseYellowstoneTax(html, { taxId, year }) {
  const head = /Tax ID:\s*<b>([A-Z0-9]+)<\/b>\s*(?:&nbsp;|\s)*Tax Year:\s*<b>(\d{4})<\/b>/i.exec(html);
  if (!head || head[1].toUpperCase() !== String(taxId).toUpperCase() || Number(head[2]) !== Number(year)) return null;
  const table = /<table class="table table-striped data-table">([\s\S]*?)<\/table>/i.exec(html);
  if (!table) return null;
  const totals = tableRows(table[1]).find(c => c[1] === 'Totals');
  if (!totals || totals.length !== 7) return null;
  const first = money(totals[2]), second = money(totals[4]), total = money(totals[6]);
  if (first == null || second == null || total == null) return null;
  const updated = /The tax information was updated on (\d{1,2}\/\d{1,2}\/\d{4})/.exec(cellText(html.slice(table.index)));
  return {
    taxYear: Number(year), total,
    installments: [{ label: 'First half', amount: first }, { label: 'Second half', amount: second }],
    asOf: updated ? usDate(updated[1]) : null
  };
}

async function findTaxId(parcelId) {
  const geocode = String(parcelId ?? '').replace(/\D/g, '');
  if (!/^\d{17}$/.test(geocode)) return { status: 'not_found' };
  const features = withoutPersonalFields(await arcgisQuery(YELLOWSTONE_TAX_PARCELS, { where: `GEOCODE='${geocode}'`, outFields: 'GEOCODE,TAX_ID', returnGeometry: 'false' }, {
    timeoutMs: 10000, retryTimeoutMs: 8000, retries: 1, label: 'yellowstone-tax-id', agency: 'Yellowstone County GIS'
  }));
  const taxId = String(features[0]?.attributes?.TAX_ID ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(taxId) ? { status: 'found', taxId } : { status: 'not_found' };
}

export async function getYellowstoneTax(parcelId, { now = new Date() } = {}) {
  const search = { label: 'Search the Yellowstone County Treasurer', url: YELLOWSTONE_TREASURER_SEARCH };
  let id;
  try { id = await findTaxId(parcelId); }
  catch (error) { return { status: 'unavailable', reason: 'unavailable', error: String(error?.message || 'Yellowstone County GIS query failed'), link: search }; }
  if (id.status !== 'found') return { status: 'not_found', note: 'No Yellowstone County tax ID matched this parcel number.', link: search };
  const year = montanaBillYear(now);
  const url = yellowstoneTaxUrl(id.taxId, year);
  const link = { label: 'View tax bill on the Yellowstone County Treasurer site', url };
  let html;
  try { html = await fetchTaxPage(url, { agency: 'Yellowstone County Treasurer', label: 'yellowstone-treasurer-tax' }); }
  catch (error) { return { status: 'unavailable', reason: error instanceof TaxPageError ? error.kind : 'unavailable', error: error.message, link }; }
  const parsed = parseYellowstoneTax(html, { taxId: id.taxId, year });
  if (!parsed) return { status: 'not_found', note: `The Treasurer lists no ${year} bill for this parcel yet.`, link };
  return { status: 'found', basis: 'billed', ...parsed, source: { name: YELLOWSTONE_TAX_SOURCE_NAME, url }, link };
}
