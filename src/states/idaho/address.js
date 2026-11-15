// Idaho statewide address source for /api/address-search (src/shared/address-locator.js): every
// Idaho county except Kootenai (src/counties/kootenai-address.js).
//
// There is no statewide Idaho address locator (2026-11-15). The statewide parcel layer
// (Public_Idaho_Parcels_ layer 7, the one the Idaho parcel search reads, src/states/idaho/parcels.js)
// holds only 13 counties, with SITE_ADD. Outside those, address search is the Census geocoder
// (approximate) and the map. The layer has owner and mailing fields: only PARCEL_ID, County and
// the situs fields are requested.
export const IDAHO_PARCEL_LAYER = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/ArcGIS/rest/services/Public_Idaho_Parcels_/FeatureServer/7';
export const IDAHO_ADDRESS_FIELDS = 'PARCEL_ID,County,SITE_ADD,SITE_CITY';

export function idahoAddressSource(county = '') {
  const name = String(county || '').replace(/[^A-Za-z .]/g, '').trim();
  return Object.freeze({
    key: 'idaho-statewide-address', state: 'ID', county: name, agency: 'Idaho statewide parcels',
    locator: null,
    parcelLayer: IDAHO_PARCEL_LAYER, parcelFields: IDAHO_ADDRESS_FIELDS,
    situsField: 'SITE_ADD', scopeWhere: name ? `UPPER(County)='${name.toUpperCase()}'` : '',
    example: '',
    idWhere(id) { const n = String(id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return n ? `UPPER(PARCEL_ID)='${n}'` : null; },
    mapParcel(attrs) {
      const parcelId = String(attrs.PARCEL_ID ?? '').trim();
      if (!parcelId) return null;
      return { parcelId, address: String(attrs.SITE_ADD ?? '').trim(), city: String(attrs.SITE_CITY ?? '').trim(), county: String(attrs.County ?? '').trim() || name };
    }
  });
}
