// Spokane County (WA) Assessor values for /api/property-assessment.
//
// Sources (checked live 2026-11-10). Spokane County GIS publishes the assessor's parcel table
// (ASSRSDE.ASSR.Parcels) through several map services. The one AcresX used before,
// Assessor/SCOUTSimple/MapServer/0, has only land_value, exemption amounts and the use
// description. Two services expose the fuller row with the same 214,711 records (same
// max eff_from_date 2026-01-01, same values on the 12 Spokane validation parcels):
//   1. ISDSDE/LandCapacityAnalysis/MapServer/0 "Parcels": no owner, taxpayer or mailing field at
//      all. Used first.
//   2. CONNECTExplorer/CONNECTExplorer_REST/MapServer/14 "Parcels" ("Used to support
//      CONNECTExplorer/Pictometry Web Apps"): the same fields plus owner_* and taxpayer_* (never
//      requested). Used only when the first layer answers with an error (e.g. the service is
//      retired), not after a timeout: both are on gismo.spokanecounty.org.
//
// What the fields hold, checked against the county's SCOUT property page ("Assessed Value"
// table, https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=...) for the
// 12 validation parcels:
//   asmt_year       2027 on every row: the "Tax Year" SCOUT lists these values under (values set
//                   in 2026, taxes payable 2027). tax_year (2026) is the current billing year.
//   land_value      SCOUT "Land": market land value (48121.9001: 591,360).
//   assessed_amt    the assessed total (market land + structures, or current-use land +
//                   structures when the land is classified: 48121.9001 forest land 10,280;
//                   48136.9052 = current-use land 57,610 + structure 42,300 = 99,910).
//   taxable_amt     SCOUT "Taxable" (35234.0602 with a senior exemption: 76,466 of 589,000).
//   exmp_code       exemption program: SA/SB/SC = Senior/Disabled Level A/B/C, MFUH, 2HIST, 1HOME
//                   (names from SCOUT); GOVT, DOR, SUCO, ... have no name on SCOUT.
//   exmp_amt        an exemption amount, but not for the asmt_year values (35234.0602: 541,200,
//                   while assessed - taxable is 512,534), so it is not used for the amount.
//   prop_use_code   WA DOR two-digit land use code (11, 83, 88, 91, ...), prop_use_desc the county's
//                   words for it ("Single Unit"). A tax category, not zoning.
//   acreage         assessor acres; tax_code_area the levy area.
// There is no improvement (structure) value field. When the land is not classified, assessed_amt
// equals SCOUT's market total, so improvements = assessed_amt - land_value (matches SCOUT's
// "Dwelling/Structure" on all 7 such validation parcels). When the land is in a current-use or
// forest program the assessed total cannot be split, so land and improvement values are null.
// No public Spokane County REST service has a tax amount or levy rate (searched every service on
// gismo.spokanecounty.org/arcgis/rest/services, 2026-11-10); the SCOUT page lists the tax bill,
// so the record links to it.
//
// Requests go through the shared client (src/shared/upstream.js), named non-personal fields only;
// mapSpokaneAssessorRecord() copies named fields after withoutPersonalFields. Found records are
// cached per normalized parcel number for 7 days (Cache API); misses and errors are not.
import { arcgisQuery, cachedJson } from '../shared/upstream.js';
import { isFallbackEligible } from '../shared/fallback.js';
import { withoutPersonalFields } from '../shared/personal-fields.js';

