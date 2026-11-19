const WA_COUNTIES = ['Adams','Asotin','Benton','Chelan','Clallam','Clark','Columbia','Cowlitz','Douglas','Ferry','Franklin','Garfield','Grant','Grays Harbor','Island','Jefferson','King','Kitsap','Kittitas','Klickitat','Lewis','Lincoln','Mason','Okanogan','Pacific','Pend Oreille','Pierce','San Juan','Skagit','Skamania','Snohomish','Spokane','Stevens','Thurston','Wahkiakum','Walla Walla','Whatcom','Whitman','Yakima'];
const MT_COUNTIES = ['Beaverhead','Big Horn','Blaine','Broadwater','Carbon','Carter','Cascade','Chouteau','Custer','Daniels','Dawson','Deer Lodge','Fallon','Fergus','Flathead','Gallatin','Garfield','Glacier','Golden Valley','Granite','Hill','Jefferson','Judith Basin','Lake','Lewis and Clark','Liberty','Lincoln','Madison','McCone','Meagher','Mineral','Missoula','Musselshell','Park','Petroleum','Phillips','Pondera','Powder River','Powell','Prairie','Ravalli','Richland','Roosevelt','Rosebud','Sanders','Sheridan','Silver Bow','Stillwater','Sweet Grass','Teton','Toole','Treasure','Valley','Wheatland','Wibaux','Yellowstone'];
const ID_COUNTIES = ['Ada','Adams','Bannock','Bear Lake','Benewah','Bingham','Blaine','Boise','Bonner','Bonneville','Boundary','Butte','Camas','Canyon','Caribou','Cassia','Clark','Clearwater','Custer','Elmore','Franklin','Fremont','Gem','Gooding','Idaho','Jefferson','Jerome','Kootenai','Latah','Lemhi','Lewis','Lincoln','Madison','Minidoka','Nez Perce','Oneida','Owyhee','Payette','Power','Shoshone','Teton','Twin Falls','Valley','Washington'];

export const COVERAGE_STATUS = {
  VALIDATED: 'validated',
  AVAILABLE_UNVALIDATED: 'available_unvalidated',
  PARTIAL: 'partial',
  NOT_CONFIGURED: 'not_configured'
};

const statewideBase = {
  parcel: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  wells: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  soil: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  terrain: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  flood: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  wetlands: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  utilities: COVERAGE_STATUS.AVAILABLE_UNVALIDATED,
  assessment: COVERAGE_STATUS.NOT_CONFIGURED,
  tax: COVERAGE_STATUS.NOT_CONFIGURED,
  zoning: COVERAGE_STATUS.NOT_CONFIGURED,
  zoningRules: COVERAGE_STATUS.NOT_CONFIGURED
};

