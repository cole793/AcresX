// Kootenai County (ID) property tax ESTIMATE: net taxable value x the 2026 levy rate of the
// parcel's tax area group (TAG).
//
// The billed amount is not reachable: the Treasurer's tax search
// (id-kootenai.publicaccessnow.com) answers HTTP 403 to automated requests (research run
// 2026-11-15). That is not worked around, so this layer estimates instead and says so.
//   - TAG and AssessValue_Net come from the county assessor layer the parcel was found in
//     (src/counties/kootenai-assessor.js getKootenaiAssessment, cached 7 days, gives the layer):
//     one more query, to that layer only, for PIN, TAG, AssessValue_Net and AssessValue_Date.
//     Owner and mailing fields are never requested.
//   - The rate comes from src/counties/kootenai-levy-2026.js (the county's "Rates for the Year
//     2026" table, baked into code).
// Fees and special assessments (solid waste, etc.) are not in the estimate.
// Sample: 50N04W323200 (layer 9): TAG 2490000 -> 249-0000, rate 0.0036412360, net $6,893 ->
// about $25.10.
import { arcgisQuery } from '../shared/upstream.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';
import { getKootenaiAssessment, KC_ASSESSOR } from './kootenai-assessor.js';
import { kootenaiLevyRate, kootenaiTagKey, KOOTENAI_LEVY_YEAR, KOOTENAI_LEVY_SOURCE } from './kootenai-levy-2026.js';

export const KOOTENAI_TAX_FIELDS = 'PIN,TAG,AssessValue_Net,AssessValue_Date';
export const KOOTENAI_TREASURER_URL = 'https://id-kootenai.publicaccessnow.com/Treasurer/TaxSearch.aspx';
export const KOOTENAI_TAX_NOTE = `Estimated from the ${KOOTENAI_LEVY_YEAR} levy rate; excludes fees and special assessments.`;
const LINK = Object.freeze({ label: 'View tax bill on the Kootenai County Treasurer site', url: KOOTENAI_TREASURER_URL });

// { TAG, AssessValue_Net, AssessValue_Date } -> the estimate, or null when the TAG has no rate or
// the net value is missing.
export function estimateKootenaiTax(attrs = {}) {
  const rate = kootenaiLevyRate(attrs.TAG);
  const net = attrs.AssessValue_Net === null || attrs.AssessValue_Net === '' || attrs.AssessValue_Net === undefined ? NaN : Number(attrs.AssessValue_Net);
  if (rate == null || !Number.isFinite(net) || net < 0) return null;
  const valueYear = Number(String(attrs.AssessValue_Date ?? '').slice(0, 4)) || null;
  return {
    taxYear: KOOTENAI_LEVY_YEAR,
    total: Math.round(net * rate * 100) / 100,
    // Dollars per $1,000 of net taxable value, like the WA levy totals.
    levyRate: Math.round(rate * 1000 * 1e7) / 1e7,
    taxableValue: net,
    taxArea: kootenaiTagKey(attrs.TAG),
    valueYear
  };
}

export async function getKootenaiTax(parcelId, { ctx } = {}) {
  const assessment = await getKootenaiAssessment(parcelId, { ctx });
  if (assessment.status === 'not_found') return { status: 'not_found', note: 'No Kootenai County Assessor record matched this parcel number.', link: LINK };
  if (assessment.status !== 'found') return { status: 'unavailable', reason: 'unavailable', error: assessment.error || 'Kootenai County Assessor lookup failed', link: LINK };
  const { pin, layerId } = assessment.record || {};
  if (!pin || !Number.isInteger(layerId)) return { status: 'unavailable', reason: 'unavailable', error: 'Kootenai assessor record has no layer', link: LINK };
  let features;
  try {
    features = withoutPersonalFields(await arcgisQuery(`${KC_ASSESSOR}/${layerId}`, { where: `PIN='${pin.replaceAll("'", "''")}'`, outFields: KOOTENAI_TAX_FIELDS, returnGeometry: 'false' }, {
      timeoutMs: 10000, retries: 0, label: `kootenai-tax-${layerId}`, agency: `Kootenai County Assessor layer ${layerId}`
    }));
  } catch (error) {
    return { status: 'unavailable', reason: 'unavailable', error: String(error?.message || 'Kootenai County Assessor query failed'), link: LINK };
  }
  const estimate = estimateKootenaiTax(features[0]?.attributes || {});
  if (!estimate) return { status: 'not_found', note: 'The parcel\'s tax area group or net taxable value is not available for an estimate.', link: LINK };
  const { valueYear, ...rest } = estimate;
  const note = valueYear && valueYear !== KOOTENAI_LEVY_YEAR ? `${KOOTENAI_TAX_NOTE} Net taxable value is from ${valueYear}.` : KOOTENAI_TAX_NOTE;
  return {
    status: 'found', basis: 'estimate', ...rest, note, asOf: KOOTENAI_LEVY_SOURCE.date,
    source: { name: KOOTENAI_LEVY_SOURCE.name, url: KOOTENAI_LEVY_SOURCE.url }, link: LINK
  };
}
