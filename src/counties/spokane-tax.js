// Spokane County (WA) billed property tax, from the county's SCOUT property summary page.
//
// No Spokane GIS layer carries a tax amount (checked 2026-11-15, every gismo.spokanecounty.org
// layer). SCOUT (Assessor + Treasurer) shows it:
//   https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=23123.9051
// Read, and nothing else:
//   - table#MainContent_TaxInfo_GridView16 ("Property Taxes": Tax Year | Charge Type | Annual
//     Charges | Remaining Charges Owing): the "Total Taxes for <year>" rows and that year's
//     "A/V Property Tax" line (to tell an exempt parcel, which pays only special assessments).
//   - table#MainContent_Levy_GridView1 ("Levy"): the "Totals:" row, in the "Levy Rate <year>"
//     column (dollars per $1,000 of taxable value).
//   - span#lblDateAs ("Data As Of: 11/14/2026").
// Never read: the Owner/Taxpayer sections (names, mailing address), Tax Receipts
// (GridView17: receipt numbers), Sales (grantor/grantee, excise numbers). The page is never
// returned, stored or logged. RCW 42.56.070(9) (quoted on the SCOUT disclaimer) bars commercial
// use of lists of individuals; amounts per parcel carry no names.
//
// Samples (Data As Of 11/14/2026): 23123.9051 Total Taxes for 2026 = $1,877.65, levy 8.17;
// 35204.2729 (a church, exempt) Total Taxes for 2026 = $15.00, all of it the aquifer assessment.
import { fetchTaxPage, elementById, tableRows, money, usDate, TaxPageError } from '../shared/tax-page.js';
import { normalizeSpokaneParcelId } from './spokane-assessor.js';

export const SPOKANE_TAX_SOURCE_NAME = 'Spokane County Treasurer (SCOUT property summary)';
// SCOUT pages for parcels with long permit histories are large (35204.2729: 2.5 MB).
const MAX_BYTES = 4_000_000;

// Any form normalizeSpokaneParcelId() accepts ("35204-2729", "063-35204.2729", ...).
export function spokaneTaxUrl(parcelId) {
  const pid = normalizeSpokaneParcelId(parcelId);
  return pid ? `https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=${pid}` : null;
}

// SCOUT HTML -> { taxYear, total, adValorem, levyRate, asOf } or null when the page has no
// "Total Taxes for <year>" row.
export function parseSpokaneTax(html) {
  const taxTable = elementById(html, 'table', 'MainContent_TaxInfo_GridView16');
  if (!taxTable) return null;
  const rows = tableRows(taxTable);
  const totals = new Map();
  for (const cells of rows) {
    const m = /^Total Taxes for (\d{4})$/.exec(cells[1] || '');
    const amount = money(cells[2]);
    if (m && amount != null) totals.set(Number(m[1]), amount);
  }
  if (!totals.size) return null;
  const taxYear = Math.max(...totals.keys());
  const adValoremCell = rows.find(c => c[0] === String(taxYear) && /^A\/V Property Tax$/.test(c[1] || ''));
  const adValorem = adValoremCell ? money(adValoremCell[2]) : 0;

  let levyRate = null;
  const levyTable = elementById(html, 'table', 'MainContent_Levy_GridView1');
  if (levyTable) {
    const levyRows = tableRows(levyTable);
    const header = levyRows.find(c => c[0] === 'Levy Name') || [];
    const col = header.indexOf(`Levy Rate ${taxYear}`);
    const total = levyRows.find(c => c[0] === 'Totals:');
    if (col > 0 && total && /^\d{1,3}(\.\d{1,6})?$/.test(total[col] || '')) levyRate = Number(total[col]);
  }
  const asOfSpan = elementById(html, 'span', 'lblDateAs');
  const asOf = asOfSpan && /^Data As Of:/.test(asOfSpan.replace(/<[^>]*>/g, '').trim()) ? usDate(asOfSpan) : null;
  return { taxYear, total: totals.get(taxYear), adValorem, levyRate, asOf };
}

// { status: 'found', ... } | { status: 'not_found', ... } | { status: 'unavailable', ... }
export async function getSpokaneTax(parcelId) {
  const url = spokaneTaxUrl(parcelId);
  if (!url) return { status: 'not_found', note: 'Spokane parcel numbers look like 12345.6789.' };
  const link = { label: 'View tax bill on Spokane County SCOUT', url };
  let html;
  try { html = await fetchTaxPage(url, { agency: 'Spokane County SCOUT', label: 'spokane-scout-tax', maxBytes: MAX_BYTES }); }
  catch (error) { return { status: 'unavailable', reason: error instanceof TaxPageError ? error.kind : 'unavailable', error: error.message, link }; }
  const parsed = parseSpokaneTax(html);
  if (!parsed) return { status: 'not_found', note: 'SCOUT lists no tax bill for this parcel.', link };
  const exempt = !(parsed.adValorem > 0);
  return {
    status: 'found', basis: 'billed', taxYear: parsed.taxYear, total: parsed.total,
    ...(parsed.levyRate != null ? { levyRate: parsed.levyRate } : {}),
    ...(exempt ? { exempt: true, note: 'No regular property tax billed (exempt); the amount is special assessments only.' } : {}),
    asOf: parsed.asOf, source: { name: SPOKANE_TAX_SOURCE_NAME, url }, link
  };
}
