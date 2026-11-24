// Spokane County (WA) sources and codes for the parcel index (docs/explore-index.md sections 1-2;
// handoff/findings.md "2026-11-23: Parcel index sources"). County field names stay in this file.
//
//   attributes  ISDSDE/LandCapacityAnalysis/MapServer/0 (the fast assessor layer, ~0.3 s per
//               query): PID_NUM, prop_use_code (WA DOR land use code), exmp_code, acreage, values.
//               The named fields of src/counties/spokane-assessor.js SPOKANE_ASSESSOR_FIELDS; the
//               layer has no owner, taxpayer or mailing field at all.
//   outlines    Assessor/Parcels/MapServer/0, the layer the live parcel search reads
//               (src/counties/spokane-parcels.js), with its named fields and outSR 4326, by PID.
//   city limits SCOUT/PermittingLookup/MapServer/0 "Jurisdictions" (src/counties/spokane-cities.js):
//               NAME 'Spokane County' is unincorporated; Fairchild Air Force Base (MUNITYP
//               'Other') counts as outside city limits.
//   public land PAD-US 4.1 Fee polygons (src/services/padus-easements.js's service), Category='Fee'.
import { SPOKANE_PARCEL_LAYER, SPOKANE_PARCEL_FIELDS, mapSpokaneParcel } from '../../src/counties/spokane-parcels.js';
import { SPOKANE_ASSESSOR, SPOKANE_ASSESSOR_FIELDS, mapSpokaneAssessorRecord } from '../../src/counties/spokane-assessor.js';
import { SPOKANE_JURISDICTIONS, decideJurisdiction } from '../../src/counties/spokane-cities.js';
import { PADUS_EASEMENTS } from '../../src/services/padus-easements.js';
import { esriPolygonToGeoJSON } from '../../src/counties/kootenai-parcels.js';
import { queryJson, pageAll, countRows, sqlString } from '../arcgis.mjs';
import { preparePolygons, sharesByKey, coverOf } from '../overlay.mjs';
import { PUBLIC_OWNER_TYPES, PUBLIC_LAND_MIN_SHARE } from '../config.mjs';

export const COUNTY_KEY = 'spokane';
export const STATE = 'WA';
export const WHERE = Object.freeze({ state: 'WA', county: 'Spokane' }); // the page's selects
// The county's extent with a margin, for the PAD-US query when the city-limits layer (whose
// polygons give the exact extent) did not answer. [xmin, ymin, xmax, ymax], WGS84.
export const COUNTY_BBOX = Object.freeze([-117.9, 47.2, -117.0, 48.1]);
export const LABELS = Object.freeze({
  parcel: 'Spokane County GIS (Assessor/Parcels layer)',
  assessment: 'Spokane County Assessor (LandCapacityAnalysis layer)',
  cityLimits: 'Spokane County GIS Jurisdictions (SCOUT/PermittingLookup/0)'
});
export const SOURCES = Object.freeze({
  attributes: SPOKANE_ASSESSOR, outlines: SPOKANE_PARCEL_LAYER, cityLimits: SPOKANE_JURISDICTIONS, publicLand: PADUS_EASEMENTS
});
// No owner_*, taxpayer_* or mailing field is ever requested (assert in test/index-pipeline.test.js).
export const ATTRIBUTE_FIELDS = SPOKANE_ASSESSOR_FIELDS;
export const OUTLINE_FIELDS = SPOKANE_PARCEL_FIELDS;
export const PADUS_FEE_FIELDS = 'OBJECTID,Category,Own_Type,Mang_Type,Des_Tp,Unit_Nm,GIS_Acres';
const OUTLINE_BATCH = 100;