const SERVICES = 'https://gismo.spokanecounty.org/arcgis/rest/services';
export const SPOKANE_ASSESSOR = `${SERVICES}/ISDSDE/LandCapacityAnalysis/MapServer/0`;
export const SPOKANE_ASSESSOR_BACKUP = `${SERVICES}/CONNECTExplorer/CONNECTExplorer_REST/MapServer/14`;
export const SPOKANE_ASSESSOR_SOURCE = 'Spokane County Assessor (assessor parcel table, Spokane County GIS)';
// Never add owner_*, taxpayer_* or any mailing field (the backup layer has them).
// site_address, asmt_year_exmp_amt and exmp_amt are only for the legacy `records` entry.
export const SPOKANE_ASSESSOR_FIELDS = [
  'PID_NUM', 'prop_use_code', 'prop_use_desc', 'tax_year', 'asmt_year', 'land_value', 'assessed_amt', 'taxable_amt',
  'exmp_code', 'exmp_amt', 'asmt_year_exmp_amt', 'tax_code_area', 'acreage', 'seg_status', 'site_address'
].join(',');
// The keys of the `records` entry /api/property-assessment returned for Spokane before
// 2026-11-10 (from SCOUTSimple), kept for callers that read it.
const LEGACY_RECORD_FIELDS = ['PID_NUM', 'tax_year', 'asmt_year', 'land_value', 'exmp_amt', 'asmt_year_exmp_amt', 'acreage', 'site_address', 'prop_use_desc'];
const TIMEOUT_MS = 10000;
const BACKUP_TIMEOUT_MS = 8000;
// Bump the version whenever SPOKANE_ASSESSOR_FIELDS or the record mapping changes.
export const SPOKANE_ASSESSOR_CACHE_PREFIX = 'https://acresx.internal/cache/spokane-assessor/v1/';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const FIPS_PREFIX = '063';

// The county's SCOUT property page. The same URL is the statewide WA parcel layer's DATA_LINK
// for Spokane parcels (e.g. ...Summary.aspx?PID=35204.2729); it loads (HTTP 200, no redirect,
// "Parcel Number: 35204.2729", checked 2026-11-10). Built only from a record's own PID_NUM, and
// any SCOUT link from elsewhere is accepted only for exactly this host and path (path compared
// without case: the county uses /SCOUT/ and /scout/), with one PID parameter equal to the
// record's. It is rebuilt, so nothing else survives.
export const SPOKANE_SCOUT_HOST = 'cp.spokanecounty.org';
export const SPOKANE_SCOUT_PATH = '/SCOUT/propertyinformation/Summary.aspx';
export const SPOKANE_SCOUT_LABEL = 'View on Spokane County SCOUT';
const PID_FORMAT = /^\d{5}\.\d{4}$/;

export function spokaneScoutUrl(value, parcelNumber) {
  const pid = String(parcelNumber ?? '').trim();
  if (!PID_FORMAT.test(pid)) return null;
  if (value === undefined) return `https://${SPOKANE_SCOUT_HOST}${SPOKANE_SCOUT_PATH}?PID=${pid}`;
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname !== SPOKANE_SCOUT_HOST || url.port || url.username || url.password) return null;
  if (url.pathname.toLowerCase() !== SPOKANE_SCOUT_PATH.toLowerCase()) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'PID' || url.searchParams.get('PID') !== pid) return null;
  return `https://${SPOKANE_SCOUT_HOST}${SPOKANE_SCOUT_PATH}?PID=${pid}`;
}

// WA DOR land use codes for land in a current-use or designated-forest program (WAC 458-53-030).
const CURRENT_USE_PROGRAMS = Object.freeze({
  83: 'Current use: agriculture (RCW 84.34)',
  88: 'Designated forest land (RCW 84.33)',
  94: 'Current use: open space (RCW 84.34)',
  95: 'Current use: timberland (RCW 84.34)'
});
// Exemption codes whose names SCOUT shows (one parcel of each code checked, 2026-11-10).
export const SPOKANE_EXEMPTIONS = Object.freeze({
  SA: 'Senior/Disabled Level A', SB: 'Senior/Disabled Level B', SC: 'Senior/Disabled Level C',
  MFUH: 'Multi Family Urban Housing', '2HIST': 'Historical Designation', '1HOME': 'Home Improvement'
});

