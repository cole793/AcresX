// Stevens County (WA) recorded-restriction sources for /api/recorded-restrictions.
//
// - RealPropertyParcels_Public MapServer/0, matched by parcel number (PARCELN, 7 characters with
//   leading zeros): legal_desc only. e.g. 0434200 "MINES PATENTED SURVEY #1179 DIAMOND CROWN 13.71
//   ACRES, ls co rd &" (a patented mining claim, not a plat). The layer also holds the owner's
//   name and mailing address (file_as_na, last_name, first_name, owner_id, addr_*): never
//   requested.
// - Assessors_Data_Share MapServer/7 "Subdivisions" (Plat_name, Auditors_number = the Auditor's
//   recording number, Plat_location = plat book and page such as "A-43-45",
//   Plat_signed_by_Auditor, Lot, Block), matched by one interior point. Only 474 plats are mapped
//   (mostly town plats), so "no plat here" is read with the legal description.
// - Assessors_Data_Share MapServer/21 "Conservation Easements" (PARCELN, COMMENT), matched by
//   overlap with the parcel outline. EditorName and the *_user fields are never requested.
import { restrictionQuery, pointParams, polygonParams, overlapping, sharePct, text, isoDate } from '../shared/restrictions.js';

export const STEVENS_PARCELS = 'https://gis.stevenscountywa.gov/server/rest/services/RealPropertyParcels_Public/MapServer/0';
export const STEVENS_SUBDIVISIONS = 'https://gis.stevenscountywa.gov/server/rest/services/Assessors_Data_Share/MapServer/7';
export const STEVENS_EASEMENTS = 'https://gis.stevenscountywa.gov/server/rest/services/Assessors_Data_Share/MapServer/21';
export const STEVENS_PARCELS_SOURCE = 'Stevens County Assessor (parcel legal description)';
export const STEVENS_SUBDIVISIONS_SOURCE = 'Stevens County Assessor (Subdivisions layer)';
export const STEVENS_EASEMENTS_SOURCE = 'Stevens County Assessor (Conservation Easements layer)';
export const STEVENS_RECORDER = { label: 'Stevens County Auditor recorded document search', url: 'https://selfservice.stevenscountywa.gov/web/' };

export const stevensParcelNumber = parcelId => {
  const digits = String(parcelId ?? '').replace(/^065-/, '').replace(/\D/g, '');
  return digits && digits.length <= 7 ? digits.padStart(7, '0') : null;
};

// What the legal description says, conservatively.
export function stevensLegalPlat(legal) {
  const s = text(legal, 254);
  if (!s) return null;
  const base = { legalDescription: s, source: { name: STEVENS_PARCELS_SOURCE, url: STEVENS_PARCELS }, matchedBy: 'legal_description' };
  const survey = s.match(/\b(?:MINES?\s+PATENTED\s+SURVEY|MINERAL\s+SURVEY|M\.\s?S\.)\s*#?\s*(\d+)/i);
  if (survey) return { ...base, status: 'unplatted', kind: 'mining_claim', name: 'Patented mining claim', record: `Mineral Survey #${survey[1]}` };
  if (/\bSHORT\s+PLAT\b|\bS\.?P\.?\s*#?\s*\d/i.test(s)) return { ...base, status: 'platted', kind: 'short_plat', name: null };
  if (/\b(LOTS?|LTS?|BLK|BLOCK)\b/i.test(s) && /\b(ADD(ITION)?|PLAT|SUBD?|SUBDIVISION|TRACTS|ESTATES|ACRES)\b/i.test(s)) return { ...base, status: 'platted', kind: 'subdivision', name: null };
  return { ...base, status: 'unplatted', kind: 'metes_and_bounds' };
}

export function stevensSubdivisionPlat(attrs = {}) {
  const name = text(attrs.Plat_name, 75);
  if (!name) return null;
  const auditor = Number(attrs.Auditors_number);
  return {
    status: 'platted', kind: /SHORT\s*PLAT|^SP\b/i.test(name) ? 'short_plat' : 'subdivision', name,
    recordingNumber: Number.isFinite(auditor) && auditor > 0 ? String(Math.round(auditor)) : null,
    platBook: text(attrs.Plat_location, 50), recordedDate: isoDate(attrs.Plat_signed_by_Auditor),
    lot: text(attrs.Lot, 20), block: text(attrs.Block, 20),
    source: { name: STEVENS_SUBDIVISIONS_SOURCE, url: STEVENS_SUBDIVISIONS }, matchedBy: 'interior_point'
  };
}

export function stevensEasement(attributes = {}, share) {
  return { name: 'Conservation easement', holder: null, holderType: null, note: text(attributes.COMMENT, 75), deedRef: null, date: null, sharePct: sharePct(share), source: STEVENS_EASEMENTS_SOURCE };
}

export async function getStevensRestrictions({ parcelId, point, rings, signal }) {
  const opts = label => ({ agency: 'Stevens County GIS', label, signal });
  const parceln = stevensParcelNumber(parcelId);
  const ceParams = rings ? polygonParams(rings) : point ? pointParams(point) : null;
  const [legal, subdivisions, easements] = await Promise.allSettled([
    parceln ? restrictionQuery(STEVENS_PARCELS, { where: `PARCELN='${parceln}'`, outFields: 'PARCELN,legal_desc' }, opts('stevens-parcel-legal')) : Promise.resolve([]),
    point ? restrictionQuery(STEVENS_SUBDIVISIONS, { ...pointParams(point), outFields: 'Plat_name,Auditors_number,Plat_location,Plat_signed_by_Auditor,Lot,Block' }, opts('stevens-subdivisions')) : Promise.reject(new Error('no point')),
    ceParams ? restrictionQuery(STEVENS_EASEMENTS, { ...ceParams, outFields: 'PARCELN,COMMENT' }, opts('stevens-conservation-easements')) : Promise.reject(new Error('no geometry'))
  ]);
  const fromLegal = legal.status === 'fulfilled' ? stevensLegalPlat(legal.value[0]?.attributes?.legal_desc) : null;
  const fromLayer = subdivisions.status === 'fulfilled' ? subdivisions.value.map(f => stevensSubdivisionPlat(f.attributes || {})).find(Boolean) || null : null;
  const plat = fromLayer ? { ...fromLayer, legalDescription: fromLegal?.legalDescription || null } : fromLegal;
  let list = null;
  if (easements.status === 'fulfilled') {
    const rows = rings ? overlapping(rings, easements.value) : easements.value.map(feature => ({ feature, share: null }));
    list = rows.map(({ feature, share }) => stevensEasement(feature.attributes || {}, share));
  }
  return {
    plat,
    countyEasements: list,
    sources: [
      { key: 'stevens-parcel-legal', name: STEVENS_PARCELS_SOURCE, url: STEVENS_PARCELS, status: legal.status === 'fulfilled' ? 'ok' : 'unavailable' },
      { key: 'stevens-subdivisions', name: STEVENS_SUBDIVISIONS_SOURCE, url: STEVENS_SUBDIVISIONS, status: subdivisions.status === 'fulfilled' ? 'ok' : 'unavailable' },
      { key: 'stevens-conservation-easements', name: STEVENS_EASEMENTS_SOURCE, url: STEVENS_EASEMENTS, status: easements.status === 'fulfilled' ? 'ok' : 'unavailable' }
    ],
    recorder: STEVENS_RECORDER
  };
}
