// Stevens County (WA) Assessor values for /api/property-assessment.
//
// Source: Stevens County GIS RealPropertyParcels_Public MapServer layer 0 (a feature layer with
// polygon geometry; we ask for returnGeometry=false). One row per parcel polygon, 43,067 rows,
// tax year 2026 (checked live 2026-11-04). The parcel number is PARCELN, a 7-character string
// with leading zeros (0000500, 0231200, 8974701). It is the same number as ORIG_PARCEL_ID on the
// WA statewide parcel layer (FIPS 065) that the parcel search uses; PARCEL_ID_NR there is
// "065-" + that number.
//
// Values (field names are the shapefile-truncated ones the layer publishes):
//   market_lan   market land value          assessed_l  assessed land value (current-use or
//   improvemen   improvement value                      forest value when classified)
//   market_1     market total (= market_lan + improvemen on every record checked)
//   appraised_   assessed total (= assessed_l + improvemen)
//   taxable_va   taxable value (lower than appraised_ on 1,819 records: exemptions)
//   property_u   WA DOR two-digit land use code (WAC 458-53-030(5)), a tax category, not zoning
//   Ag_Sched     the assessor's land valuation schedule (88-DFL, FARM, PGRASS, SPECIAL, ...).
//                SPECIAL also appears on ordinary city lots, so it is not current-use status
//                by itself; current use is read from the land use code (83, 88, 94, 95).
//   legal_acre   legal acres
// There is also `market`, which differs from market_1 on 803 records; market_1 is the one that
// matches its land + improvement parts, so it is the market value returned. The layer has no tax
// amount field.
//
// The layer ALSO holds the owner's name and mailing address (file_as_na, last_name, first_name,
// owner_id, addr_line1..3, addr_city, addr_state, addr_zip). They are never requested:
// STEVENS_ASSESSOR_FIELDS names every field, and mapStevensAssessorRecord() copies named fields
// only (after withoutPersonalFields), so owner data cannot reach the response or the cache even if
// the server sent it.
//
// Requests go through the shared client (src/shared/upstream.js): 10 s, one retry at 6 s. Found
// records are cached per normalized parcel number for 7 days (Cache API); misses and errors are
// not.
import { arcgisQuery, cachedJson } from '../shared/upstream.js';
import { isFallbackEligible } from '../shared/fallback.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';

export const STEVENS_ASSESSOR = 'https://gis.stevenscountywa.gov/server/rest/services/RealPropertyParcels_Public/MapServer/0';
export const STEVENS_ASSESSOR_SOURCE = 'Stevens County Assessor (RealPropertyParcels_Public)';
// Never add file_as_na, last_name, first_name, owner_id or addr_*: the owner's name and mailing address.
export const STEVENS_ASSESSOR_FIELDS = [
  'PARCELN', 'prop_id', 'year', 'property_u', 'Ag_Sched', 'legal_acre', 'tax_area_n',
  'market_lan', 'assessed_l', 'improvemen', 'market_1', 'appraised_', 'taxable_va'
].join(',');
const TIMEOUT_MS = 10000;
const RETRY_TIMEOUT_MS = 6000;
// Bump the version whenever STEVENS_ASSESSOR_FIELDS or the record mapping changes.
export const STEVENS_ASSESSOR_CACHE_PREFIX = 'https://acresx.internal/cache/stevens-assessor/v1/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const FIPS_PREFIX = '065';

