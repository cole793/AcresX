const COUNTY_NAMES = [
  'Adams','Asotin','Benton','Chelan','Clallam','Clark','Columbia','Cowlitz','Douglas','Ferry',
  'Franklin','Garfield','Grant','Grays Harbor','Island','Jefferson','King','Kitsap','Kittitas','Klickitat',
  'Lewis','Lincoln','Mason','Okanogan','Pacific','Pend Oreille','Pierce','San Juan','Skagit','Skamania',
  'Snohomish','Spokane','Stevens','Thurston','Wahkiakum','Walla Walla','Whatcom','Whitman','Yakima'
];

const baseProfile = county => ({
  county,
  status: 'discovery',
  jurisdiction: `${county} County`,
  catalogQueries: [
    `${county} County Washington zoning`,
    `${county} County WA zoning`,
    `${county} County land use`
  ],
  serviceCandidates: [],
  codeFields: ['ZONING','ZONE','ZONE_CODE','ZONING_CODE','ZONINGCLASS','ZONING_CLASS','DESIGNATION','LANDUSE','LAND_USE'],
  nameFields: ['ZONE_NAME','ZONING_NAME','DESCRIPTION','ZONE_DESC','ZONING_DESC','DESIGNATION','LANDUSE','LAND_USE'],
  layerNamePattern: /zon(e|ing)|land.?use|district/i,
  planningAgency: `${county} County planning or community development`,
  healthAgency: `${county} County environmental health`,
  roadAgency: `${county} County public works or roads department`,
  planningUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official planning`)}`,
  zoningMapUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official zoning GIS`)}`,
  permitUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official building permits`)}`,
  septicUrl: `https://www.google.com/search?q=${encodeURIComponent(`${county} County Washington official septic permit`)}`
});

export const ZONING_COUNTIES = Object.fromEntries(COUNTY_NAMES.map(name => [name, baseProfile(name)]));

// County-specific setup belongs here. The query engine does not change as coverage expands.
ZONING_COUNTIES.Spokane = {
  ...ZONING_COUNTIES.Spokane,
  status: 'configured',
  catalogQueries: [
    'Spokane County Washington zoning',
    'Spokane County generalized zoning',
    'Spokane County current zoning',
    'Spokane County land use zoning'
  ],
  planningAgency: 'Spokane County Building & Planning',
  healthAgency: 'Spokane Regional Health District',
  roadAgency: 'Spokane County Public Works',
  planningUrl: 'https://www.spokanecounty.org/194/Building-Planning',
  zoningMapUrl: 'https://cp.spokanecounty.org/scout/scoutdashboard/',
  permitUrl: 'https://www.spokanecounty.org/194/Building-Planning',
  septicUrl: 'https://srhd.org/programs-and-services/environmental-health/onsite-sewage',
  preferredOwners: ['SpokaneCountyGIS','Spokane_County','SpokaneCounty'],
  codeFields: ['ZONING','ZONE','ZONE_CODE','ZONING_CODE','ZONECLASS','ZONINGCLASS','DESIGNATION'],
  nameFields: ['ZONE_NAME','ZONING_NAME','DESCRIPTION','ZONE_DESC','ZONING_DESC','DESIGNATION']
};

export function getZoningProfile(county) {
  return ZONING_COUNTIES[county] || baseProfile(county || 'Unknown');
}
