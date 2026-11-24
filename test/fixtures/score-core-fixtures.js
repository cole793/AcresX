// Fixed score inputs for test/score-core.test.js (R2, docs/explore-index.md section 8): one
// `last` shape per case the five counties produce (steep, flood, wetland, no zoning, public
// utilities, missing inputs ...). Each entry is a function so every run gets a fresh copy (the
// septic grading writes soil.septic onto the land answer). `sections` is what
// window.AcresXSections.status(name) answers for the case (progressive-loading.js), when set.
// The expected scores are in score-core-expected.json, recorded from the code before the
// score-core.js refactor.

const square = { type: 'Polygon', coordinates: [[[-117.4, 47.6], [-117.399, 47.6], [-117.399, 47.601], [-117.4, 47.601], [-117.4, 47.6]]] };
const parcel = (id, county, state) => ({ type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: id, _countyDisplay: county, _stateCode: state } });

// The wells array carries the terrain-aware estimate as wells.terrain (public/well-terrain.js).
function wells(depths, terrain) {
  const list = depths.map((d, i) => ({ properties: { CompletedDepth: d, _distance: 0.1 + i * 0.1, WellProjectType: i === 4 ? 'Irrigation' : 'Domestic' } }));
  if (terrain) list.terrain = terrain;
  return list;
}
const MODERATE_150 = { available: true, status: 'estimated', parcelElevationFt: 2332, searchRadiusMiles: 2, estimate: { confidence: 'moderate', depthFt: 150, lowFt: 120, highFt: 190, planningDepthFt: 190, scoreDepthFt: 150, comparableCount: 6, usedCount: 6, parcelElevationFt: 2332 } };
const MODERATE_320 = { available: true, status: 'estimated', parcelElevationFt: 4800, searchRadiusMiles: 3, estimate: { confidence: 'moderate', depthFt: 320, lowFt: 280, highFt: 360, planningDepthFt: 360, scoreDepthFt: 320, comparableCount: 4, usedCount: 5, parcelElevationFt: 4800 } };
const LOW_UPLAND = { available: true, status: 'estimated', parcelElevationFt: 3545, searchRadiusMiles: 4, estimate: { confidence: 'low', depthFt: 250, lowFt: 250, highFt: 1370, planningDepthFt: 1370, scoreDepthFt: 1370, comparableCount: 0, usedCount: 8, parcelElevationFt: 3545, drainage: { count: 7, of: 10, medianDropFt: 240, mostly: true } } };

const soil = (drainage, hydrologicGroup, extra = {}) => ({ available: true, mapUnit: 'Test silt loam, 0 to 8 percent slopes', component: 'Test', drainage, hydrologicGroup, feasibility: 'moderate', soilSlopePct: 4, ...extra });
const terrain = (gradePct, extra = {}) => ({ available: true, gradePct, reliefFt: 40, minFt: 2300, maxFt: 2340, ...extra });
const minimalFlood = { available: true, intersects: true, high: false, category: 'minimal', zones: ['X'], zoneDetails: [{ zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }] };
const noWetlands = { available: true, intersects: false, count: 0, category: 'none' };
const zoned = code => ({ zoning: { status: 'gis_match', code } });
const confirmedPower = { territory: { confirmed: true, provider: 'Avista' } };
const buildable = (buildableAcres, parcelAcres, removed = [], extra = {}) => ({ status: 'measured', buildableAcres, parcelAcres, removed, ...extra });

