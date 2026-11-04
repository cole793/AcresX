// Stevens County, WA zoning rules (unincorporated land only) and how the county zoning layer's
// values map to them. Moved unchanged from src/services/zoning-rules.js, plus the map-label
// aliases below.
//
// Rules source: Stevens County Code Title 3 (effective December 8, 2022), §§3.03.020 and 3.04.010,
// https://www.stevenscountywa.gov/20903/Development-Zoning-and-Subdivision-Regulations (the
// standards table was transcribed before this file existed; the county site answered 403 to a
// plain request on 2026-11-04, so it was not re-read here).
//
// County zoning layer values (checked live 2026-11-04, every distinct value of
// https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/1,
// fields zoning / zoningtext / name / type / zoning_nam):
//   zoning 5   zoningtext 'RA-5'      -> RA-5        zoning 100 zoningtext 'NR Forest' -> F
//   zoning 10  zoningtext 'RA-10'     -> RA-10       zoning 101 zoningtext 'NR Ag'     -> A
//   zoning 20  zoningtext 'RA-20'     -> RA-20       zoning 103 zoningtext 'AR-10'     -> AR-10
//   zoning 0   zoningtext ' ', name = community ('Lake Spokane', 'Loon Lake', ...), type = the
//              district ('R-1 Residential', 'R-2 Residential', 'Business', 'Industrial',
//              'Open Space', 'Crossroads', 'Resort'; the renderer also lists 'Master-planned
//              Resort'), zoning_nam = name + type. These are the LAMIRD and UGA districts.
//   R-1 / R-2 / Business / Industrial map to R-1 / R-2 / B / I (their standards distinguish UGA
//   and "rural community" values). 'Open Space' maps to UO (Urban Open Space): every Open Space
//   polygon on the layer is inside a UGA (Colville, Kettle Falls, Lake Spokane, Marcus).
//   Crossroads, Resort and Master-planned Resort have no standards in the table: rules not mapped.

export const STEVENS_RULES_SOURCE_URL = 'https://www.stevenscountywa.gov/20903/Development-Zoning-and-Subdivision-Regulations';

// Upper-cased zone code or map label -> rules table key. 'NR-FOREST'/'NR-AG' were the old aliases;
// the layer's own labels are 'NR Forest' and 'NR Ag'.
const ALIASES = {
  '5': 'RA-5', '10': 'RA-10', '20': 'RA-20', '100': 'F', '101': 'A', '103': 'AR-10',
  'NR-FOREST': 'F', 'NR FOREST': 'F', 'NR-AG': 'A', 'NR AG': 'A',
  'R-1 RESIDENTIAL': 'R-1', 'R-2 RESIDENTIAL': 'R-2',
  BUSINESS: 'B', INDUSTRIAL: 'I', 'OPEN SPACE': 'UO'
};

// SCC Title 3 §3.04.010 (effective December 8, 2022).
const STANDARDS = {
  'RA-5': ['Rural Area — 5', 'Rural', 'Maximum 1 dwelling unit per 5 acres', '10 feet', '35 feet'],
  'RA-10': ['Rural Area — 10', 'Rural', 'Maximum 1 dwelling unit per 10 acres; clustering bonus may apply', '10 feet', '35 feet'],
  'RA-20': ['Rural Area — 20', 'Rural', 'Maximum 1 dwelling unit per 20 acres; clustering bonus may apply', '10 feet', '35 feet'],
  'AR-10': ['Rural Agriculture', 'Resource', 'Maximum 1 dwelling unit per 10 acres; clustering bonus may apply', '10 feet', '35 feet'],
  F: ['Forest', 'Resource', 'Maximum 1 dwelling unit per 20 acres', '10 feet', '35 feet'],
  A: ['Agriculture', 'Resource', 'Maximum 1 dwelling unit per 20 acres; clustering bonus may apply', '10 feet', '35 feet'],
  'R-1': ['Residential 1', 'Residential', 'UGA: up to 4 dwellings/acre; rural community: up to 3 dwellings/acre (subject to services and §3.05.010)', '10 feet', '35 feet'],
  'R-2': ['Residential 2', 'Residential', 'Up to 12 dwellings per acre; target 4–12 dwellings/acre', '5 feet', '35 feet'],
  UO: ['Urban Open Space', 'Open Space', 'Up to 4 dwellings/acre, or 3 dwellings/acre without necessary urban services', '10 feet', '35 feet'],
  B: ['Business', 'Commercial', 'UGA: up to 12 parcels/acre; rural community: up to 3 parcels/acre (not residential entitlement)', '0 feet in UGA; 10 feet in rural community', '45 feet UGA; 35 feet rural community'],
  I: ['Industrial', 'Industrial', 'UGA: up to 12 parcels/acre; rural community: up to 3 parcels/acre (not residential entitlement)', '0 feet in UGA; 10 feet in rural community', '65 feet UGA; 35 feet rural community']
};