// WAC 458-53-030(5), standard two-digit land use codes (checked 2026-11-04 at
// https://app.leg.wa.gov/WAC/default.aspx?cite=458-53-030). Codes the WAC lists as "Not presently
// assigned" are left out.
export const WA_LAND_USE_CODES = Object.freeze({
  11: 'Household, single family units', 12: 'Household, 2-4 units', 13: 'Household, multiunits (5 or more)',
  14: 'Residential condominiums', 15: 'Mobile home parks or courts', 16: 'Hotels/motels', 17: 'Institutional lodging',
  18: 'All other residential not elsewhere coded', 19: 'Vacation and cabin',
  21: 'Food and kindred products', 22: 'Textile mill products', 23: 'Apparel and other finished products made from fabrics, leather, and similar materials',
  24: 'Lumber and wood products (except furniture)', 25: 'Furniture and fixtures', 26: 'Paper and allied products', 27: 'Printing and publishing',
  28: 'Chemicals', 29: 'Petroleum refining and related industries', 30: 'Rubber and miscellaneous plastic products', 31: 'Leather and leather products',
  32: 'Stone, clay and glass products', 33: 'Primary metal industries', 34: 'Fabricated metal products',
  35: 'Professional, scientific, and controlling instruments; photographic and optical goods; watches and clocks-manufacturing',
  39: 'Miscellaneous manufacturing',
  41: 'Railroad/transit transportation', 42: 'Motor vehicle transportation', 43: 'Aircraft transportation', 44: 'Marine craft transportation',
  45: 'Highway and street right of way', 46: 'Automobile parking', 47: 'Communication', 48: 'Utilities',
  49: 'Other transportation, communication, and utilities not classified elsewhere',
  50: 'Condominiums - Other than residential condominiums', 51: 'Wholesale trade', 52: 'Retail trade - Building materials, hardware, and farm equipment',
  53: 'Retail trade - General merchandise', 54: 'Retail trade - Food', 55: 'Retail trade - Automotive, marine craft, aircraft, and accessories',
  56: 'Retail trade - Apparel and accessories', 57: 'Retail trade - Furniture, home furnishings and equipment', 58: 'Retail trade - Eating and drinking',
  59: 'Other retail trade services',
  61: 'Finance, insurance, and real estate services', 62: 'Personal services', 63: 'Business services', 64: 'Repair services',
  65: 'Professional services', 66: 'Contract construction services', 67: 'Governmental services', 68: 'Educational services', 69: 'Miscellaneous services',
  71: 'Cultural activities and nature exhibitions', 72: 'Public assembly', 73: 'Amusements', 74: 'Recreational activities',
  75: 'Resorts and group camps', 76: 'Parks', 79: 'Other cultural, entertainment, and recreational',
  81: 'Agriculture (not classified under current use law)', 82: 'Agriculture related activities',
  83: 'Agriculture classified under current use chapter 84.34 RCW', 84: 'Fishing activities and related services',
  85: 'Mining activities and related services', 86: 'Cannabis grow operations', 88: 'Designated forest land under chapter 84.33 RCW',
  89: 'Other resource production',
  91: 'Undeveloped land', 92: 'Noncommercial forest', 93: 'Water areas', 94: 'Open space land classified under chapter 84.34 RCW',
  95: 'Timberland classified under chapter 84.34 RCW', 99: 'Other undeveloped land'
});

// Land use codes that mean the land is in a current-use or designated-forest program.
const CURRENT_USE_PROGRAMS = Object.freeze({
  83: 'Current use: agriculture (RCW 84.34)',
  88: 'Designated forest land (RCW 84.33)',
  94: 'Current use: open space (RCW 84.34)',
  95: 'Current use: timberland (RCW 84.34)'
});

function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function str(value) { const s = String(value ?? '').trim(); return s || null; }

// What a realtor might type -> the 7-character PARCELN, or null when it cannot be one.
//   "0231200", " 0231200 ", "0231-200", "02312.00"  -> "0231200" (punctuation and spaces dropped)
//   "231200", "500"                                 -> "0231200", "0000500" (leading zeros restored;
//                                                      the statewide parcel search matches these too)
//   "065-0231200", "0650231200"                     -> "0231200" (statewide PARCEL_ID_NR form)
// Every PARCELN but one (a blank row) is 7 digits, so anything else is not a Stevens number.
export function normalizeStevensParcelId(parcelId) {
  let id = String(parcelId ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d{10}$/.test(id) && id.startsWith(FIPS_PREFIX)) id = id.slice(FIPS_PREFIX.length);
  if (/^\d{1,6}$/.test(id)) id = id.padStart(7, '0');
  return /^\d{7}$/.test(id) ? id : null;
}

// The id is 7 digits (normalizeStevensParcelId), so it needs no quoting beyond the quotes.
export function stevensAssessorWhere(id) {
  return `PARCELN='${id}'`;
}

function currentUse(code, landValue, marketLandValue) {
  const program = code != null ? CURRENT_USE_PROGRAMS[Number(code)] || null : null;
  if (program) return { status: 'classified', program };
  if (landValue != null && marketLandValue != null && landValue < marketLandValue) {
    return { status: 'reduced_land_value', program: null, note: 'Land is assessed below market value, which usually means part of it is in a current-use or forest program. Verify with the assessor.' };
  }
  if (code == null && landValue == null) return { status: null, program: null };
  return { status: 'not_classified', program: null };
}