export const FIXTURES = {
  // Spokane: flat, shallow comparable wells, well drained soil, everything mapped.
  spokane_flat_complete: () => ({
    parcel: parcel('23123.9051', 'Spokane', 'WA'),
    wells: wells([140, 150, 160, 170, 600], MODERATE_150), utility: ['Avista'], powerIntelligence: confirmedPower,
    land: { soil: soil('Well drained', 'B'), terrain: terrain(3.2) },
    flood: minimalFlood, wetlands: noWetlands, zoningPermits: zoned('RR-10'),
    buildableArea: buildable(9.4, 10, [{ key: 'slope', reason: 'Steep slopes', acres: 0.6 }])
  }),
  // Stevens: steep upland, low-confidence deep wells, slope-limited septic, tight buildable area.
  stevens_steep: () => ({
    parcel: parcel('1234567', 'Stevens', 'WA'),
    wells: wells([200, 240, 260, 300, 900], LOW_UPLAND), utility: ['Avista'],
    land: { soil: soil('Well drained', 'C', { soilSlopePct: 25 }), terrain: terrain(22.4, { homesiteSlopePct: 17.2 }) },
    flood: { available: true, intersects: false, zones: [] }, wetlands: noWetlands, zoningPermits: zoned('RR-20'),
    buildableArea: buildable(0.31, 20, [{ key: 'slope', reason: 'Slopes over 30%', acres: 19.69 }], { homesite: { slopePct: 17.2 } })
  }),
  // Kootenai: SFHA zone AE on 40% of the parcel, measured share.
  kootenai_flood_share: () => ({
    parcel: parcel('C72150030040', 'Kootenai', 'ID'),
    wells: wells([90, 110, 120, 130, 140], MODERATE_150), utility: ['Kootenai Electric'], powerIntelligence: confirmedPower,
    land: { soil: soil('Moderately well drained', 'B'), terrain: terrain(1.1) },
    flood: { available: true, intersects: true, high: true, category: 'high', zones: ['AE', 'X'], zoneDetails: [{ zone: 'AE', subtype: null, sfha: true }, { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false }], floodShare: { status: 'measured', restSharePct: 0 }, sfhaSharePct: 40, floodZones: [{ zone: 'AE', sfha: true, sharePct: 40, acres: 2 }, { zone: 'X', remainder: true, sharePct: 60, acres: 3 }] },
    wetlands: noWetlands, zoningPermits: zoned('Ag'),
    buildableArea: buildable(3, 5, [{ key: 'flood', reason: 'FEMA high-risk flood zone AE', acres: 2 }])
  }),
  // Kootenai: high-risk zone A with no measured share (category score), buildable not loaded yet.
  kootenai_flood_unmeasured: () => ({
    parcel: parcel('51N04W123456', 'Kootenai', 'ID'),
    wells: wells([180, 200, 220]), utility: [],
    land: { soil: soil('Somewhat poorly drained', 'C/D'), terrain: terrain(0.8) },
    flood: { available: true, intersects: true, high: true, zones: ['A'] },
    wetlands: noWetlands, zoningPermits: zoned('Rural')
  }),
  // Gallatin: mapped wetland on 22% of the parcel, deep comparable wells.
  gallatin_wetland: () => ({
    parcel: parcel('06033804413010000', 'Gallatin', 'MT'),
    wells: wells([300, 320, 340, 360], MODERATE_320), utility: ['NorthWestern Energy'], powerIntelligence: confirmedPower,
    land: { soil: soil('Poorly drained', 'D'), terrain: terrain(6.5) },
    flood: minimalFlood, wetlands: { available: true, intersects: true, count: 3, coveragePct: 22, overlapAcres: 4.4, wetlandAcres: 4.4, category: 'present' },
    zoningPermits: zoned('A-20'),
    buildableArea: buildable(15.6, 20, [{ key: 'wetland', reason: 'NWI wetlands', acres: 4.4 }])
  }),
  // Yellowstone: no county zoning (no_match), territory found but not confirmed, X shaded.
  yellowstone_no_zoning: () => ({
    parcel: parcel('A12345', 'Yellowstone', 'MT'),
    wells: wells([60, 80, 95]), utility: ['NorthWestern Energy'],
    land: { soil: soil('Well drained', 'A'), terrain: terrain(11.8) },
    flood: { available: true, intersects: true, category: 'moderate', zones: ['X'], zoneDetails: [{ zone: 'X', subtype: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', sfha: false }] },
    wetlands: { available: true, intersects: true, count: 1, overlapAcres: 0.02, coveragePct: 0.1 },
    zoningPermits: { zoning: { status: 'no_match', note: 'Outside county zoning districts' } },
    buildableArea: buildable(4.8, 5, [])
  }),
  // Spokane city lot: public water and sewer served (they replace the well and septic factors).
  spokane_public_utilities: () => ({
    parcel: parcel('35204.1234', 'Spokane', 'WA'),
    wells: wells([420, 440]), utility: ['Avista'], powerIntelligence: confirmedPower,
    land: { soil: soil('Poorly drained', 'D'), terrain: terrain(2.0) },
    flood: minimalFlood, wetlands: noWetlands, zoningPermits: zoned('R-12'),
    publicUtilities: { water: { status: 'served', provider: 'City of Spokane', basis: 'main 6 m from the parcel' }, sewer: { status: 'served', provider: 'City of Spokane', basis: 'side sewer 10 m' } },
    buildableArea: buildable(0.18, 0.2, [{ key: 'setback', reason: 'Setbacks', acres: 0.02 }])
  }),
  // Yellowstone outside Billings: public water/sewer only "likely" (not counted), no wells.
  yellowstone_likely_utilities: () => ({
    parcel: parcel('B67890', 'Yellowstone', 'MT'),
    wells: [], utility: ['Yellowstone Valley Electric'],
    land: { soil: soil('Well drained', 'B'), terrain: terrain(4.9) },
    flood: { available: true, intersects: false, zones: [], source: { emptyResult: true, provider: 'Esri USA Flood Hazard Areas' } },
    wetlands: { available: true, intersects: true, count: 2, coveragePct: null, wetlandAcres: null },
    zoningPermits: zoned('A-1'),
    publicUtilities: { water: { status: 'likely', provider: 'City of Billings', basis: 'inside the service area', cityLimits: 'outside' }, sewer: { status: 'likely', provider: 'City of Billings', basis: 'inside the service area', cityLimits: 'outside' } },
    buildableArea: { status: 'measured', buildableAcres: 2.5, parcelAcres: 2.5, removed: [], homesiteStatus: 'none_clear' }
  }),
  // Missing inputs: land still loading, flood timed out, well and utility lookups failed, zoning
  // unavailable (Provisional).
  missing_inputs_provisional: () => {
    const w = []; w.lookupFailed = true;
    const u = []; u.lookupFailed = true;
    return {
      parcel: parcel('99999.0001', 'Spokane', 'WA'),
      wells: w, utility: u, land: null,
      flood: { available: false, timedOut: true, error: 'FEMA timed out' },
      wetlands: noWetlands,
      zoningPermits: { zoning: { status: 'unavailable', note: 'County GIS lookup failed.' } }
    };
  },
  // Section status from progressive-loading.js: wetlands timed out, utility still pending.
  sections_timeout_pending: () => ({
    parcel: parcel('C50000010010', 'Kootenai', 'ID'),
    wells: wells([250, 260, 270, 280, 290]), utility: [],
    land: { soil: { available: false, error: 'Soil data unavailable' }, terrain: terrain(9.1) },
    flood: minimalFlood, wetlands: null, zoningPermits: zoned('Ag/Forest'),
    buildableArea: { status: 'unavailable' },
    sections: { wetlands: 'timeout', utility: 'pending' }
  }),
  // Gallatin: terrain unavailable, soil from the Esri backup, flood zone D, undetermined.
  gallatin_terrain_missing: () => ({
    parcel: parcel('06070000000000000', 'Gallatin', 'MT'),
    wells: wells([500, 520, 560, 610, 640]), utility: ['NorthWestern Energy'],
    land: { soil: soil('Well drained', 'B', { backup: true }), terrain: { available: false, error: 'Elevation unavailable' } },
    flood: { available: true, intersects: true, zones: ['D'] },
    wetlands: { available: true, intersects: true, count: 1, coveragePct: 55, overlapAcres: 11 },
    zoningPermits: { zoning: { status: 'not_configured' } }
  })
};

// What the test compares: the score, its parts and the lines the card shows from them.
export function summarize(r) {
  return {
    score: r.score, factorScore: r.factorScore, rating: r.rating, band: r.band,
    factors: Object.fromEntries(Object.entries(r.factors).map(([k, f]) => [k, { score: f.score, measured: f.measured }])),
    constraint: r.constraint.label, why: r.why, buildableCap: r.buildable.cap ?? null,
    completeness: { measured: r.completeness.measured, provisional: r.completeness.provisional, label: r.completeness.label, detail: r.completeness.detail, retry: r.completeness.retry }
  };
}