// The rules table key for a zone code or map label ('RA-10', '10', 'NR Forest', 'R-1 Residential'),
// or the upper-cased input when it has no alias. Only a key in STANDARDS has rules.
export function stevensRulesKey(zoneCode) {
  const raw = String(zoneCode ?? '').trim().toUpperCase();
  return ALIASES[raw] || raw;
}
export function hasStevensRules(zoneCode) {
  return Object.prototype.hasOwnProperty.call(STANDARDS, stevensRulesKey(zoneCode));
}

// The /api/zoning-rules answer body for a Stevens County zone (same fields as before the move).
export function getStevensZoneRules(zoneCode) {
  const code = stevensRulesKey(zoneCode);
  const item = STANDARDS[code];
  if (!item) return { available: false, county: 'Stevens', zoneCode: code, status: 'zone_not_mapped' };
  const [name, family, density, setback, height] = item;
  // §3.03.020: statuses intentionally conservative for categories that vary by zone.
  const uses = [
    { label: 'Single-family dwelling (including manufactured housing)', status: code === 'B' ? 'limited' : code === 'I' ? 'limited' : 'permitted', note: code === 'B' ? 'Only as part of a mixed-use structure under the residential-use matrix.' : code === 'I' ? 'Verify with Land Services; industrial residential permissions are restricted.' : 'Allowed use under §3.03.020; site development and permits still required.' },
    { label: 'Accessory dwelling unit (ADU)', status: ['I', 'B'].includes(code) ? 'limited' : 'permitted', note: 'Subject to §3.06.010 and parcel-specific eligibility.' },
    { label: 'Accessory structures', status: 'permitted', note: 'Subject to applicable site and building standards.' },
    { label: 'Home occupation', status: 'limited', note: 'Verify activity-specific standards and district eligibility.' },
    { label: 'Multifamily residence', status: ['R-1', 'R-2'].includes(code) ? 'permitted' : 'conditional', note: 'The county use matrix distinguishes allowed and administrative conditional uses by district; density restrictions apply.' },
    { label: 'Manufactured/mobile home park', status: 'limited', note: 'District-specific use matrix and residential density must be confirmed before treating a park as permitted.' }
  ];
  return {
    available: true, county: 'Stevens', code, name, family, density,
    setback, buildingHeight: height,
    uses, source: 'Stevens County Code Title 3 (effective December 8, 2022), §§3.03.020 and 3.04.010',
    sourceChapter: '3.03.020 / 3.04.010',
    sourceUrl: STEVENS_RULES_SOURCE_URL,
    disclaimer: 'Preliminary county zoning screening, not a building permit or lot-size determination. Density is a maximum, not a guarantee of a dwelling on a smaller existing legal lot. Structural setback is the general property-line minimum; road/utility easement setbacks are generally 3 feet from the easement/right-of-way line. Overlays, city jurisdiction, current amendments, critical areas, water, septic and access may alter approvals. Confirm manufactured home parks, multifamily uses and any conditional use with Stevens County Land Services.'
  };
}
