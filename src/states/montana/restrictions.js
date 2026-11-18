// Montana recorded-restriction sources for /api/recorded-restrictions
// (src/services/recorded-restrictions.js).
//
// 1. Montana Cadastral (DNRC DNRALL/Cadastral FeatureServer/0), matched by parcel ID (PARCELID =
//    the 17-digit geocode). Subdivision, CertificateOfSurvey and LegalDescriptionShort tell
//    whether the parcel is in a recorded subdivision plat or certificate of survey (COS), e.g.
//    Yellowstone 03092732390050000: "HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)";
//    Gallatin 06069905302080000: "S05, T03 S, R06 E, C.O.S. 1103K, PARCEL 8A-2, ACRES 10.001".
//    Used for every Montana county; Gallatin and Yellowstone add their county layers.
//    The layer also carries OwnerName, OwnerAddress1-3, OwnerCity/State/ZipCode and
//    CareOfTaxpayer: never requested (CADASTRAL_FIELDS names every field read).
// 2. Montana State Library conservation easements (GEOINFO/DigitalAtlas_Admin MapServer/1,
//    published 2025-05-30): EaseHolder (coded), EaseDate, DeedRef (a recording reference such as
//    "Doc 2130610" or "M 159 Page 651"), GISAcreage. Matched by overlap with the parcel outline.
//    Not for legal use (the State Library says so); shown as a mapped screening flag.
import { restrictionQuery, pointParams, polygonParams, overlapping, sharePct, text, isoDate, httpsOn } from '../../shared/restrictions.js';

export const MT_CADASTRAL = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
export const MT_CADASTRAL_SOURCE = 'Montana Cadastral (DNRC / Montana State Library)';
// Never add OwnerName, OwnerAddress*, OwnerCity/State/ZipCode or CareOfTaxpayer.
export const CADASTRAL_FIELDS = 'PARCELID,LegalDescriptionShort,Subdivision,CertificateOfSurvey,PropertyCardLink';
export const MT_EASEMENTS = 'https://mslgis.mt.gov/arcgishosting/rest/services/GEOINFO/DigitalAtlas_Admin/MapServer/1';
export const MT_EASEMENTS_SOURCE = 'Montana conservation easements (Montana State Library, 2025)';
const MT_EASEMENT_FIELDS = 'EaseHolder,EaseDate,DeedRef,GISAcreage';
const CARD_HOSTS = ['svc.mt.gov'];

// EaseHolder coded values (the layer's domain, read 2026-11-18). Organizations, not people.
export const MT_EASEMENT_HOLDERS = Object.freeze({
  0: 'Unknown', 10: 'US Government', 11: 'US Bureau of Land Management', 12: 'US Bureau of Reclamation', 13: 'US Fish and Wildlife Service',
  14: 'National Park Service', 15: 'US Forest Service', 16: 'US Dept of Agriculture', 17: 'US Army Corps of Engineers', 18: 'US Dept of Defense',
  20: 'State of Montana', 21: 'Montana State Trust Lands', 22: 'Montana Fish, Wildlife, and Parks', 23: 'Montana University System',
  24: 'Montana Dept of Corrections', 25: 'Montana Dept of Transportation', 26: 'Montana Dept of Natural Resources Water Projects',
  30: 'Local Government', 31: 'County Government', 32: 'City Government', 40: 'Bureau of Indian Affairs Trust Land', 52: 'Plum Creek Timber Company',
  60: 'Private Land Trust', 61: 'The Nature Conservancy', 62: 'Montana Land Reliance', 63: 'Rocky Mountain Elk Foundation', 64: 'Ducks Unlimited',
  65: 'Boone and Crockett Club', 66: 'Five Valleys Land Trust', 67: 'Flathead Land Trust', 68: 'Gallatin Valley Land Trust', 69: 'Prickly Pear Land Trust',
  71: 'Bitter Root Land Trust', 72: 'Blackfeet Land Trust', 73: 'Mid-Yellowstone Land Trust', 74: 'Vital Ground Foundation', 75: 'The Bighorn Institute',
  76: 'National Wildlife Federation', 77: 'Rattlesnake Land Trust', 78: 'Clark Fork- Pend Oreille Conservancy', 79: 'The Blackfoot Challenge',
  100: 'Montana Conservation Trust', 101: 'Humane Society Wildlife Land Trust', 102: 'The Conservation Fund', 103: 'Mule Deer Foundation',
  104: 'American Prairie Foundation', 105: 'Kaniksu Land Trust, Inc.', 106: 'Institute of the Rockies'
});

