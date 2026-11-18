// Spokane County (WA) recorded-restriction sources for /api/recorded-restrictions.
//
// - OpenData/Property MapServer/3 "Plats" (Plat_Name, short plats included, e.g. "SP 78-065") and
//   /2 "Lots" (Lot_Num, Block_Num, Plat_Name, Vacated), matched by one interior point of the
//   parcel (the layers have no parcel number). No plat and no lot there means the parcel is not in
//   a mapped plat (metes and bounds), e.g. 23123.9051.
// - SCOUT/LayersMenu MapServer/31 "Development Agreements" (FILENUM, RECORDINGNUM,
//   RECORDINGDATE, ZONECLASS): recorded agreements that bind the land. Matched by overlap with the
//   parcel outline (an agreement can cover part of a parcel); a polygon that only touches the
//   boundary is dropped.
// Plat names only: GIS has no plat recording numbers or images (the Auditor's portal shows plats).
// None of these layers has owner fields (SCOUTSimple owner_*/taxpayer_* are never read here).
import { restrictionQuery, pointParams, polygonParams, overlapping, sharePct, text, isoDate } from '../shared/restrictions.js';

export const SPOKANE_PLATS = 'https://gismo.spokanecounty.org/arcgis/rest/services/OpenData/Property/MapServer/3';
export const SPOKANE_LOTS = 'https://gismo.spokanecounty.org/arcgis/rest/services/OpenData/Property/MapServer/2';
export const SPOKANE_DEV_AGREEMENTS = 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/LayersMenu/MapServer/31';
export const SPOKANE_PLATS_SOURCE = 'Spokane County GIS (Plats and Lots)';
export const SPOKANE_DA_SOURCE = 'Spokane County GIS (Development Agreements)';
export const SPOKANE_RECORDER = { label: 'Spokane County Auditor recorded document search', url: 'https://recording.spokanecounty.org/recorder/web/' };

// "SP 78-065" / "SHORT PLAT ..." -> short plat; "BSP ..." -> binding site plan; else subdivision.
export function spokanePlatKind(name) {
  const s = String(name || '').toUpperCase();
  if (/^SP[\s-]|SHORT PLAT/.test(s)) return 'short_plat';
  if (/^BSP[\s-]|BINDING SITE/.test(s)) return 'binding_site_plan';
  return 'subdivision';
}

export function spokanePlat(platRows = [], lotRows = []) {
  const lot = lotRows.map(r => r.attributes || {}).find(a => !/^(Y|YES|1|TRUE)$/i.test(String(a.Vacated ?? '').trim()) && text(a.Plat_Name, 120));
  const platName = text(platRows.map(r => r.attributes?.Plat_Name).find(n => text(n, 120)), 120);
  const name = platName || text(lot?.Plat_Name, 120);
  if (!name) return { status: 'unplatted', kind: 'metes_and_bounds', source: { name: SPOKANE_PLATS_SOURCE, url: SPOKANE_PLATS }, matchedBy: 'interior_point' };
  return {
    status: 'platted', kind: spokanePlatKind(name), name,
    block: text(lot?.Block_Num, 10), lot: text(lot?.Lot_Num, 10),
    source: { name: SPOKANE_PLATS_SOURCE, url: SPOKANE_PLATS }, matchedBy: 'interior_point'
  };
}

export function spokaneAgreement(attributes = {}, share) {
  return {
    kind: 'development_agreement', label: 'Development agreement',
    fileNumber: text(attributes.FILENUM, 50), recordingNumber: text(attributes.RECORDINGNUM, 50),
    recordingDate: isoDate(attributes.RECORDINGDATE), zoneClass: text(attributes.ZONECLASS, 40), sharePct: sharePct(share),
    source: SPOKANE_DA_SOURCE
  };
}

export async function getSpokaneRestrictions({ point, rings, signal }) {
  const opts = label => ({ agency: 'Spokane County GIS', label, signal });
  const at = point ? pointParams(point) : null;
  const daParams = rings ? polygonParams(rings) : at;
  const [plats, lots, agreements] = await Promise.allSettled([
    at ? restrictionQuery(SPOKANE_PLATS, { ...at, outFields: 'Plat_Name' }, opts('spokane-plats')) : Promise.reject(new Error('no point')),
    at ? restrictionQuery(SPOKANE_LOTS, { ...at, outFields: 'Lot_Num,Block_Num,Plat_Name,Vacated' }, opts('spokane-lots')) : Promise.reject(new Error('no point')),
    daParams ? restrictionQuery(SPOKANE_DEV_AGREEMENTS, { ...daParams, outFields: 'FILENUM,RECORDINGNUM,RECORDINGDATE,ZONECLASS' }, opts('spokane-development-agreements')) : Promise.reject(new Error('no geometry'))
  ]);
  const platsOk = plats.status === 'fulfilled' && lots.status === 'fulfilled';
  // One layer answering is enough for a name; "not in a plat" needs both to have answered.
  let plat = null;
  if (platsOk) plat = spokanePlat(plats.value, lots.value);
  else if (plats.status === 'fulfilled' || lots.status === 'fulfilled') {
    const found = spokanePlat(plats.status === 'fulfilled' ? plats.value : [], lots.status === 'fulfilled' ? lots.value : []);
    plat = found.status === 'platted' ? found : null;
  }
  let list = null;
  if (agreements.status === 'fulfilled') {
    const rows = rings ? overlapping(rings, agreements.value) : agreements.value.map(feature => ({ feature, share: null }));
    list = rows.map(({ feature, share }) => spokaneAgreement(feature.attributes || {}, share));
  }
  return {
    plat,
    agreements: list,
    sources: [
      { key: 'spokane-plats', name: SPOKANE_PLATS_SOURCE, url: SPOKANE_PLATS, status: platsOk ? 'ok' : 'unavailable' },
      { key: 'spokane-development-agreements', name: SPOKANE_DA_SOURCE, url: SPOKANE_DEV_AGREEMENTS, status: agreements.status === 'fulfilled' ? 'ok' : 'unavailable' }
    ],
    recorder: SPOKANE_RECORDER
  };
}
