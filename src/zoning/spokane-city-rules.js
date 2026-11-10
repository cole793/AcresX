// Zoning rules for the cities inside Spokane County, one table per city. City zone codes share
// letters with Spokane County zones (Liberty Lake 'R1', Spokane Valley 'R-3', Cheney 'I-1') but
// never their rules: a city zone gets its own city's table or "rules not mapped", never
// src/zoning/spokane-rules.js. The city zoning layers are in src/counties/spokane-cities.js.
//
// Which cities have a table, and why the others do not (checked 2026-11-10):
// - City of Liberty Lake: table below, from the city's own Development Code PDF,
//   https://www.libertylakewa.gov/DocumentCenter/View/5341/COLL-Full-Development-Code
//   ("Title 10 City of Liberty Lake Development Code", linked from the city's Zoning Information
//   page https://www.libertylakewa.gov/476/Zoning-Information; Chapter 2 pages dated February 26
//   to March 25, 2026). Sections used: 10-2A-4 Zoning Districts Matrix (Housing rows), and per
//   district 10-2x-6 Development Setbacks, 10-2x-7 Lot Area, Dimensions, Coverage & Residential
//   Density, 10-2x-8 Building Height (x = B R-1, C R-2, D R-3, E M-1, F M-2, G M-3, H C-1, I C-2,
//   J I). R-1 ADU and manufactured-home standards: 10-2B-3 C.7, C.8 and C.10.
//   The city layer's Class_Abv values are 'R1', 'M2', ... (no hyphen); the code writes 'R-1'.
//   SAP (Specific Area Plan overlays, Article 10-2M), the River District zones (RD-R, RD-M, RD-C,
//   separate River District regulations), P and O have no table here: rules not mapped.
// - City of Spokane (SMC Title 17C, my.spokanecity.org/smc): the site answered one request for the
//   Chapter 17C.111 table of contents, then blocked automated requests (Incapsula), as did
//   static.spokanecity.org; Municode and American Legal have no reachable copy. Not mapped.
// - City of Spokane Valley (SVMC Title 19): codepublishing.com/WA/SpokaneValley now says the code
//   moved to General Code eCode360 (ecode360.com/SP4654), which blocks automated requests
//   (Cloudflare challenge). Not mapped.
// - City of Airway Heights: codepublishing.com/WA/AirwayHeights also moved to eCode360
//   (ecode360.com/AI4333), blocked the same way. Not mapped.
// - City of Cheney: no code copy found on the city site; cheney.municipal.codes and Municode block
//   automated requests. Not mapped.
// - Medical Lake, Deer Park, Millwood and the towns publish no zoning layer AcresX reads, so they
//   never have a zone code to look up.

const status = (label, state, note = '') => ({ label, status: state, note });
const P = (label, note = '') => status(label, 'permitted', note);
const L = (label, note = '') => status(label, 'limited', note);
const N = (label, note = '') => status(label, 'not_permitted', note);

const squash = value => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const DISCLAIMER = 'Screening summary only, from the city code as published on the date shown. Specific area plans, planned unit developments, critical areas, shoreline rules, subdivision standards, utilities, access and project review can change what may actually be approved. State housing laws adopted after a code update may also apply. Verify with the city before relying on a listed use.';

// ---- City of Liberty Lake (Title 10 Development Code) ----------------------------------------
const LL_SOURCE_URL = 'https://www.libertylakewa.gov/DocumentCenter/View/5341/COLL-Full-Development-Code';
const llAduNote = 'One ADU per lot, at most 35% of the main home\'s living area or 900 sq ft, whichever is less, and 2 bedrooms; the main home or ADU must be owner-occupied; a detached ADU needs a lot of at least 8,000 sq ft (10-2B-3 C.7–C.8).';
const llManufacturedNote = 'Multi-section home of at least 1,000 sq ft with a pitched roof, residential siding and roofing, on a perimeter-enclosed foundation (10-2B-3 C.10).';

