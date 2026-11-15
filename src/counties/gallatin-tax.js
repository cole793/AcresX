// Gallatin County (MT) billed property tax, from the County Treasurer's iTax site (Tyler
// Technologies).
//
// Step 1: the tax ID from the Montana DNRC cadastral layer: AssessmentCode by PARCELID, minus its
//   leading "00" (06069905302080000 -> 00RHH41234 -> RHH41234).
// Step 2: https://itax.gallatin.mt.gov/detail.aspx?taxid=<TaxID> (plain GET). Read ONLY these
//   labels (ids _ctl0_ContentPlaceHolder1_<name>): lblYearTaxes ("2026 Taxes:", for the year),
//   lblTaxFirstHalf, lblTaxSecondHalf, lblTaxTotal, lblValueTaxable, lblLevy (levy district
//   name), lblStatus (must be present; not returned), plus "Property tax data was last updated
//   <date>" from the page note.
// NEVER read lblOwners, lblMailing or lblReceipt (owner names, mailing address, receipt number),
//   the kindoftax page (it prints the owner) or the bill PDFs (owner and mailing address).
// Sample (last updated 11/13/2026): RHH41234 2026 $4,604.50 + $4,604.46 = $9,208.96, taxable
// $23,341, levy district "2350-36, 7R Bozeman(R)HF".
import { arcgisQuery } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { fetchTaxPage, elementById, cellText, money, usDate, TaxPageError } from '../shared/tax-page.js';

export const MT_CADASTRAL_LAYER = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
export const GALLATIN_ITAX = 'https://itax.gallatin.mt.gov/';
export const GALLATIN_TAX_SOURCE_NAME = 'Gallatin County Treasurer (iTax)';
const PREFIX = '_ctl0_ContentPlaceHolder1_';
export const GALLATIN_TAX_LABELS = Object.freeze(['lblYearTaxes', 'lblTaxFirstHalf', 'lblTaxSecondHalf', 'lblTaxTotal', 'lblValueTaxable', 'lblLevy', 'lblStatus']);

// "00RHH41234" -> "RHH41234"; null unless the code is 00 + 4-12 letters/digits.
export function gallatinTaxId(assessmentCode) {
  const m = /^00([A-Z0-9]{4,12})$/.exec(String(assessmentCode ?? '').trim().toUpperCase());
  return m ? m[1] : null;
}

export function gallatinTaxUrl(taxId) {
  return /^[A-Z0-9]{4,12}$/.test(String(taxId ?? '')) ? `https://itax.gallatin.mt.gov/detail.aspx?taxid=${taxId}` : null;
}

// detail.aspx HTML -> { taxYear, total, installments, taxableValue, levyDistrict, asOf } or null.
export function parseGallatinTax(html) {
  const label = name => {
    if (!GALLATIN_TAX_LABELS.includes(name)) throw new Error(`label ${name} is not on the read list`);
    const inner = elementById(html, 'span', `${PREFIX}${name}`);
    return inner == null ? null : cellText(inner);
  };
  const year = /^(\d{4}) Taxes:$/.exec(label('lblYearTaxes') || '');
  const status = label('lblStatus');
  const total = money(label('lblTaxTotal')), first = money(label('lblTaxFirstHalf')), second = money(label('lblTaxSecondHalf'));
  if (!year || !status || total == null) return null;
  const taxable = money(label('lblValueTaxable'));
  const levy = label('lblLevy');
  const updated = /Property tax data was last updated\s+(\d{1,2}\/\d{1,2}\/\d{4})/.exec(html);
  return {
    taxYear: Number(year[1]), total,
    ...(first != null && second != null ? { installments: [{ label: 'First half', amount: first }, { label: 'Second half', amount: second }] } : {}),
    ...(taxable != null ? { taxableValue: taxable } : {}),
    ...(levy && levy.length <= 80 ? { levyDistrict: levy } : {}),
    asOf: updated ? usDate(updated[1]) : null
  };
}

async function findTaxId(parcelId) {
  const geocode = String(parcelId ?? '').replace(/\D/g, '');
  if (!/^\d{17}$/.test(geocode)) return null;
  const features = withoutPersonalFields(await arcgisQuery(MT_CADASTRAL_LAYER, { where: `PARCELID='${geocode}'`, outFields: 'PARCELID,AssessmentCode', returnGeometry: 'false' }, {
    timeoutMs: 12000, retryTimeoutMs: 8000, retries: 1, label: 'gallatin-tax-id', agency: 'Montana Cadastral'
  }));
  return gallatinTaxId(features[0]?.attributes?.AssessmentCode);
}

export async function getGallatinTax(parcelId) {
  const search = { label: 'Search the Gallatin County Treasurer (iTax)', url: GALLATIN_ITAX };
  let taxId;
  try { taxId = await findTaxId(parcelId); }
  catch (error) { return { status: 'unavailable', reason: 'unavailable', error: String(error?.message || 'Montana Cadastral query failed'), link: search }; }
  if (!taxId) return { status: 'not_found', note: 'No Gallatin County tax ID matched this parcel number.', link: search };
  const url = gallatinTaxUrl(taxId);
  const link = { label: 'View tax bill on Gallatin County iTax', url };
  let html;
  try { html = await fetchTaxPage(url, { agency: 'Gallatin County iTax', label: 'gallatin-itax-tax' }); }
  catch (error) { return { status: 'unavailable', reason: error instanceof TaxPageError ? error.kind : 'unavailable', error: error.message, link }; }
  const parsed = parseGallatinTax(html);
  if (!parsed) return { status: 'not_found', note: 'iTax lists no tax bill for this parcel.', link };
  return { status: 'found', basis: 'billed', ...parsed, source: { name: GALLATIN_TAX_SOURCE_NAME, url }, link };
}