// ---- Exclusion codes (docs/explore-index.md section 1). WA DOR land use codes, WAC 458-53-030(5).
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
export const EXCLUDED_USE_CODES = Object.freeze({
  condo: Object.freeze(['14', '50']),
  // "16, 21-39, 51-59, 61-66 (list to finish against the WAC), plus 43 aircraft, 44 marine, 46 parking"
  commercial_industrial: Object.freeze(['16', ...range(21, 39), ...range(51, 59), ...range(61, 66), '43', '44', '46']),
  right_of_way: Object.freeze(['41', '42', '45', '47', '48', '49']),
  // 67 governmental services (a WAC code, used on its own).
  public_land: Object.freeze(['67'])
});
// Spokane exmp_code hints (meanings unconfirmed, Q2): public land only together with PAD-US Fee
// land touching the parcel.
export const PUBLIC_EXEMPTION_HINTS = Object.freeze(['GOVT', 'WATD', 'CEM']);

const str = v => String(v ?? '').trim();
const useCode = v => { const s = str(v); return /^\d$/.test(s) ? `0${s}` : s; };

export function codeExclusion(row) {
  const code = useCode(row.propUseCode);
  for (const [reason, codes] of Object.entries(EXCLUDED_USE_CODES)) if (codes.includes(code)) return reason;
  return null;
}
export const publicHint = row => PUBLIC_EXEMPTION_HINTS.includes(str(row.exmpCode).toUpperCase());

// Layer attributes -> the row the rule and the index read. improved: assessor improvement value
// > 0 (the report's "Assessor lists improvements" test, public/coverage-trust.js existingStructure,
// on the /api/property-assessment record mapSpokaneAssessorRecord builds); null when the values
// cannot be split (current-use land) or are missing.
export function attributeRow(attrs = {}) {
  const assessment = mapSpokaneAssessorRecord(attrs);
  const imp = assessment.improvementValue;
  return {
    pid: str(attrs.PID_NUM),
    acreage: Number.isFinite(Number(attrs.acreage)) && attrs.acreage !== null ? Number(attrs.acreage) : null,
    propUseCode: useCode(attrs.prop_use_code) || null,
    exmpCode: str(attrs.exmp_code) || null,
    improved: imp == null || !Number.isFinite(Number(imp)) ? null : Number(imp) > 0 ? 1 : 0,
    assessment
  };
}

export const countAttributes = () => countRows(SPOKANE_ASSESSOR);

// Every assessor row (attributes only). Duplicate PIDs keep the first row.
export async function pullAttributes({ maxRows, onPage } = {}) {
  const features = await pageAll(SPOKANE_ASSESSOR, { outFields: ATTRIBUTE_FIELDS, label: 'spokane-assessor', maxRows, onPage });
  const rows = new Map();
  for (const f of features) { const row = attributeRow(f.attributes || {}); if (!rows.has(row.pid)) rows.set(row.pid, row); }
  return [...rows.values()];
}

// Only these ids (--ids, the parity check): same fields, by PID.
export async function pullAttributesById(pids) {
  const rows = new Map();
  for (let i = 0; i < pids.length; i += OUTLINE_BATCH) {
    const batch = pids.slice(i, i + OUTLINE_BATCH);
    const data = await queryJson(SPOKANE_ASSESSOR, { where: `PID_NUM IN (${batch.map(sqlString).join(',')})`, outFields: ATTRIBUTE_FIELDS, returnGeometry: 'false' }, { label: 'spokane-assessor-ids' });
    for (const f of data?.features || []) { const row = attributeRow(f.attributes || {}); if (!rows.has(row.pid)) rows.set(row.pid, row); }
  }
  return [...rows.values()];
}

// Duplicate rows (the same outline stored twice): identical parts kept once
// (src/counties/spokane-parcels.js mergeGeometries, same rule).
function mergeGeometries(geometries) {
  const polygons = [], seen = new Set();
  for (const g of geometries) {
    const parts = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of parts) { const key = JSON.stringify(p); if (!seen.has(key)) { seen.add(key); polygons.push(p); } }
  }
  if (!polygons.length) return null;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

