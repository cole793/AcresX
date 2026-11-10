// Montana statewide water and sewer districts (Montana State Library, MSDI Administrative
// Boundaries):
//   https://gisservice.mt.gov/arcgis/rest/services/msdi_administrative_boundaries_map_v1/MapServer/60  "Water Districts"
//   https://gisservice.mt.gov/arcgis/rest/services/msdi_administrative_boundaries_map_v1/MapServer/59  "Sewer Districts"
// Checked live (`?f=json` and queries, read-only) on 2026-11-09. Fields read: DistrictName,
// LastUpdate (ms). These are county water and/or sewer districts outside city limits (Four
// Corners, Big Sky, Lockwood, Huntley, Heights Water District, ...); cities are not in them.
// Layer 60 holds the combined "WATER & SEWER" districts too (e.g. 'LOCKWOOD WATER AND SEWER',
// 'BIG SKY WATER & SEWER'), so a layer-60 name with SEWER counts for both services; layer 59
// holds only sewer-only districts ('WILLOW CREEK SEWER', 'AMSTERDAM/CHURCHILL SEWER'). Names
// starting "(PROPOSED)" are not districts yet and are skipped. No contact or owner fields exist.
import { staleDate, text, titleCase } from '../../shared/utility-findings.js';

const MSDI = 'https://gisservice.mt.gov/arcgis/rest/services/msdi_administrative_boundaries_map_v1/MapServer';
export const MSDI_WATER_DISTRICTS = `${MSDI}/60`;
export const MSDI_SEWER_DISTRICTS = `${MSDI}/59`;
const AGENCY = 'Montana State Library (MSDI)';

function rowsToFindings(rows, ctx, layerServices) {
  const out = [];
  for (const a of rows) {
    const raw = text(a.DistrictName);
    if (!raw || /^\(PROPOSED\)/i.test(raw)) continue;
    const provider = titleCase(raw).replace(/\bAnd\b/g, 'and');
    const services = layerServices === 'water' && /SEWER/i.test(raw) ? ['water', 'sewer'] : [layerServices];
    const asOf = staleDate(a.LastUpdate, ctx?.now);
    for (const service of services) out.push({ service, status: 'served', provider, basis: `inside Montana ${service} district: ${provider}`, ...(asOf ? { asOf } : {}) });
  }
  return out;
}

export const MSDI_WATER_SOURCE = {
  id: 'mt-msdi-water-districts', name: 'Montana MSDI Water Districts', agency: AGENCY, url: MSDI_WATER_DISTRICTS,
  services: ['water', 'sewer'], kind: 'area', outFields: 'DistrictName,LastUpdate',
  read: (rows, ctx) => rowsToFindings(rows, ctx, 'water')
};

export const MSDI_SEWER_SOURCE = {
  id: 'mt-msdi-sewer-districts', name: 'Montana MSDI Sewer Districts', agency: AGENCY, url: MSDI_SEWER_DISTRICTS,
  services: ['sewer'], kind: 'area', outFields: 'DistrictName,LastUpdate',
  read: (rows, ctx) => rowsToFindings(rows, ctx, 'sewer')
};