function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function str(value) { const s = String(value ?? '').trim(); return s || null; }

// What a realtor might type -> the PID_NUM form "35204.2729", or null when it cannot be one.
//   "35204.2729", " 35204.2729 ", "35204-2729", "35204 2729", "352042729"  -> "35204.2729"
//   "063-35204.2729", "06335204.2729", "063352042729"                        -> "35204.2729" (statewide PARCEL_ID_NR)
// Every real PID_NUM is 5 digits, a dot and 4 digits (all but 7 placeholder rows such as UNKNOWN).
export function normalizeSpokaneParcelId(parcelId) {
  let id = String(parcelId ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d{12}$/.test(id) && id.startsWith(FIPS_PREFIX)) id = id.slice(FIPS_PREFIX.length);
  return /^\d{9}$/.test(id) ? `${id.slice(0, 5)}.${id.slice(5)}` : null;
}

// The id comes from normalizeSpokaneParcelId (digits and one dot), so it needs no escaping.
export function spokaneAssessorWhere(id) {
  return `PID_NUM='${id}'`;
}

// "11 Single Unit" -> "Single Unit" (the layer gives the words alone today).
function classDescription(code, descr) {
  const d = str(descr); if (!d) return null;
  return code ? d.replace(new RegExp(`^\\s*${code.replace(/[^0-9A-Za-z]/g, '')}\\s*[-–:]?\\s+`), '').trim() || null : d;
}

function currentUse(code, assessed, marketLand) {
  const program = code != null ? CURRENT_USE_PROGRAMS[Number(code)] || null : null;
  if (program) return { status: 'classified', program };
  if (assessed != null && marketLand != null && assessed < marketLand) {
    return { status: 'reduced_land_value', program: null, note: 'The assessed value is below the market land value, which usually means part of the land is in a current-use or forest program. Verify with the assessor.' };
  }
  if (code == null && assessed == null) return { status: null, program: null };
  return { status: 'not_classified', program: null };
}

// Raw layer attributes -> the fields AcresX returns (same keys as Stevens and Kootenai where they
// mean the same thing). Named fields only (no spread of attrs). Missing values stay null, never 0.
export function mapSpokaneAssessorRecord(raw = {}) {
  const attrs = withoutPersonalFields(raw);
  const parcelNumber = str(attrs.PID_NUM);
  const code = str(attrs.prop_use_code);
  const assessed = num(attrs.assessed_amt), taxable = num(attrs.taxable_amt), marketLand = num(attrs.land_value);
  const valued = [assessed, taxable, marketLand].some(v => v != null && v !== 0);
  const use = currentUse(code, valued ? assessed : null, valued ? marketLand : null);
  const split = valued && (use.status === 'not_classified' || use.status === null) && assessed != null && marketLand != null && assessed >= marketLand;
  const exemptionCode = str(attrs.exmp_code);
  const exempted = valued && assessed != null && taxable != null && assessed > taxable ? assessed - taxable : null;
  const inProgram = use.status === 'classified' || use.status === 'reduced_land_value';
  const valuesNote = !valued ? 'The assessor record for this parcel carries no values. Check SCOUT or the Spokane County Assessor.'
    : inProgram ? 'The land is assessed at its current-use value, so the assessed total is below market. The county GIS does not split it into land and improvements; SCOUT has the full breakdown.'
      : null;
  return {
    parcelNumber,
    propertySearchUrl: spokaneScoutUrl(undefined, parcelNumber),
    propertySearchLabel: SPOKANE_SCOUT_LABEL,
    landValue: split ? marketLand : null,
    improvementValue: split ? assessed - marketLand : null,
    improvementValueNote: split ? 'Assessed total minus land value' : null,
    totalValue: valued ? assessed : null,
    taxableValue: valued ? taxable : null,
    // netValue is what the overview shows as "Net taxable" (same key as Kootenai and Stevens).
    netValue: valued ? taxable : null,
    marketLandValue: valued ? marketLand : null,
    marketValue: split ? assessed : null,
    exemption: exemptionCode || exempted ? { code: exemptionCode, description: exemptionCode ? SPOKANE_EXEMPTIONS[exemptionCode] || null : null, value: exempted } : null,
    taxYear: num(attrs.asmt_year),
    taxAmount: null,
    taxAmountNote: 'Not published in the county GIS. The SCOUT page lists the tax bill.',
    assessorAcres: num(attrs.acreage),
    taxCodeArea: str(attrs.tax_code_area),
    segStatus: str(attrs.seg_status),
    propertyClass: code, propertyClassDescription: classDescription(code, attrs.prop_use_desc),
    propertyClassNote: 'Tax category, not zoning',
    currentUse: use,
    ...(valuesNote ? { valuesNote } : {})
  };
}

