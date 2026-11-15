// Nearest mapped electric TRANSMISSION line (69 kV and up) to a parcel, from HIFLD.
//
// Source: "U.S. Electric Power Transmission Lines (Archive)", ArcGIS Online item
// d4090758322c4d32a4cd002ffaa0aa12 (owner Federal_User_Community, access public): "This feature
// layer, utilizing U.S. Government data, depicts electric power transmission lines in the United
// States ... Lines are operated at relatively high voltages varying from 69 kV up to 765 kV".
// It is the HIFLD layer; the item says "It has been archived. It will no longer be updated or
// maintained. Last Data Update: 09/30/2024". Fields used: VOLTAGE, VOLT_CLASS, TYPE (OWNER is not asked for: the personal-field guard
// in test/personal-fields.test.js refuses any owner field, and the utility name is not needed).
// Checked 2026-11-15 at the four parcels in the PR: Spokane and Kootenai each have an Avista
// 115 kV line within 5 miles, Flathead several BPA/Flathead Electric lines, Yellowstone none.
//
// A transmission line is not where a house is served from: this only says how far the nearest
// mapped high-voltage line is. It never feeds the line-extension cost (public/local-cost-model.js
// reads distribution distances only).

import { arcgisQuery } from '../shared/upstream.js';
import { distanceToParcelFt } from '../shared/line-distance.js';

export const HIFLD_TRANSMISSION_LAYER = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0';
export const HIFLD_TRANSMISSION_SOURCE = 'HIFLD U.S. Electric Power Transmission Lines (archived; last data update 2024-09-30)';
export const HIFLD_SEARCH_FT = 26400; // 5 miles
const RECORD_LIMIT = 200;
const MAX_BYTES = 2_000_000;

// Returns { available: true, distanceFt (null when none within searchedFt), searchedFt, voltageKv,
// source, sourceUrl } or { available: false, status, error }. Never throws.
export async function nearestTransmissionLine({ lat, lon, geometry = null, timeoutMs = 4000, signal } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { available: false, status: 'invalid_location' };
  try {
    const features = await arcgisQuery(HIFLD_TRANSMISSION_LAYER, {
      where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', distance: String(HIFLD_SEARCH_FT), units: 'esriSRUnit_Foot',
      outFields: 'VOLTAGE,VOLT_CLASS,TYPE', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6',
      maxAllowableOffset: '0.00005', resultRecordCount: String(RECORD_LIMIT)
    }, { timeoutMs, retries: 0, signal, maxBytes: MAX_BYTES, label: 'hifld-transmission', agency: 'HIFLD transmission lines' });
    let best = null;
    for (const f of features) {
      const ft = distanceToParcelFt(f?.geometry?.paths || [], { lat, lon, geometry });
      if (Number.isFinite(ft) && (!best || ft < best.ft)) best = { ft, a: f.attributes || {} };
    }
    const kv = Number(best?.a.VOLTAGE);
    return {
      available: true,
      distanceFt: best ? Math.round(best.ft) : null,
      searchedFt: HIFLD_SEARCH_FT,
      voltageKv: Number.isFinite(kv) && kv > 0 ? kv : null,
      source: HIFLD_TRANSMISSION_SOURCE,
      sourceUrl: HIFLD_TRANSMISSION_LAYER
    };
  } catch (error) {
    return { available: false, status: error?.kind === 'timeout' ? 'timed_out' : 'source_unavailable', error: error?.message || 'HIFLD transmission lines unavailable' };
  }
}
