// Kootenai County Assessor values for /api/property-assessment.
//
// Source: Kootenai County GIS Assessor_Layers MapServer. Tax parcels are split by appraisal
// district into layers 5-10 ("TaxParcels D1".."D6") plus 11 ("TaxParcels Commercial"); all seven
// share the same 52 fields (checked live 2026-10-26). The caller does not know the district, so
// all seven layers are queried in parallel and the first hit wins (each PIN checked lived in
// exactly one layer).
//
// Why query and not MapServer/find: find answers in one request but cannot limit the returned
// fields, so every answer would carry owner names and mailing addresses. Query takes outFields,
// and KC_ASSESSOR_FIELDS lists only non-personal fields. mapKootenaiAssessorRecord() also copies
// named fields only, so owner data cannot reach the response even if the server sent it.
import { fetchWithTimeout } from '../shared/http.js';

export const KC_ASSESSOR = 'https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer';
export const KC_ASSESSOR_LAYERS = [5, 6, 7, 8, 9, 10, 11];
export const KC_ASSESSOR_SOURCE = 'Kootenai County Assessor (Assessor_Layers)';
// Never add Owner_*, *Name_Primary, Recipient_*, AttentionLine_*, DeliveryAddr_*, LastLine_*,
// City/State/PostalCd/Country_Primary here: those are the owner's name and mailing address.
export const KC_ASSESSOR_FIELDS = [
  'PIN', 'PID', 'AIN', 'EffStatus', 'ApprDist', 'property_class', 'Property_ClassDescr',
  'AssessValue_Date', 'AssessValue_Land', 'AssessValue_Imp', 'AssessValue_Net', 'HO_Exemption', 'PclArea_Acres'
].join(',');
const TIMEOUT_MS = 10000;

function sql(value) { return String(value || '').replaceAll("'", "''"); }
function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function str(value) { const s = String(value ?? '').trim(); return s || null; }

// PIN is the 12-character parcel number the app searches with (47N03W052200); PID is the dashed
// form (47N03W-05-2200). Kootenai parcel search accepts either, so this does too.
export function kootenaiAssessorWhere(parcelId) {
  const id = sql(String(parcelId || '').trim().toUpperCase());
  return `PIN='${id}' OR PID='${id}'`;
}

async function queryLayer(layerId, where) {
  const url = new URL(`${KC_ASSESSOR}/${layerId}/query`);
  for (const [k, v] of Object.entries({ where, outFields: KC_ASSESSOR_FIELDS, returnGeometry: 'false', f: 'json' })) url.searchParams.set(k, v);
  const response = await fetchWithTimeout(url, { cf: { cacheTtl: 900, cacheEverything: true } }, TIMEOUT_MS);
  if (!response.ok) throw new Error(`Kootenai County Assessor layer ${layerId} returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Kootenai County Assessor layer ${layerId}: ${data.error.message || 'query failed'}`);
  return data.features || [];
}

// AssessValue_Date is an integer yyyymmdd (20260101).
function assessmentDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ''));
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, year: Number(m[1]) } : { date: null, year: null };
}

// Property_ClassDescr repeats the code ("512- Rural residential tract"); keep the words only.
function classDescription(code, descr) {
  const d = str(descr); if (!d) return null;
  return code ? d.replace(new RegExp(`^\\s*${code.replace(/[^0-9A-Za-z]/g, '')}\\s*[-–:]\\s*`), '').trim() || null : d;
}

// Raw layer attributes -> the fields AcresX returns. Named fields only (no spread of attrs).
export function mapKootenaiAssessorRecord(attrs = {}, layerId = null) {
  const land = num(attrs.AssessValue_Land), imp = num(attrs.AssessValue_Imp);
  const { date, year } = assessmentDate(attrs.AssessValue_Date);
  const code = str(attrs.property_class);
  return {
    pin: str(attrs.PIN), pid: str(attrs.PID), ain: str(attrs.AIN), status: str(attrs.EffStatus),
    appraisalDistrict: num(attrs.ApprDist), layerId,
    landValue: land, improvementValue: imp,
    totalValue: land != null || imp != null ? (land || 0) + (imp || 0) : null,
    homeownerExemption: num(attrs.HO_Exemption), netValue: num(attrs.AssessValue_Net),
    assessmentDate: date, taxYear: year,
    assessorAcres: num(attrs.PclArea_Acres),
    propertyClass: code, propertyClassDescription: classDescription(code, attrs.Property_ClassDescr)
  };
}

// { status: 'found', record } | { status: 'not_found' } | { status: 'error', error }.
// A layer that fails while no other layer has the PIN makes the answer an error, because the
// PIN may be in the failed layer.
export async function getKootenaiAssessment(parcelId) {
  const where = kootenaiAssessorWhere(parcelId);
  const settled = await Promise.allSettled(KC_ASSESSOR_LAYERS.map(async layerId => ({ layerId, features: await queryLayer(layerId, where) })));
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value.features.length) {
      return { status: 'found', record: mapKootenaiAssessorRecord(s.value.features[0].attributes || {}, s.value.layerId) };
    }
  }
  const failures = settled.filter(s => s.status === 'rejected');
  if (failures.length) {
    const reason = failures[0].reason;
    const detail = String(reason?.message || 'query failed');
    const message = reason?.name === 'AbortError' ? 'Kootenai County Assessor timed out'
      : detail.startsWith('Kootenai County Assessor') ? detail : `Kootenai County Assessor unavailable: ${detail}`;
    return { status: 'error', error: failures.length > 1 ? `${message} (${failures.length} of ${KC_ASSESSOR_LAYERS.length} layers failed)` : message };
  }
  return { status: 'not_found' };
}
