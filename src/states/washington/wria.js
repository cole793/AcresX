// Washington Water Resource Inventory Area (WRIA) at a point, for the well line of the cost
// estimate (Spokane County charges an ESSB 6091 surcharge and sells stream-flow mitigation
// certificates for new permit-exempt wells in WRIA 55, Little Spokane; BP-04 Section VII).
//
// Source: WA Department of Ecology, "Water Resource Inventory Areas (WRIA)", hosted feature layer
// published by Ecology's own ArcGIS organization (owner WAECY_Geoservices):
//   https://services.arcgis.com/6lCKYNJLvwTXqrmp/arcgis/rest/services/ECY/FeatureServer/11
// Fields used: WRIA_NR (number), WRIA_NM (name). Checked live 2026-11-12 (read-only): the City of
// Spokane point -117.390737,47.644811 is WRIA 57 Middle Spokane; -117.25,47.85 is WRIA 55 Little
// Spokane. (gis.ecology.wa.gov answers 403 / "Token Required" to automated requests.)

import { arcgisQuery } from '../../shared/upstream.js';

export const WA_WRIA_LAYER = 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/arcgis/rest/services/ECY/FeatureServer/11';
export const WA_WRIA_SOURCE = { name: 'WA Department of Ecology, Water Resource Inventory Areas (WRIA)', url: WA_WRIA_LAYER };

// { available: true, number, name, source } | { available: true, number: null } (no polygon) |
// { available: false, status: 'source_unavailable', error }. Never throws.
export async function lookupWria({ lat, lon } = {}, { timeoutMs = 6000 } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'invalid_location' };
  try {
    const features = await arcgisQuery(WA_WRIA_LAYER, {
      where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'WRIA_NR,WRIA_NM', returnGeometry: 'false'
    }, { timeoutMs, retries: 0, label: 'wa-wria', agency: 'WA Department of Ecology' });
    const a = features[0]?.attributes || {};
    const number = Number.isFinite(Number(a.WRIA_NR)) && a.WRIA_NR !== null ? Number(a.WRIA_NR) : null;
    return { available: true, number, name: number == null ? null : String(a.WRIA_NM || '').trim(), source: WA_WRIA_SOURCE };
  } catch (error) {
    return { available: false, status: 'source_unavailable', error: error?.message || 'WRIA layer unavailable', source: WA_WRIA_SOURCE };
  }
}
