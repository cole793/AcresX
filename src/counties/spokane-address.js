// Spokane County address source for /api/address-search (src/shared/address-locator.js).
//
// Locator: Spokane County GIS Locators/AddrComposite GeocodeServer (Suggest, PointAddress from the
// county's site-address points). Tested 2026-11-15: "7911 W Ridgeway Rd" -> score 100
// PointAddress inside parcel 27081.9058.
// Parcels: the same Assessor/Parcels layer /api/parcel-search reads (src/counties/spokane-parcels.js);
// it has no owner or mailing fields. PID_NUM is the parcel number the parcel search takes.
import { SPOKANE_PARCEL_LAYER, situs } from './spokane-parcels.js';
import { normalizeSpokaneParcelId, spokaneAssessorWhere } from './spokane-assessor.js';

export const SPOKANE_ADDRESS_LOCATOR = 'https://gismo.spokanecounty.org/arcgis/rest/services/Locators/AddrComposite/GeocodeServer';

export const spokaneAddressSource = Object.freeze({
  key: 'spokane-address', state: 'WA', county: 'Spokane', agency: 'Spokane County GIS',
  locator: SPOKANE_ADDRESS_LOCATOR,
  parcelLayer: SPOKANE_PARCEL_LAYER, parcelFields: 'PID_NUM,site_address,site_city',
  situsField: 'site_address', scopeWhere: '',
  example: '35204.2729',
  idWhere(id) { const pid = normalizeSpokaneParcelId(id); return pid ? spokaneAssessorWhere(pid) : null; },
  mapParcel(attrs) {
    const parcelId = String(attrs.PID_NUM ?? '').trim();
    if (!/^\d{5}\.\d{4}$/.test(parcelId)) return null; // UNKNOWN and other placeholder ids
    const s = situs(attrs);
    return { parcelId, address: s.SITUS_ADDRESS, city: s.SITUS_CITY_NM };
  }
});
