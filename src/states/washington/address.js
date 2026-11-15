// Washington statewide address source for /api/address-search (src/shared/address-locator.js):
// every WA county without its own address locator (Spokane and Stevens have one,
// src/counties/*-address.js).
//
// No statewide WA address locator was found (2026-11-15), so suggestions and address matches are
// a LIKE on the statewide parcel layer's SITUS_ADDRESS (the layer the WA parcel search reads,
// public/index.html findParcel). Situs coverage varies by county (Stevens: 25,080 of 42,943
// parcels). COUNTY_NM holds the FIPS number without zeros ('63' for Spokane), not a name.
// ORIG_PARCEL_ID is the number the parcel search takes. The layer has no owner fields.
export const WA_PARCEL_LAYER = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0';
export const WA_ADDRESS_FIELDS = 'ORIG_PARCEL_ID,COUNTY_NM,SITUS_ADDRESS,SITUS_CITY_NM';

export const WA_COUNTY_FIPS = Object.freeze({ Adams: 1, Asotin: 3, Benton: 5, Chelan: 7, Clallam: 9, Clark: 11, Columbia: 13, Cowlitz: 15, Douglas: 17, Ferry: 19, Franklin: 21, Garfield: 23, Grant: 25, 'Grays Harbor': 27, Island: 29, Jefferson: 31, King: 33, Kitsap: 35, Kittitas: 37, Klickitat: 39, Lewis: 41, Lincoln: 43, Mason: 45, Okanogan: 47, Pacific: 49, 'Pend Oreille': 51, Pierce: 53, 'San Juan': 55, Skagit: 57, Skamania: 59, Snohomish: 61, Spokane: 63, Stevens: 65, Thurston: 67, Wahkiakum: 69, 'Walla Walla': 71, Whatcom: 73, Whitman: 75, Yakima: 77 });
const COUNTY_BY_FIPS = Object.freeze(Object.fromEntries(Object.entries(WA_COUNTY_FIPS).map(([n, f]) => [f, n])));

export function washingtonAddressSource(county = '') {
  const name = Object.keys(WA_COUNTY_FIPS).find(c => c.toLowerCase() === String(county).toLowerCase()) || '';
  const fips = WA_COUNTY_FIPS[name];
  return Object.freeze({
    key: 'wa-statewide-address', state: 'WA', county: name, agency: 'Washington statewide parcels',
    locator: null,
    parcelLayer: WA_PARCEL_LAYER, parcelFields: WA_ADDRESS_FIELDS,
    situsField: 'SITUS_ADDRESS', scopeWhere: fips ? `COUNTY_NM='${fips}'` : '',
    example: '',
    idWhere(id) { const n = String(id ?? '').toUpperCase().replace(/[^A-Z0-9.-]/g, ''); return n ? `UPPER(ORIG_PARCEL_ID)='${n}'` : null; },
    mapParcel(attrs) {
      const parcelId = String(attrs.ORIG_PARCEL_ID ?? '').trim();
      if (!parcelId) return null;
      return { parcelId, address: String(attrs.SITUS_ADDRESS ?? '').replace(/\s+/g, ' ').trim(), city: String(attrs.SITUS_CITY_NM ?? '').trim(), county: COUNTY_BY_FIPS[Number(attrs.COUNTY_NM)] || name };
    }
  });
}
