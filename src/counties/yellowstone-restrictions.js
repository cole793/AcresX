// Yellowstone County (MT) plat / certificate-of-survey record for /api/recorded-restrictions.
//
// Two sources, asked in parallel:
// 1. Montana Cadastral by parcel ID (src/states/montana/restrictions.js): subdivision or COS,
//    the short legal description and the state property record link.
// 2. The county's Tax_and_Legal_Parcels MapServer/1 ("Legal Parcel"): SUBD, BLK_NUM, LOT_NUM,
//    CERT_SURV, TR_NUM, SUBD_AM (amended plat, e.g. "AM B:1 L:1A & 5"), CS_AM (amended COS). The
//    layer has no parcel ID, so it is matched by one interior point of the parcel: a whole-polygon
//    query also returns the neighbouring lots (checked live for 03092732390050000: Lots 1A1, 4,
//    5A and two blank rows came back; the interior point gives only Lot 5A).
// e.g. 03092732390050000: Harvey Subd, Block 1, Lot 5A, amended plat "AM B:1 L:1A & 5".
// Neither request asks for the owner or mailing fields the county parcel layers carry.
import { restrictionQuery, pointParams, text } from '../shared/restrictions.js';
import { findCadastralPlat } from '../states/montana/restrictions.js';

export const YELLOWSTONE_LEGAL_PARCELS = 'https://gis.yellowstonecountymt.gov/arcgis/rest/services/Tax_and_Legal_Parcels/MapServer/1';
export const YELLOWSTONE_LEGAL_SOURCE = 'Yellowstone County GIS (Tax and Legal Parcels)';
export const YELLOWSTONE_LEGAL_FIELDS = 'SUBD,BLK_NUM,LOT_NUM,CERT_SURV,TR_NUM,SUBD_AM,CS_AM';
export const YELLOWSTONE_RECORDER = { label: 'Yellowstone County Clerk & Recorder document search', url: 'https://crdocs.yellowstonecountymt.gov/recorder/web/' };

// County "Legal Parcel" row -> plat fields, or null when the row names neither a plat nor a COS.
export function yellowstoneLegalPlat(attrs = {}) {
  const subd = text(attrs.SUBD, 80), cos = text(attrs.CERT_SURV, 40);
  const base = { block: text(attrs.BLK_NUM, 20), lot: text(attrs.LOT_NUM, 20), tract: text(attrs.TR_NUM, 20), source: { name: YELLOWSTONE_LEGAL_SOURCE, url: YELLOWSTONE_LEGAL_PARCELS }, matchedBy: 'interior_point' };
  if (subd) return { ...base, status: 'platted', kind: 'subdivision', name: subd, amended: text(attrs.SUBD_AM, 120) };
  if (cos) return { ...base, status: 'surveyed', kind: 'certificate_of_survey', name: `Certificate of Survey ${cos.replace(/^C\.?O\.?S\.?\s*/i, '')}`, record: `COS ${cos.replace(/^C\.?O\.?S\.?\s*/i, '')}`, amended: text(attrs.CS_AM, 120) };
  return null;
}

// Cadastral first for the name, legal description and property record; the county layer for
// block, lot, tract and the amended-plat note.
export function mergeYellowstone(cadastral, county) {
  if (!cadastral) return county;
  if (!county) return cadastral;
  if (cadastral.status === 'unplatted') return county;
  return {
    ...cadastral,
    block: county.block || cadastral.block || null,
    lot: county.lot || cadastral.lot || null,
    tract: county.tract || cadastral.tract || null,
    amended: county.amended || (cadastral.amended ? 'Amended plat' : null)
  };
}

export async function getYellowstoneRestrictions({ parcelId, point, signal }) {
  const [cadastral, county] = await Promise.allSettled([
    findCadastralPlat(parcelId, { signal }),
    point ? restrictionQuery(YELLOWSTONE_LEGAL_PARCELS, { ...pointParams(point), outFields: YELLOWSTONE_LEGAL_FIELDS }, { agency: 'Yellowstone County GIS', label: 'yellowstone-legal-parcels', signal }) : Promise.resolve([])
  ]);
  const countyPlat = county.status === 'fulfilled' ? county.value.map(f => yellowstoneLegalPlat(f.attributes || {})).find(Boolean) || null : null;
  const sources = [
    { key: 'mt-cadastral', name: 'Montana Cadastral', url: 'https://svc.mt.gov/msl/cadastral/', status: cadastral.status === 'fulfilled' ? 'ok' : 'unavailable' },
    { key: 'yellowstone-legal', name: YELLOWSTONE_LEGAL_SOURCE, url: YELLOWSTONE_LEGAL_PARCELS, status: county.status === 'fulfilled' && point ? 'ok' : point ? 'unavailable' : 'skipped' }
  ];
  return { plat: mergeYellowstone(cadastral.status === 'fulfilled' ? cadastral.value : null, countyPlat), sources, recorder: YELLOWSTONE_RECORDER };
}