// Raw layer attributes -> the fields AcresX returns. Named fields only (no spread of attrs).
// Missing values (null, undefined, '') stay null, never 0. A record whose values are all 0 or
// missing (3,051 rows, most with land use 99 and tax area 000) carries no valuation, so its values
// are null with a note rather than "$0".
export function mapStevensAssessorRecord(raw = {}) {
  const attrs = withoutPersonalFields(raw);
  const code = str(attrs.property_u);
  const values = {
    landValue: num(attrs.assessed_l), improvementValue: num(attrs.improvemen), totalValue: num(attrs.appraised_),
    taxableValue: num(attrs.taxable_va), marketLandValue: num(attrs.market_lan), marketValue: num(attrs.market_1)
  };
  const valued = Object.values(values).some(v => v != null && v !== 0);
  if (!valued) for (const k of Object.keys(values)) values[k] = null;
  if (values.totalValue == null && (values.landValue != null || values.improvementValue != null)) values.totalValue = (values.landValue || 0) + (values.improvementValue || 0);
  const parcelNumber = str(attrs.PARCELN);
  return {
    parcelNumber, propertyId: num(attrs.prop_id),
    ...values,
    // netValue is what the overview shows as "Net taxable" (same key as Kootenai's).
    netValue: values.taxableValue,
    taxYear: num(attrs.year),
    assessorAcres: num(attrs.legal_acre),
    taxCodeArea: str(attrs.tax_area_n),
    propertyClass: code, propertyClassDescription: code ? WA_LAND_USE_CODES[Number(code)] || null : null,
    propertyClassNote: 'Tax category, not zoning',
    landSchedule: str(attrs.Ag_Sched),
    currentUse: currentUse(code, values.landValue, values.marketLandValue),
    ...(valued ? {} : { valuesNote: 'The assessor record for this parcel carries no values. Check with the Stevens County Assessor.' })
  };
}

// A parcel drawn as several polygons has several rows; only one of them may carry the values
// (2148112 has three rows, two with no values). Prefer the row with a tax year, then one with values.
function bestRow(features) {
  const rows = features.map(f => f?.attributes || {});
  return rows.find(r => r.year != null && r.appraised_ != null) || rows.find(r => r.appraised_ != null || r.market_1 != null) || rows[0];
}

function errorMessage(error) {
  if (error?.kind === 'timeout' || error?.name === 'AbortError') return 'Stevens County Assessor timed out';
  const detail = String(error?.message || 'query failed');
  return detail.startsWith('Stevens County Assessor') ? detail : `Stevens County Assessor unavailable: ${detail}`;
}

// { status: 'found', record } | { status: 'not_found' } | { status: 'error', error, browserFallback }.
// browserFallback is true when the failure is one a browser might get past (src/shared/fallback.js).
export async function queryStevensAssessment(parcelId) {
  const id = normalizeStevensParcelId(parcelId);
  if (!id) return { status: 'not_found' };
  try {
    const features = await arcgisQuery(STEVENS_ASSESSOR, { where: stevensAssessorWhere(id), outFields: STEVENS_ASSESSOR_FIELDS, returnGeometry: 'false', resultRecordCount: '10' }, {
      timeoutMs: TIMEOUT_MS, retryTimeoutMs: RETRY_TIMEOUT_MS, retries: 1, label: 'stevens-assessor',
      agency: 'Stevens County Assessor', arcgisMessage: message => `Stevens County Assessor: ${message || 'query failed'}`
    });
    if (!features.length) return { status: 'not_found' };
    return { status: 'found', record: mapStevensAssessorRecord(bestRow(features)) };
  } catch (error) {
    return { status: 'error', error: errorMessage(error), browserFallback: isFallbackEligible(error) };
  }
}

// Same answer, with found records cached per normalized parcel number (validated answers only).
export function getStevensAssessment(parcelId, { ctx } = {}) {
  const key = normalizeStevensParcelId(parcelId);
  if (!key) return Promise.resolve({ status: 'not_found' });
  return cachedJson(STEVENS_ASSESSOR_CACHE_PREFIX, key, CACHE_TTL_SECONDS, () => queryStevensAssessment(key), {
    ctx, isValid: result => result?.status === 'found' && result.record?.parcelNumber === key
  });
}