// The `records` entry in the shape SCOUTSimple gave it (named fields only).
export function legacySpokaneRecord(raw = {}) {
  const attrs = withoutPersonalFields(raw);
  const out = {};
  for (const key of LEGACY_RECORD_FIELDS) if (key in attrs) out[key] = attrs[key];
  return out;
}

function errorMessage(error) {
  if (error?.kind === 'timeout' || error?.name === 'AbortError') return 'Spokane County Assessor timed out';
  const detail = String(error?.message || 'query failed');
  return detail.startsWith('Spokane County Assessor') ? detail : `Spokane County Assessor unavailable: ${detail}`;
}

function queryLayer(layer, id, { timeoutMs, label }) {
  return arcgisQuery(layer, { where: spokaneAssessorWhere(id), outFields: SPOKANE_ASSESSOR_FIELDS, returnGeometry: 'false', resultRecordCount: '5' }, {
    timeoutMs, retries: 0, label, agency: 'Spokane County Assessor',
    arcgisMessage: message => `Spokane County Assessor: ${message || 'query failed'}`
  });
}

// { status: 'found', record, legacy } | { status: 'not_found' } | { status: 'error', error, browserFallback }.
// browserFallback is true when the failure is one a browser might get past (src/shared/fallback.js).
export async function querySpokaneAssessment(parcelId) {
  const id = normalizeSpokaneParcelId(parcelId);
  if (!id) return { status: 'not_found' };
  let features;
  try {
    features = await queryLayer(SPOKANE_ASSESSOR, id, { timeoutMs: TIMEOUT_MS, label: 'spokane-assessor' });
  } catch (error) {
    // A timeout means the host is not answering; the backup is on the same host.
    if (error?.kind === 'timeout' || error?.kind === 'network') return { status: 'error', error: errorMessage(error), browserFallback: isFallbackEligible(error) };
    try {
      features = await queryLayer(SPOKANE_ASSESSOR_BACKUP, id, { timeoutMs: BACKUP_TIMEOUT_MS, label: 'spokane-assessor-backup' });
    } catch (backupError) {
      return { status: 'error', error: errorMessage(backupError), browserFallback: isFallbackEligible(error) || isFallbackEligible(backupError) };
    }
  }
  const row = features.map(f => f?.attributes || {}).find(a => str(a.PID_NUM) === id);
  if (!row) return { status: 'not_found' };
  return { status: 'found', record: mapSpokaneAssessorRecord(row), legacy: legacySpokaneRecord(row) };
}

// Same answer, with found records cached per normalized parcel number (validated answers only).
export function getSpokaneAssessment(parcelId, { ctx } = {}) {
  const key = normalizeSpokaneParcelId(parcelId);
  if (!key) return Promise.resolve({ status: 'not_found' });
  return cachedJson(SPOKANE_ASSESSOR_CACHE_PREFIX, key, CACHE_TTL_SECONDS, () => querySpokaneAssessment(key), {
    ctx, isValid: result => result?.status === 'found' && result.record?.parcelNumber === key
  });
}