// pid -> the Feature /api/parcel-search would answer (mapSpokaneParcel), from the parcel layer.
export async function fetchOutlines(pids) {
  const out = new Map();
  for (let i = 0; i < pids.length; i += OUTLINE_BATCH) {
    const batch = pids.slice(i, i + OUTLINE_BATCH).filter(Boolean);
    if (!batch.length) continue;
    const data = await queryJson(SPOKANE_PARCEL_LAYER, {
      where: `PID_NUM IN (${batch.map(sqlString).join(',')})`, outFields: OUTLINE_FIELDS, returnGeometry: 'true', outSR: '4326'
    }, { label: 'spokane-outlines' });
    const byPid = new Map();
    for (const f of data?.features || []) {
      const pid = str(f?.attributes?.PID_NUM);
      if (!byPid.has(pid)) byPid.set(pid, []);
      byPid.get(pid).push(f);
    }
    for (const [pid, rows] of byPid) {
      const geometry = mergeGeometries(rows.map(f => esriPolygonToGeoJSON(f.geometry)));
      if (geometry) out.set(pid, mapSpokaneParcel(rows[0].attributes, geometry));
    }
  }
  return out;
}

// ---- City limits

const jurisdictionKey = value => str(value).replace(/\s+/g, ' ').toUpperCase();
const UNINCORPORATED = 'SPOKANE COUNTY';

// { polygons (cities, towns and Fairchild AFB only), countyBbox }.
export async function fetchCityLimits() {
  const data = await queryJson(SPOKANE_JURISDICTIONS, { where: '1=1', outFields: 'NAME,MUNITYP', returnGeometry: 'true', outSR: '4326' }, { label: 'spokane-jurisdictions' });
  const all = preparePolygons(data?.features || []);
  if (!all.length) throw new Error('spokane-jurisdictions: no polygons');
  const bbox = all.reduce((b, p) => [Math.min(b[0], p.bbox[0]), Math.min(b[1], p.bbox[1]), Math.max(b[2], p.bbox[2]), Math.max(b[3], p.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  // The county polygon has the cities cut out, so "no city polygon" is unincorporated; leaving it
  // out keeps each test to the city polygons near the parcel.
  return { polygons: all.filter(p => jurisdictionKey(p.attributes.NAME) !== UNINCORPORATED), countyBbox: bbox, features: all.length };
}

// { inCity: 0 | 1, cityName, share } by the majority rule of src/counties/spokane-cities.js
// (decideJurisdiction). Fairchild Air Force Base is outside city limits.
export function cityOf(parcel, cityLimits) {
  const shares = sharesByKey(parcel, cityLimits.polygons, a => jurisdictionKey(a.NAME));
  const decision = decideJurisdiction(shares);
  const city = decision.city;
  if (!city || city.federal) return { inCity: 0, cityName: null, share: decision.share, jurisdiction: city?.name || 'unincorporated Spokane County' };
  return { inCity: 1, cityName: city.name, share: decision.share, jurisdiction: city.name };
}

// ---- Public land (PAD-US Fee)

export async function fetchPublicLand(countyBbox) {
  const [xmin, ymin, xmax, ymax] = countyBbox;
  const features = [];
  for (let offset = 0; ; offset += 2000) {
    const data = await queryJson(PADUS_EASEMENTS, {
      where: "Category='Fee'", geometry: JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: PADUS_FEE_FIELDS,
      returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', orderByFields: 'OBJECTID', resultOffset: offset, resultRecordCount: 2000
    }, { label: 'padus-fee' });
    const page = data?.features || [];
    features.push(...page);
    if (page.length < 2000 && !data?.exceededTransferLimit) break;
    if (!page.length) break;
  }
  return { polygons: preparePolygons(features), features: features.length };
}

const isPublicOwner = a => PUBLIC_OWNER_TYPES.includes(str(a.Own_Type).toUpperCase());

// { share, touches, coversMost }
export function publicLandOf(parcel, publicLand) {
  const cover = coverOf(parcel, publicLand.polygons, isPublicOwner);
  return { share: cover.share, touches: cover.touches, coversMost: cover.share >= PUBLIC_LAND_MIN_SHARE };
}
