// Stevens County address source for /api/address-search (src/shared/address-locator.js).
//
// Locator: Stevens County GIS Locators/Address GeocodeServer (Suggest; full city names, where
// Locators/SiteAddress abbreviates them, "Che"). Tested 2026-11-15: "2436 Flowery Trail" ->
// PointAddress inside parcel 0434200.
// Parcels: RealPropertyParcels_Public layer 0. It also has owner and mailing fields: only PARCELN
// and the situs fields are requested. PARCELN equals the WA statewide layer's ORIG_PARCEL_ID
// (0434200 on both, checked 2026-11-15), which is what the Stevens parcel search matches.
export const STEVENS_ADDRESS_LOCATOR = 'https://gis.stevenscountywa.gov/server/rest/services/Locators/Address/GeocodeServer';
export const STEVENS_ADDRESS_PARCELS = 'https://gis.stevenscountywa.gov/server/rest/services/RealPropertyParcels_Public/MapServer/0';

// situs_disp holds "2436 FLOWERY TRAIL RD \r\nCHEWELAH, WA 99109": the street is the first line.
export function stevensSitus(attrs = {}) {
  const [street = ''] = String(attrs.situs_disp ?? '').split(/\r?\n/);
  return { address: street.replace(/\s+/g, ' ').trim(), city: String(attrs.situs_city ?? '').trim() };
}

export const stevensAddressSource = Object.freeze({
  key: 'stevens-address', state: 'WA', county: 'Stevens', agency: 'Stevens County GIS',
  locator: STEVENS_ADDRESS_LOCATOR,
  parcelLayer: STEVENS_ADDRESS_PARCELS, parcelFields: 'PARCELN,situs_disp,situs_city',
  situsField: 'situs_disp', scopeWhere: '',
  example: '0434200',
  idWhere(id) { const n = String(id ?? '').replace(/[^0-9]/g, ''); return /^\d{7}$/.test(n) ? `PARCELN='${n}'` : null; },
  mapParcel(attrs) {
    const parcelId = String(attrs.PARCELN ?? '').trim();
    if (!/^\d{7}$/.test(parcelId)) return null;
    return { parcelId, ...stevensSitus(attrs) };
  }
});