// Housing rows of the 10-2A-4 matrix, in the column order R-1 R-2 R-3 M-1 M-2 M-3 C-1 C-2 I.
const LL_COLUMNS = ['R-1', 'R-2', 'R-3', 'M-1', 'M-2', 'M-3', 'C-1', 'C-2', 'I'];
const LL_MATRIX = [
  ['Single-family dwelling', 'PPPNNNNNN'],
  ['Accessory dwelling unit (attached or detached)', 'LLLLLLNNN'],
  ['Duplex (two-family)', 'NLLNNNNNN'],
  ['Townhome (single-family attached)', 'LLLLLLNNN'],
  ['Multi-family dwelling', 'NLLLLLNNN'],
  ['Manufactured home on its own lot', 'LLLNNNNNN'],
  ['Manufactured home park', 'NLLNNNNNN'],
  ["Accessory caretaker's residence", 'NNNNNNNLL']
];
function llUses(code) {
  const col = LL_COLUMNS.indexOf(code);
  return LL_MATRIX.map(([label, row]) => {
    const note = code === 'R-1' && /^Accessory dwelling/.test(label) ? llAduNote
      : code === 'R-1' && /^Manufactured home on/.test(label) ? llManufacturedNote : '';
    return row[col] === 'P' ? P(label, note) : row[col] === 'L' ? L(label, note) : N(label, note);
  });
}

const llResidentialSetback = front => `Front ${front} ft; rear 15 ft (6 ft on an alley); side 5 ft (15 ft on a street side)`;
const LIBERTY_LAKE = {
  'R-1': { name: 'Single Family Residential', family: 'Residential', article: '10-2B', density: '4 to 6 dwelling units per net acre for detached homes (up to 8 for townhomes and clustered housing); no minimum lot area', setback: llResidentialSetback(10), buildingHeight: '35 feet' },
  'R-2': { name: 'Mixed Residential', family: 'Residential', article: '10-2C', density: '6 to 12 dwelling units per net acre; no minimum lot area', setback: llResidentialSetback(10), buildingHeight: '35 feet' },
  'R-3': { name: 'Multi-Family Residential', family: 'Residential', article: '10-2D', density: 'At least 12 dwelling units per net acre, no maximum; lots at least 40 ft wide', setback: llResidentialSetback(15), buildingHeight: '35 feet' },
  'M-1': { name: 'Neighborhood Center Mixed-Use', family: 'Mixed Use', article: '10-2E', density: 'Townhomes at least 6 and multi-family at least 12 dwelling units per net acre, no maximum; multi-family lots at least 7,000 sq ft', buildingHeight: '35 feet (45 feet where housing is above the ground floor)' },
  'M-2': { name: 'Community Center Mixed-Use', family: 'Mixed Use', article: '10-2F', density: 'Townhomes at least 6 and multi-family at least 12 dwelling units per net acre, no maximum; multi-family lots at least 7,000 sq ft', buildingHeight: '50 feet (60 feet where housing is above the ground floor)' },
  'M-3': { name: 'Central Business District Mixed-Use', family: 'Mixed Use', article: '10-2G', density: 'Townhomes and multi-family at least 12 dwelling units per net acre', buildingHeight: '50 feet (60 feet where housing is above the ground floor)' },
  'C-1': { name: 'Community Commercial', family: 'Commercial', article: '10-2H', density: 'Commercial district; dwellings are not a listed use', buildingHeight: '70 feet (40 feet next to an R-1 zone)' },
  'C-2': { name: 'Freeway Commercial', family: 'Commercial', article: '10-2I', density: "Commercial district; only an accessory caretaker's residence is allowed", buildingHeight: '70 feet (40 feet next to an R-1 zone)' },
  I: { name: 'Light Industrial', family: 'Industrial', article: '10-2J', density: "Industrial district; only an accessory caretaker's residence is allowed", buildingHeight: '70 feet (40 feet next to an R-1 zone)' }
};

