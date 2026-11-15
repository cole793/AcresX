// Stevens County (WA) billed property tax, from the county's property search (hosted by True
// Automation), the page the county GIS links in its Propertyinformation field.
//
// The parcel's prop_id and link come from the county assessor layer (src/counties/
// stevens-assessor.js getStevensAssessment, cached 7 days), which accepts only
// https://propertysearch.trueautomation.com/PropertyAccess/Property.aspx with numeric cid, year
// and prop_id equal to the record's.
// Read, and nothing else:
//   - the statement totals rows of table#ctl00_details_detailsTable
//     (tr.rowEnd#DetailTable<n>_totalsRow: Year | Statement ID | First Half Base Amt. | Second
//     Half Base Amt. | Penalty | Interest | Base Paid | Amount Due): the year and the two base
//     halves only. The statement ID is never read.
//   - span#ctl00_details_recalculateDate ("Property Tax Information as of 11/14/2026").
// Never read: Owner (name, owner ID, mailing address, % ownership), the Taxing Jurisdiction
// "Owner:" table, Deed and Sales History (grantor/grantee). The page is never returned, stored
// or logged.
//
// The page's "Taxes w/Current Exemptions" block is an estimate on the newest roll value at
// today's rates (in effect next year's bill), not the billed amount, so it is not used.
// Sample (0434200, prop_id 16030, as of 11/14/2026): 2026 statement $2,073.04 + $2,073.00 =
// $4,146.04.
import { fetchTaxPage, elementById, cellText, money, usDate, sum2, TaxPageError } from '../shared/tax-page.js';
import { getStevensAssessment, stevensPropertySearchUrl } from './stevens-assessor.js';

export const STEVENS_TAX_SOURCE_NAME = 'Stevens County Treasurer (property search hosted by True Automation)';

// Property.aspx HTML -> { taxYear, total, installments, asOf } or null when no statement row.
export function parseStevensTax(html) {
  const byYear = new Map();
  for (const row of String(html).matchAll(/<tr class="rowEnd" id="DetailTable\d+_totalsRow">([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c => cellText(c[1]));
    if (cells.length !== 8 || !/^\d{4}$/.test(cells[0])) continue;
    const first = money(cells[2]), second = money(cells[3]);
    if (first == null || second == null) continue;
    const year = Number(cells[0]);
    const prev = byYear.get(year) || { first: 0, second: 0 };
    byYear.set(year, { first: sum2(prev.first, first), second: sum2(prev.second, second) });
  }
  if (!byYear.size) return null;
  const taxYear = Math.max(...byYear.keys());
  const { first, second } = byYear.get(taxYear);
  const asOfSpan = elementById(html, 'span', 'ctl00_details_recalculateDate');
  return {
    taxYear, total: sum2(first, second),
    installments: [{ label: 'First half', amount: first }, { label: 'Second half', amount: second }],
    asOf: asOfSpan ? usDate(asOfSpan) : null
  };
}

export async function getStevensTax(parcelId, { ctx } = {}) {
  const assessment = await getStevensAssessment(parcelId, { ctx });
  if (assessment.status === 'not_found') return { status: 'not_found', note: 'No Stevens County Assessor record matched this parcel number.' };
  if (assessment.status !== 'found') return { status: 'unavailable', reason: 'unavailable', error: assessment.error || 'Stevens County Assessor lookup failed' };
  const record = assessment.record || {};
  const url = stevensPropertySearchUrl(record.propertySearchUrl, record.propertyId);
  if (!url) return { status: 'not_found', note: 'The county record has no property search link.' };
  const link = { label: 'View tax bill on the Stevens County property search', url };
  let html;
  try { html = await fetchTaxPage(url, { agency: 'Stevens County property search', label: 'stevens-trueautomation-tax' }); }
  catch (error) { return { status: 'unavailable', reason: error instanceof TaxPageError ? error.kind : 'unavailable', error: error.message, link }; }
  const parsed = parseStevensTax(html);
  if (!parsed) return { status: 'not_found', note: 'The property search lists no tax statement for this parcel.', link };
  return { status: 'found', basis: 'billed', ...parsed, source: { name: STEVENS_TAX_SOURCE_NAME, url }, link };
}
