// Conservation easements from PAD-US 4.1 (USGS Gap Analysis Project, 2025), every state, for
// /api/recorded-restrictions (src/services/recorded-restrictions.js).
//
// Layer: Protection_Mechanism_Category_PADUS FeatureServer/0, filtered to Category='Easement'.
// PAD-US succeeds NCED (NCED says it has not been updated since January 2025 and points to
// PAD-US). Public domain; about 5% of easements are withheld as sensitive and the data is not for
// legal use, so "none mapped" is never read as "none exist".
// Fields read: Unit_Nm, EsmtHldr, EHoldTyp, Src_Date, Pub_Access, GIS_Acres. Own_Name and
// Own_Type are not requested (for easements they describe the underlying private owner type, and
// AcresX never returns owner fields).
// Matched by overlap with the parcel outline: a polygon that only touches the boundary (covers no
// sample point inside the parcel) is dropped; the share of the parcel covered is reported.
import { restrictionQuery, pointParams, polygonParams, overlapping, sharePct, text, isoDate } from '../shared/restrictions.js';

export const PADUS_EASEMENTS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Protection_Mechanism_Category_PADUS/FeatureServer/0';
export const PADUS_SOURCE = 'PAD-US 4.1 conservation easements (USGS, 2025)';
const PADUS_FIELDS = 'Unit_Nm,EsmtHldr,EHoldTyp,Src_Date,Pub_Access,GIS_Acres';

export const HOLDER_TYPES = Object.freeze({
  FED: 'Federal agency', STAT: 'State agency', LOC: 'Local government', DIST: 'Special district', NGO: 'Nonprofit / land trust',
  PVT: 'Private', JNT: 'Joint', TRIB: 'Tribal', UNK: 'Unknown'
});

export function padusEasement(attributes = {}, share) {
  const type = String(attributes.EHoldTyp || '').trim().toUpperCase();
  return {
    name: text(attributes.Unit_Nm, 120) || 'Conservation easement',
    holder: text(attributes.EsmtHldr, 120),
    holderType: HOLDER_TYPES[type] || null,
    deedRef: null,
    date: isoDate(attributes.Src_Date),
    sharePct: sharePct(share),
    source: PADUS_SOURCE
  };
}

export async function findPadusEasements({ rings, point }, { signal } = {}) {
  const params = rings ? polygonParams(rings, { offset: '0.0001' }) : point ? pointParams(point) : null;
  if (!params) return [];
  const features = await restrictionQuery(PADUS_EASEMENTS, { ...params, where: "Category='Easement'", outFields: PADUS_FIELDS }, { agency: 'PAD-US (USGS)', label: 'padus-easements', signal });
  return (rings ? overlapping(rings, features) : features.map(feature => ({ feature, share: null })))
    .map(({ feature, share }) => padusEasement(feature.attributes || {}, share));
}