// Keyed by the city name src/counties/spokane-cities.js gives the parcel's jurisdiction.
// codeUrl is where "rules not mapped" sends the user: the city code (or, for Cheney, the planning
// page, since no code copy was verified).
const CITIES = {
  'CITY OF LIBERTY LAKE': {
    codeUrl: LL_SOURCE_URL, codeLabel: 'Liberty Lake Development Code (Title 10)', source: 'City of Liberty Lake Development Code (Title 10), Chapter 2, as published 2026-03',
    zones: LIBERTY_LAKE, key: code => { const s = squash(code); return s === 'I' ? 'I' : s.replace(/^([A-Z])(\d)$/, '$1-$2'); },
    sourceChapter: rule => `${rule.article}, matrix 10-2A-4`, sourceUrl: LL_SOURCE_URL, uses: llUses
  },
  'CITY OF SPOKANE': { codeUrl: 'https://my.spokanecity.org/smc/?Title=17C', codeLabel: 'Spokane Municipal Code Title 17C' },
  'CITY OF SPOKANE VALLEY': { codeUrl: 'https://ecode360.com/SP4654', codeLabel: 'Spokane Valley Municipal Code Title 19' },
  'CITY OF AIRWAY HEIGHTS': { codeUrl: 'https://ecode360.com/AI4333', codeLabel: 'Airway Heights Municipal Code' },
  'CITY OF CHENEY': { codeUrl: 'https://www.cityofcheney.org/192/Planning-Department', codeLabel: 'City of Cheney Planning Department' }
};
// The legacy fallback route names the City of Spokane 'Spokane'.
const ALIASES = { SPOKANE: 'CITY OF SPOKANE', 'SPOKANE VALLEY': 'CITY OF SPOKANE VALLEY', 'LIBERTY LAKE': 'CITY OF LIBERTY LAKE', CHENEY: 'CITY OF CHENEY', 'AIRWAY HEIGHTS': 'CITY OF AIRWAY HEIGHTS' };

function cityEntry(jurisdiction) {
  const name = String(jurisdiction ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return CITIES[ALIASES[name] || name] || null;
}
function cityRule(city, zoneCode) {
  if (!city?.zones) return null;
  const key = city.key(zoneCode);
  return Object.prototype.hasOwnProperty.call(city.zones, key) ? { key, rule: city.zones[key] } : null;
}

// True when the city has a rules table with this zone (spokane-cities.js sets zoning.rules).
export function hasSpokaneCityRules(jurisdiction, zoneCode) {
  return Boolean(cityRule(cityEntry(jurisdiction), zoneCode));
}

// Where "rules not mapped" links for a city ({ codeUrl, codeLabel }), or null for a city AcresX
// has no code link for.
export function spokaneCityCodeLink(jurisdiction) {
  const city = cityEntry(jurisdiction);
  return city?.codeUrl ? { codeUrl: city.codeUrl, codeLabel: city.codeLabel || 'city zoning code' } : null;
}

// The /api/zoning-rules answer for a zone inside a city in Spokane County. Never Spokane County
// rules: a city without a table, or a zone missing from it, is "rules not mapped" with a link.
export function getSpokaneCityZoneRules(jurisdiction, zoneCode) {
  const city = cityEntry(jurisdiction);
  const code = String(zoneCode ?? '').trim();
  const found = cityRule(city, code);
  if (!found) {
    const link = spokaneCityCodeLink(jurisdiction);
    return {
      available: false, county: 'Spokane', jurisdiction, zoneCode: code, status: 'zone_not_mapped', rules: 'not_mapped',
      note: `Rules for ${code || 'this zone'} aren't mapped in AcresX yet; see the ${link?.codeLabel || "city's zoning code"} and verify with the city.`,
      ...(link || {})
    };
  }
  const { key, rule } = found;
  return {
    available: true, county: 'Spokane', jurisdiction: String(jurisdiction).trim(), jurisdictionType: 'city',
    code: key, zoneCode: code, name: rule.name, family: rule.family, density: rule.density,
    ...(rule.setback ? { setback: rule.setback } : {}), buildingHeight: rule.buildingHeight,
    uses: city.uses(key), source: city.source, sourceChapter: city.sourceChapter(rule), sourceUrl: city.sourceUrl,
    codeUrl: city.codeUrl, codeLabel: city.codeLabel, disclaimer: DISCLAIMER
  };
}
