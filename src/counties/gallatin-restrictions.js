// Gallatin County (MT) plat / certificate-of-survey record for /api/recorded-restrictions.
//
// Source: the county's ArcGIS Online Parcel_Platview FeatureServer/3, matched by GEOCODE (the
// 17-digit Montana geocode, the parcel number AcresX searches). Read 2026-11-17/18:
//   L0GIS_OwnerParcel_CLASS   MAJOR SUBDIVISION | MINOR SUBDIVISION | COS | DEED | UNKNOWN | ...
//   L0GIS_OwnerParcel_RECORD  "COS 1103K" (survey) or the plat record ("J-194")
//   SUB_NAME                  subdivision name (" " when none)
//   L0GIS_OwnerParcel_BLOCK / _LOT ("TR. 8A-2", "LOT 17") / _DATE_SURV ("02/06/1997")
//   plat_url_sub / plat_url_plss  " | "-separated plat-book page images on ftp.gallatin.mt.gov
//                             (assessor plat-book pages, not the recorded plat with its notes)
// e.g. 06069905302080000: COS, "COS 1103K", lot "TR. 8A-2", surveyed 02/06/1997, no image.
// The layer also has OWNCODE, MAPPER and *_user fields: never requested (PLATVIEW_FIELDS).
// When Platview fails or has no row, the statewide Montana Cadastral record is used instead.
import { restrictionQuery, text, isoDate, httpsOn } from '../shared/restrictions.js';
import { findCadastralPlat, geocodeOf } from '../states/montana/restrictions.js';

export const GALLATIN_PLATVIEW = 'https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/Parcel_Platview/FeatureServer/3';
export const GALLATIN_PLATVIEW_SOURCE = 'Gallatin County GIS (Parcel Platview)';
// Never add L0GIS_OwnerParcel_OWNCODE, _MAPPER or the *_user fields.
export const PLATVIEW_FIELDS = ['GEOCODE', 'SUB_NAME', 'L0GIS_OwnerParcel_CLASS', 'L0GIS_OwnerParcel_RECORD', 'L0GIS_OwnerParcel_BLOCK',
  'L0GIS_OwnerParcel_LOT', 'L0GIS_OwnerParcel_DATE_SURV', 'plat_url_sub', 'plat_url_plss'].join(',');
export const GALLATIN_RECORDER = { label: 'Gallatin County Clerk & Recorder document search', url: 'https://eagleweb.gallatin.mt.gov/recorder/web/' };
const IMAGE_HOSTS = ['ftp.gallatin.mt.gov'];

function platImages(attrs) {
  const urls = [attrs.plat_url_sub, attrs.plat_url_plss].filter(Boolean).join(' | ').split('|').map(u => httpsOn(u, IMAGE_HOSTS)).filter(Boolean);
  return [...new Set(urls)].slice(0, 3).map((url, i, all) => ({ label: all.length > 1 ? `County plat book page ${i + 1}` : 'County plat book page', url }));
}

// Platview row -> plat fields.
export function gallatinPlat(attrs = {}) {
  const cls = String(attrs.L0GIS_OwnerParcel_CLASS || '').trim().toUpperCase();
  const record = text(attrs.L0GIS_OwnerParcel_RECORD, 40);
  const name = text(attrs.SUB_NAME, 120);
  const lotText = text(attrs.L0GIS_OwnerParcel_LOT, 40);
  const tract = lotText?.match(/^TR(?:ACT)?\.?\s*(.+)$/i)?.[1] || null;
  const lot = tract ? null : (lotText?.replace(/^LOTS?\s+/i, '') || null);
  const base = {
    record, block: text(attrs.L0GIS_OwnerParcel_BLOCK, 20), lot, tract, surveyDate: isoDate(attrs.L0GIS_OwnerParcel_DATE_SURV),
    imageLinks: platImages(attrs), source: { name: GALLATIN_PLATVIEW_SOURCE, url: GALLATIN_PLATVIEW }, matchedBy: 'parcel_id'
  };
  if (/SUBDIVISION/.test(cls)) return { ...base, status: 'platted', kind: /MINOR/.test(cls) ? 'minor_subdivision' : 'major_subdivision', name: name || record };
  if (cls === 'COS') return { ...base, status: 'surveyed', kind: 'certificate_of_survey', name: record ? `Certificate of Survey ${record.replace(/^COS\s*/i, '')}` : 'Certificate of Survey' };
  if (cls === 'DEED') return { ...base, status: 'unplatted', kind: 'deed', name: null };
  return { ...base, status: 'unknown', kind: 'unknown', name };
}

export async function getGallatinRestrictions({ parcelId, signal }) {
  const geocode = geocodeOf(parcelId);
  const sources = [];
  let plat = null;
  try {
    const features = geocode.length === 17
      ? await restrictionQuery(GALLATIN_PLATVIEW, { where: `GEOCODE='${geocode}'`, outFields: PLATVIEW_FIELDS }, { agency: 'Gallatin County GIS', label: 'gallatin-platview', signal })
      : [];
    sources.push({ key: 'gallatin-platview', name: GALLATIN_PLATVIEW_SOURCE, url: GALLATIN_PLATVIEW, status: 'ok' });
    if (features.length) plat = gallatinPlat(features[0].attributes || {});
  } catch {
    sources.push({ key: 'gallatin-platview', name: GALLATIN_PLATVIEW_SOURCE, url: GALLATIN_PLATVIEW, status: 'unavailable' });
  }
  if (!plat || plat.status === 'unknown') {
    try {
      const cadastral = await findCadastralPlat(parcelId, { signal });
      sources.push({ key: 'mt-cadastral', name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/', status: 'ok' });
      if (cadastral && (!plat || cadastral.status !== 'unplatted')) plat = cadastral;
    } catch {
      sources.push({ key: 'mt-cadastral', name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/', status: 'unavailable' });
    }
  }
  return { plat, sources, recorder: GALLATIN_RECORDER };
}
