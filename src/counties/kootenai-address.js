// Kootenai County address source for /api/address-search (src/shared/address-locator.js).
//
// map.kcgov.us blocks Cloudflare's egress, so the Worker never calls it for address search: every
// Kootenai action answers at once with a browser fallback hint (kind 'kootenai-address',
// src/shared/fallback.js) and public/browser-fallback.js runs the same steps from the user's
// browser (CORS is allowed). The parsing there is a copy of this file and
// src/shared/address-locator.js; test/address-search.test.js runs both on the same fixtures.
//
// Locator: GISAPP22_COMP_LOC GeocodeServer (Suggest; STRUCTURE_LOC point candidates). Tested
// 2026-11-15: "3572 S MOOSE CANYON RD" -> STRUCTURE_LOC PointAddress inside parcel 50N04W323200.
// Parcels: NewServices/Ownership_Display layer 0, the layer /api/parcel-search reads. It has the
// owner's name (`Name`): only PIN and the situs fields are requested.
import { KC_PARCEL_LAYER, kootenaiParcelWhere } from './kootenai-parcels.js';

export const KC_ADDRESS_LOCATOR = 'https://map.kcgov.us/arcgis/rest/services/GISAPP22_COMP_LOC/GeocodeServer';
export const KC_ADDRESS_FIELDS = 'PIN,Loc_Addr,Loc_City'; // never Name (the owner)

export const kootenaiAddressSource = Object.freeze({
  key: 'kootenai-address', state: 'ID', county: 'Kootenai', agency: 'Kootenai County GIS',
  browserKind: 'kootenai-address',
  locator: KC_ADDRESS_LOCATOR,
  parcelLayer: KC_PARCEL_LAYER, parcelFields: KC_ADDRESS_FIELDS,
  situsField: 'Loc_Addr', scopeWhere: '',
  example: '50N04W323200',
  idWhere(id) { return String(id ?? '').replace(/[^A-Za-z0-9]/g, '') ? kootenaiParcelWhere(id) : null; },
  mapParcel(attrs) {
    const parcelId = String(attrs.PIN ?? '').trim();
    if (!parcelId) return null;
    return { parcelId, address: String(attrs.Loc_Addr ?? '').trim(), city: String(attrs.Loc_City ?? '').trim() };
  }
});
