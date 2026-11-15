// Montana address source for /api/address-search (src/shared/address-locator.js), every county
// (Yellowstone and Gallatin included).
//
// Locator: Montana State Library msdi_address_locator_geocode_v1 (Suggest; built on the MSDI
// Structures and Addresses points). Tested 2026-11-15, score 100 PointAddress inside the right
// cadastral parcel for 4740 Blue Creek Rd (03082303410010000), 7890 Bridger Canyon Rd
// (06090630401080000) and 510 Fairmont Rd, Kalispell (07396611101010000).
// Parcels: MT DNRC Cadastral FeatureServer 0, the layer /api/parcel-search falls back to
// (src/states/montana/parcels.js). It has owner fields: only PARCELID, COUNTYCD and the situs
// fields are requested. COUNTYCD is an integer (a string such as 'YE' fails the query);
// AddressLine1 has a trailing space, so situs queries use LIKE. Road right-of-way polygons have
// PARCELID 99999999999999999 and are never offered as a parcel.
export const MT_ADDRESS_LOCATOR = 'https://gisservice.mt.gov/arcgis/rest/services/msdi_address_locator_geocode_v1/GeocodeServer';
export const MT_CADASTRAL_LAYER = 'https://gis.dnrc.mt.gov/arcgis/rest/services/DNRALL/Cadastral/FeatureServer/0';
export const MT_ADDRESS_FIELDS = 'PARCELID,COUNTYCD,AddressLine1,CityStateZip';
export const MT_ROW_PARCEL_ID = '99999999999999999';

// Montana's county numbers (the first two digits of the geocode). Checked live 2026-11-15 for
// 1, 2, 3, 4, 5, 6, 7, 16 and 56.
export const MT_COUNTY_CODES = Object.freeze({
  'Silver Bow': 1, Cascade: 2, Yellowstone: 3, Missoula: 4, 'Lewis and Clark': 5, Gallatin: 6, Flathead: 7, Fergus: 8,
  'Powder River': 9, Carbon: 10, Phillips: 11, Hill: 12, Ravalli: 13, Custer: 14, Lake: 15, Dawson: 16, Roosevelt: 17,
  Beaverhead: 18, Chouteau: 19, Valley: 20, Toole: 21, 'Big Horn': 22, Musselshell: 23, Blaine: 24, Madison: 25,
  Pondera: 26, Richland: 27, Powell: 28, Rosebud: 29, 'Deer Lodge': 30, Teton: 31, Stillwater: 32, Treasure: 33,
  Sheridan: 34, Sanders: 35, 'Judith Basin': 36, Daniels: 37, Glacier: 38, Fallon: 39, 'Sweet Grass': 40, McCone: 41,
  Carter: 42, Broadwater: 43, Wheatland: 44, Prairie: 45, Granite: 46, Meagher: 47, Liberty: 48, Park: 49, Garfield: 50,
  Jefferson: 51, Wibaux: 52, 'Golden Valley': 53, Mineral: 54, Petroleum: 55, Lincoln: 56
});
const COUNTY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(MT_COUNTY_CODES).map(([name, code]) => [code, name])));
export const montanaCountyName = code => COUNTY_BY_CODE[Number(code)] || '';

const EXAMPLES = { Yellowstone: '03082303410010000', Gallatin: '06090630401080000', Flathead: '07396611101010000' };

export function montanaAddressSource(county = '') {
  const name = Object.keys(MT_COUNTY_CODES).find(c => c.toLowerCase() === String(county).toLowerCase()) || '';
  const code = MT_COUNTY_CODES[name];
  return Object.freeze({
    key: 'montana-address', state: 'MT', county: name, agency: 'Montana State Library / DNRC cadastral',
    locator: MT_ADDRESS_LOCATOR,
    parcelLayer: MT_CADASTRAL_LAYER, parcelFields: MT_ADDRESS_FIELDS,
    situsField: 'AddressLine1', scopeWhere: code ? `COUNTYCD=${code}` : '',
    example: EXAMPLES[name] || (code ? `${String(code).padStart(2, '0')}… (17-digit geocode)` : '17-digit geocode, e.g. 03082303410010000'),
    idWhere(id) { const n = String(id ?? '').replace(/[^0-9]/g, ''); return /^\d{17}$/.test(n) && n !== MT_ROW_PARCEL_ID ? `PARCELID='${n}'` : null; },
    mapParcel(attrs) {
      const parcelId = String(attrs.PARCELID ?? '').trim();
      if (!/^\d{17}$/.test(parcelId) || parcelId === MT_ROW_PARCEL_ID) return null;
      return { parcelId, address: String(attrs.AddressLine1 ?? '').trim(), city: String(attrs.CityStateZip ?? '').trim(), county: montanaCountyName(attrs.COUNTYCD) || name };
    }
  });
}