// Levels follow COUNTY_CHECKLIST.md "Readiness levels"; checklistScore is that checklist's audit
// score (out of 100) on checklistScoreDate.
//
// Every capability below comes from live validation runs, 12 parcels per county, never from older
// hand-set values: 2026-11-03 (started 23:25Z, after PR #30's terrain fix deployed; Spokane ran on
// the WA validation tool from PR #36) for Spokane and Gallatin; Stevens was re-derived from the
// 2026-11-12 daily run (run 43304774155); Kootenai and Yellowstone were re-derived from the latest published daily run (2026-11-10, run
// 42895735135, `latest/<county>.json` on the validation-results branch).
//   validated      ok on at least 10 of 12 parcels and no mismatch
//   partial        answered for some parcels, had a mismatch, or answered without usable data
//   not_configured unavailable on every parcel because nothing is set up for it
// utilities = the utility-territory and power layers; terrain = the terrain and slope-grid layers.
// tax: 'partial' in every covered county (2026-11-15): /api/property-tax (src/services/property-tax.js)
// returns the billed amount from the county treasurer pages (Kootenai: an estimate from the 2026
// levy rate, since the treasurer site blocks automated lookups). Checked live on one or two
// parcels per county, not yet by the daily validation run (the tax layer is in it from this
// change on); move to 'validated' after clean runs.
// tax, 2026-11-17: re-derived from the daily runs since 2026-11-15 (validation-results branch,
// history/2026-11-15 run 43752184568 and history/2026-11-16 run 43974575941, the last two
// published). 'validated' where the tax layer was clean in both (no parcel with a tax error,
// mismatch or skip, and ok on at least 10 of 12):
//   Spokane  10 ok, 2 unavailable both runs (43341.0110 and 57302.9016: SCOUT gave no amount)
//   Stevens  11 ok + 1 not_found (8974701); then 10 ok, 1 not_found, 1 unavailable (2214900:
//            the property search refused the automated lookup)
// Still 'partial' (2026-11-16 not clean): Kootenai (7 of 12 skipped, parcel lookup failed),
// Gallatin (06069905302080000: request failed), Yellowstone (03113519316050000: HTTP 503).
const overrides = {
  'WA:Spokane': {
    level: 3,
    priority: 1,
    lastValidated: '2026-11-14',
    checklistScore: 79,
    checklistScoreDate: '2026-11-03',
    notes: 'Level 3 (checklist section 7): two consecutive clean live validation runs (0 parcels with an error or mismatch) on 2026-11-13 (run 43502221467) and 2026-11-14 (run 43628378292; 165 ok, 15 unavailable: listing on 12 parcels, zoning rules on 3). Owner signed off on 2026-11-11 after comparing 35204.2729 and 57344.0125 with the county sources. Zoning rules are missing for 3 of 12 parcels (City of Spokane R1, Spokane Valley R-3, Cheney R-1); no tax amount.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'validated',zoning:'validated',zoningRules:'partial'}
  },
  'MT:Yellowstone': {
    level: 3,
    priority: 1,
    lastValidated: '2026-11-11',
    checklistScore: 80,
    checklistScoreDate: '2026-11-03',
    notes: 'Level 3 (checklist section 7): clean live validation runs (0 parcels with an error or mismatch) on 2026-11-09 (run 42716955430), 2026-11-10 (run 42895735135) and 2026-11-11 (run 43094606201, clean in the job log; not published because of the artifact outage fixed by PR #53). Owner signed off on 2026-11-12 after comparing 03103233201230000 (N3 City of Billings, assessed $857,700, flood X) and 03072527101010000 (Special Zoning District 16, assessed $16,479, flood D) with the county and state sources. Zoning rules are missing for 4 of 12 parcels (all unzoned county land); no tax amount.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'partial',zoning:'validated',zoningRules:'partial'}
  },
  'ID:Kootenai': {
    level: 3,
    priority: 1,
    lastValidated: '2026-11-11',
    checklistScore: 87,
    checklistScoreDate: '2026-11-03',
    notes: 'Level 3 (checklist section 7): clean live validation runs (0 parcels with an error or mismatch) on 2026-11-09 (run 42716955430, plus the lead\'s manual run after PR #46 deployed), 2026-11-10 (run 42895735135) and 2026-11-11 (run 43094606201, clean in the job log; not published because of the artifact outage fixed by PR #53). Owner signed off on 2026-11-12 after comparing 0L8210010030 (Rural, assessed $372,460, class 515, flood X), and earlier C72150030040 (Coeur d\'Alene R-12), with the county sources. Zoning rules are missing for 3 of 12 parcels (Coeur d\'Alene R-12 twice, county Restricted Residential); no tax amount.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'partial',zoning:'validated',zoningRules:'partial'}
  },
  'MT:Gallatin': {
    level: 3,
    priority: 2,
    lastValidated: '2026-11-19',
    checklistScore: 75,
    checklistScoreDate: '2026-11-03',
    notes: 'Level 3 (checklist section 7): two consecutive clean live validation runs (0 parcels with an error or mismatch) on 2026-11-18 (run 44401658417) and 2026-11-19 (run 44620839493; 173 ok, 19 unavailable: listing on 12 parcels, zoning rules on 4, zoning on 2, tax on 1). Owner signed off on 2026-11-18 after comparing 06069905302080000 (Hyalite RR-10) and 06033804413010000 (Big Sky RC-SF-10) with the county regulations. Zoning rules from PR #92 cover residential, agricultural and rural zones (8 of 12 parcels); tax ok on 11 of 12 in both runs.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'validated',zoning:'validated',zoningRules:'partial'}
  },

  // Stevens was re-derived from the latest published daily run (2026-11-12, run 43304774155,
  // `latest/stevens.json` on the validation-results branch).
  'WA:Stevens': {
    level: 3,
    lastValidated: '2026-11-12',
    checklistScore: 78,
    checklistScoreDate: '2026-11-07',
    notes: 'Level 3 (checklist section 7): clean live validation runs (0 parcels with an error or mismatch) on 2026-11-11 (run 43094606201, clean in the job log; not published because of the artifact outage fixed by PR #53) and 2026-11-12 (run 43304774155, 0 failed, published on validation-results). Daily check enabled. Hand-checked expected values on more than 3 parcels in validation/counties/stevens.json. Owner signed off on 2026-11-13 ("Stevens checks look good") after checking 0231200 (City of Chewelah, R1) and 2342700 (rural, AR-10, designated forest) against the county sources.',
    capabilities: {parcel:'validated',wells:'validated',soil:'validated',terrain:'validated',flood:'validated',wetlands:'validated',utilities:'validated',assessment:'validated',tax:'validated',zoning:'validated',zoningRules:'validated'}
  }
};