export const geocodeOf = parcelId => String(parcelId ?? '').replace(/\D/g, '');

// "HARVEY SUBD, S32, T01 S, R26 E, BLOCK 1, Lot 5A, AMD (25)" -> { block: '1', lot: '5A', tract, amended }
export function parseMontanaLegal(legal) {
  const s = String(legal || '');
  const block = s.match(/\bBLOCK\s+([A-Z0-9-]+)/i)?.[1] || null;
  const lot = s.match(/\bLOTS?\s+([A-Z0-9-]+(?:\s*&\s*[A-Z0-9-]+)*)/i)?.[1] || null;
  const tract = s.match(/\b(?:PARCEL|TRACT|TR\.?)\s+([A-Z0-9-]+)/i)?.[1] || null;
  return { block, lot, tract, amended: /\bAMD\b|\bAMENDED\b/i.test(s) };
}

// Cadastral row -> plat fields (or a "not in a plat or COS" record when the row has neither).
export function cadastralPlat(attrs = {}) {
  const legal = text(attrs.LegalDescriptionShort, 200);
  const subdivision = text(attrs.Subdivision, 80);
  const cos = text(attrs.CertificateOfSurvey, 40);
  const parts = parseMontanaLegal(legal);
  const card = httpsOn(attrs.PropertyCardLink, CARD_HOSTS);
  const base = { legalDescription: legal, propertyCard: card ? { label: 'Montana Cadastral property record', url: card } : null, source: { name: MT_CADASTRAL_SOURCE, url: 'https://svc.mt.gov/msl/cadastral/' }, matchedBy: 'parcel_id' };
  if (subdivision) return { ...base, status: 'platted', kind: 'subdivision', name: subdivision, block: parts.block, lot: parts.lot, amended: parts.amended || null };
  if (cos) return { ...base, status: 'surveyed', kind: 'certificate_of_survey', name: `Certificate of Survey ${cos}`, record: `COS ${cos}`, tract: parts.tract };
  if (legal) return { ...base, status: 'unplatted', kind: 'metes_and_bounds' };
  return null;
}

export async function findCadastralPlat(parcelId, { signal } = {}) {
  const geocode = geocodeOf(parcelId);
  if (geocode.length < 13) return null;
  const features = await restrictionQuery(MT_CADASTRAL, { where: `PARCELID='${geocode}'`, outFields: CADASTRAL_FIELDS }, { agency: 'Montana Cadastral', label: 'mt-cadastral-restrictions', signal });
  return features.length ? cadastralPlat(features[0].attributes || {}) : null;
}

export function mtEasement(attributes = {}, share) {
  const code = Number(attributes.EaseHolder);
  return {
    name: 'Conservation easement',
    holder: Number.isInteger(code) ? (MT_EASEMENT_HOLDERS[code] || `Holder code ${code}`) : null,
    holderType: null,
    deedRef: text(attributes.DeedRef, 40),
    date: isoDate(attributes.EaseDate),
    sharePct: sharePct(share),
    source: MT_EASEMENTS_SOURCE
  };
}

// Conservation easements overlapping the parcel (polygon when known, else the point).
export async function findMontanaEasements({ rings, point }, { signal } = {}) {
  const params = rings ? polygonParams(rings, { offset: '0.0001' }) : point ? pointParams(point) : null;
  if (!params) return [];
  const features = await restrictionQuery(MT_EASEMENTS, { ...params, outFields: MT_EASEMENT_FIELDS }, { agency: 'Montana State Library', label: 'mt-conservation-easements', signal });
  return (rings ? overlapping(rings, features) : features.map(feature => ({ feature, share: null })))
    .map(({ feature, share }) => mtEasement(feature.attributes || {}, share));
}