const priority2 = new Set([
  'WA:Stevens','WA:Pend Oreille','WA:Whitman','WA:Kittitas','WA:Chelan','WA:Okanogan','WA:Grant','WA:Benton','WA:Yakima',
  'MT:Flathead','MT:Ravalli','MT:Missoula','MT:Lewis and Clark','MT:Lake','MT:Carbon',
  'ID:Bonner','ID:Boundary','ID:Latah','ID:Ada','ID:Canyon','ID:Valley','ID:Teton','ID:Bonneville'
]);

function makeCounty(state, county) {
  const key = `${state}:${county}`;
  const override = overrides[key] || {};
  return {
    state,
    county,
    key,
    level: override.level || 1,
    priority: override.priority || (priority2.has(key) ? 2 : 3),
    lastValidated: override.lastValidated || null,
    checklistScore: override.checklistScore ?? null,
    checklistScoreDate: override.checklistScoreDate || null,
    notes: override.notes || '',
    capabilities: {...statewideBase, ...(override.capabilities || {})}
  };
}

export const COUNTY_COVERAGE = [
  ...WA_COUNTIES.map(county => makeCounty('WA', county)),
  ...MT_COUNTIES.map(county => makeCounty('MT', county)),
  ...ID_COUNTIES.map(county => makeCounty('ID', county))
];

export function getCountyCoverageRegistry() {
  const summary = COUNTY_COVERAGE.reduce((acc, county) => {
    acc.total += 1;
    acc.byState[county.state] = (acc.byState[county.state] || 0) + 1;
    acc.byLevel[county.level] = (acc.byLevel[county.level] || 0) + 1;
    return acc;
  }, {total:0, byState:{}, byLevel:{}});
  return {
    version: 1,
    generatedFrom: 'AcresX county coverage registry',
    levels: {
      1: 'Statewide/base screening only; county-specific assessor/zoning intelligence not yet fully configured.',
      2: 'County parcel/assessment/zoning partly configured; local zoning-code Development Potential may be incomplete.',
      3: 'Validated county experience with parcel screening, assessor/zoning intelligence and standardized Development Potential.'
    },
    statusDefinitions: {
      validated: 'Returned usable data on at least 10 of 12 parcels in a live validation run, with no mismatch against hand-checked values.',
      available_unvalidated: 'Source/adapter exists but county-specific validation is still required.',
      partial: 'Some data is returned but coverage or completeness is limited.',
      not_configured: 'No dedicated source/adapter is currently configured.'
    },
    summary,
    counties: COUNTY_COVERAGE
  };
}
