// Local development-cost price tables (owner request 2026-11-12: "tighter, based on local county
// data", starting with Spokane, WA and Kootenai, ID). Read by public/local-cost-model.js
// (window.AcresXCostModel), which holds the formulas.
//
// Why a static browser file and not an /api route: the estimate is computed in the browser from
// the report's own data (`last`), like the rest of the score/cost modules. A static table adds no
// request, no extra loading state and no new failure mode, and it changes only with a deploy,
// which is also when a reviewed price change should go live. Every entry carries its source, so
// the table is the audit trail.
//
// Each priced entry: { value | low/high, unit, asOf (effective date), source: { name, url },
// verified, note? }. verified: true means the number was read in the primary document named
// (re-read 2026-11-12). verified: false means AcresX planning allowance or an unconfirmed
// figure, always labeled as such in the UI. Search-snippet figures are left out entirely.
// Listing/MLS data never feeds these tables or the estimate.
(function (root) {
  const src = (name, url) => Object.freeze({ name, url });

  const AVISTA_WA = src('Avista Utilities, Washington Schedule 51 (Tariff WN U-28)', 'https://www.myavista.com/-/media/myavista/content-documents/our-rates-and-tariffs/wa/wa_051.pdf');
  const AVISTA_ID = src('Avista Utilities, Idaho Schedule 51 (I.P.U.C. No. 28), approved by IPUC Order No. 37042', 'https://www.myavista.com/-/media/myavista/content-documents/our-rates-and-tariffs/id/rate-requests/id-schedule-51.pdf');
  const KEC = src('Kootenai Electric Cooperative, New Construction', 'https://www.kec.com/account-services/start-stop-transfer-service/new-construction/');
  const SPOKANE_GFC = src('City of Spokane, General Facilities Charges (2026)', 'https://my.spokanecity.org/publicworks/general-facilities-charges/');
  const CDA_WATER_CAP = src("City of Coeur d'Alene, Water Capitalization Fee Schedule (Aug 4, 2026)", 'https://www.cdaid.org/media/k2bdf1rd/water-cap-fee-schedule-august-4-2026.pdf');
  const CDA_WATER = src("City of Coeur d'Alene, Water Fee Schedule (Aug 4, 2026)", 'https://www.cdaid.org/media/ndohy1di/water-fee-schedule-august-4-2026.pdf');
  const CDA_SEWER = src("City of Coeur d'Alene, Ordinance 3715 wastewater rates and fees", 'https://www.cdaid.org/media/khinqujk/ww-rates-and-fees-ordinance-3715-council-bill-23-1004.pdf');
  const POST_FALLS = src('City of Post Falls, Fee Schedule (revised 10-13-2026)', 'https://www.postfalls.gov/DocumentCenter/View/815/Fee-Schedule-PDF');
  const HAYDEN = src('City of Hayden, Fee Schedule (effective Sept 1, 2023)', 'https://cms2.revize.com/revize/hayden/document_center/Government/Finance/FeeSchedule/Fee%20Schedule%202023%20_Final%208.23.23.pdf');
  const SRHD = src('Spokane Regional Health District, Proposed 2026 Fee Schedule (lists 2025 approved fees)', 'https://assets.srhd.org/assets/media/documents/2025.09.25-07B1-Proposed-2026-Fee-Schedule.pdf');
  const RCW_WELL = src('RCW 18.104.055 (Washington well construction fees, Dept. of Ecology)', 'https://app.leg.wa.gov/RCW/default.aspx?cite=18.104.055');
  const IDWR = src('Idaho Code 42-235 (IDWR well drilling permit)', 'https://legislature.idaho.gov/statutesrules/idstat/Title42/T42CH2/SECT42-235/');
  const KC_FEES = src('Kootenai County Resolution No. 2026-62, Community Development Fee Schedule (June 2026)', 'https://www.kcgov.us/DocumentCenter/View/24018/Resolution-Number-2024-55-Community-Development-Fee-Schedule-PDF');
  const SPOKANE_PERMIT_2025 = src('City of Spokane, 2025 Building Permit Fee Table for New Single-Family Residences', 'https://static.spokanecity.org/documents/business/resources/permit-fees/building-permit-fee-schedule-new-homes-2025-01-21.pdf');
  const SPOKANE_DEV_2026 = src('City of Spokane, Development Fee Schedule 2026', 'https://static.spokanecity.org/documents/smc/attachments/development-fee-schedule-2026.pdf');
  const SPOKANE_COUNTY_BP04P = src('Spokane County Building & Planning, 2026 Land Use Fee Schedule (BP-04P rev. 08/26; owner-provided copy)', 'https://www.spokanecounty.org/194/Building-Planning');
  const SPOKANE_COUNTY_BP04 = src('Spokane County BP-04 Fee Schedule, Building Dept. (owner-provided, undated)', 'https://www.spokanecounty.org/194/Building-Planning');
  const PFHD = src('Post Falls Highway District, Set Fees and Deposits (effective 6/16/2021, CPI-adjusted yearly)', 'https://www.postfallshd.com/uploads/1/4/2/5/142542594/fees___deposits_1.pdf');
  const WSDOT_26Z001 = src('WSDOT bid tabulation 26Z001, 2026 Eastern Region (bids opened Apr 22, 2026)', 'https://wsdot.wa.gov/sites/default/files/2026-04/Contracts-bidtabulation-26Z001.pdf');
  const WSDOT_25Z012 = src('WSDOT bid tabulation 25Z012, SR 395 Stevens Co. (bids opened May 2025)', 'https://wsdot.wa.gov/sites/default/files/2025-05/Contracts-bidtabulation-25Z012.pdf');
  const ITD = src('ITD Average Unit Price History (low bids, 2025-2026 lettings)', 'https://apps.itd.idaho.gov/Apps/Estimating/Avg_Unit_Price.xlsx');
  const ACRESX = src('AcresX planning allowance (no official source)', '');

  // Avista Schedule 51: identical 2026 rates in both states, different residential allowance.
  const avistaRates = (source) => Object.freeze({
    ohPrimaryFixed: { value: 5952, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ohPrimaryPerFt: { value: 12.04, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ugPrimaryFixed: { value: 2754, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ugPrimaryPerFt: { value: 14.31, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ohTransformer: { value: 5222, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    padTransformer: { value: 9134, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ohServicePerFt: { value: 5.56, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ugServicePerFt: { value: 10.78, unit: 'per ft', asOf: '2026-05-15', source, verified: true }
  });

  // AcresX allowances shared by both local counties. Not from any official source; always labeled.
  const PLANNING = Object.freeze({
    // Power where no tariff is published (the generic counties' allowance).
    powerBase: { low: 3500, high: 6000, unit: 'per service', source: ACRESX, verified: false },
    powerPerFt: { low: 14, high: 22, unit: 'per ft', source: ACRESX, verified: false },
    powerUnknown: { low: 5000, high: 25000, unit: 'per service', source: ACRESX, verified: false },
    // Distances used when the line distance is unknown.
    unknownLineFt: { low: 100, high: 1320 },
    serviceDropFt: 100,
    // Private water service line and side sewer from the main to the house.
    waterServiceLine: { low: 1000, high: 4000, unit: 'per connection', source: ACRESX, verified: false },
    sideSewer: { low: 1500, high: 6000, unit: 'per connection', source: ACRESX, verified: false },
    // Installed septic system by USDA soil screening (no official installed-cost source exists).
    septicInstall: {
      favorable: { low: 7500, high: 11500 }, moderate: { low: 10500, high: 15500 },
      limited: { low: 14500, high: 22000 }, unknown: { low: 10000, high: 17000 },
      source: ACRESX, verified: false
    },
    // Well drilling, casing and pump (driller quotes needed).
    wellPerFt: { low: 42, high: 60, unit: 'per ft of depth', source: ACRESX, verified: false },
    wellFixed: { low: 3500, high: 5500, unit: 'pump, tank, wiring', source: ACRESX, verified: false },
    wellNoDepth: { low: 17500, high: 26000, source: ACRESX, verified: false },
    existingWellDueDiligence: { low: 700, high: 1800, source: ACRESX, verified: false },
    // Building permits where the jurisdiction's schedule is not sourced: the span of the two
    // sourced schedules (City of Spokane 2025, Kootenai County 2026, Spokane County BP-04), widened.
    permitGeneric: { low: 3000, high: 6000, unit: 'per home', source: ACRESX, verified: false },
    // Clearing, erosion control and pad prep that is not bulk excavation.
    siteBase: { low: 1500, high: 3000, source: ACRESX, verified: false },
    // Generic public connection ranges stay in public/public-utilities.js (WATER_COST, SEWER_COST).
    home: { livingSf: 2000, garageSf: 500, valuationLow: 350000, valuationHigh: 500000 },
    // Driveway section: 12 ft wide, 6 in crushed base, 6 in subgrade excavation, 1.5 ton/cy.
    // Over longFt the measured length is shown as a range from 100 ft; maxFt caps it ("a private
    // road or easement likely serves this parcel"). Both are AcresX assumptions.
    driveway: { widthFt: 12, baseDepthFt: 0.5, excavationDepthFt: 0.5, tonsPerCy: 1.5, unknownLengthFt: { low: 100, high: 500 }, longFt: 1000, maxFt: 1500 },
    // Building-pad earthwork by slope tier (cy), on a 60 x 80 ft pad (4,800 sf).
    padCy: { flat: { low: 89, high: 178 }, rolling: { low: 178, high: 356 }, steep: { low: 356, high: 622 }, verySteep: { low: 622, high: 1067 } }
  });

  const COUNTIES = {
    'WA:spokane': {
      key: 'WA:spokane', state: 'WA', county: 'Spokane', label: 'Spokane County, WA', researched: '2026-11-12',
      power: {
        avista: {
          ...avistaRates(AVISTA_WA),
          allowance: { value: 7210, unit: 'per individual residence', asOf: '2025-05-15', source: AVISTA_WA, verified: true, note: 'Sheet 51A; the March 2026 rate filing did not change the allowance. Needs at least 4,800 kWh/yr of new load.' }
        },
        // Inland Power publishes no tariff; its online estimator (JavaScript, public, no login or
        // bot check; robots.txt allows it) was driven in headless Chromium on 2026-11-12 and its
        // "Estimated Cost" recorded per design. Distance = feet from the nearest electrical
        // facility to the meter. 100 ft offers the short (low-voltage) designs and asks whether the
        // nearest facility is a transformer; 200 ft and up offer the long (high-voltage) designs and
        // do not ask (nearestIsTransformer null). Excludes trenching, conduit and vaults.
        inland: {
          source: { name: 'Inland Power online residential service estimator, recorded 2026-11-12', url: 'https://www.inlandpower.com/residential-service-estimator' },
          recorded: '2026-11-12', maxFt: 2640, verified: true,
          points: [
          { ft: 100, design: 'Short Overhead', nearestIsTransformer: 'No', cost: 8100 },
          { ft: 100, design: 'Short Overhead', nearestIsTransformer: 'Yes', cost: 2700 },
          { ft: 100, design: 'Short Underground from Overhead', nearestIsTransformer: 'No', cost: 8000 },
          { ft: 100, design: 'Short Underground from Overhead', nearestIsTransformer: 'Yes', cost: 2700 },
          { ft: 100, design: 'Short Underground from Underground', nearestIsTransformer: 'No', cost: 9200 },
          { ft: 100, design: 'Short Underground from Underground', nearestIsTransformer: 'Yes', cost: 1600 },
          { ft: 200, design: 'Long Overhead', nearestIsTransformer: null, cost: 10300 },
          { ft: 200, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 14400 },
          { ft: 200, design: 'Long Underground', nearestIsTransformer: null, cost: 13200 },
          { ft: 200, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 10400 },
          { ft: 300, design: 'Long Overhead', nearestIsTransformer: null, cost: 10500 },
          { ft: 300, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 14600 },
          { ft: 300, design: 'Long Underground', nearestIsTransformer: null, cost: 13900 },
          { ft: 300, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 11000 },
          { ft: 400, design: 'Long Overhead', nearestIsTransformer: null, cost: 13700 },
          { ft: 400, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 17800 },
          { ft: 400, design: 'Long Underground', nearestIsTransformer: null, cost: 14500 },
          { ft: 400, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 11700 },
          { ft: 500, design: 'Long Overhead', nearestIsTransformer: null, cost: 13900 },
          { ft: 500, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 18000 },
          { ft: 500, design: 'Long Underground', nearestIsTransformer: null, cost: 15200 },
          { ft: 500, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 12300 },
          { ft: 1000, design: 'Long Overhead', nearestIsTransformer: null, cost: 24000 },
          { ft: 1000, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 28100 },
          { ft: 1000, design: 'Long Underground', nearestIsTransformer: null, cost: 18500 },
          { ft: 1000, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 15600 },
          { ft: 2640, design: 'Long Overhead', nearestIsTransformer: null, cost: 51600 },
          { ft: 2640, design: 'Long Overhead & Underground', nearestIsTransformer: null, cost: 55700 },
          { ft: 2640, design: 'Long Underground', nearestIsTransformer: null, cost: 33800 },
          { ft: 2640, design: 'Long Underground from Underground', nearestIsTransformer: null, cost: 30900 }
          ]
        }
      },
      connections: [
        {
          match: /^(?:city of spokane|spokane,? city of|spokane city)\b(?!\s*valley)/i, provider: 'City of Spokane',
          water: { value: 3475, unit: '5/8" meter', asOf: '2026-01-01', source: SPOKANE_GFC, verified: true, note: 'Water GFC; a 3/4" meter is $5,213.' },
          sewer: { value: 4887, unit: '5/8" meter', asOf: '2026-01-01', source: SPOKANE_GFC, verified: true, note: 'Wastewater GFC; a 3/4" meter is $7,330.' }
        }
      ],
      septicPermits: {
        agency: 'SRHD',
        items: [
          { label: 'OSS application (residential)', value: 1000, asOf: '2025', source: SRHD, verified: true },
          { label: 'OSS permit (residential)', value: 890, asOf: '2025', source: SRHD, verified: true }
        ],
        note: 'SRHD 2025 approved fees; the 2026 schedule is a proposed draft (dated 2025-09-25) with the same amounts.'
      },
      wellPermit: {
        start: { label: 'Ecology notice of intent (casing under 12 in)', value: 200, asOf: '2005-07-24', source: RCW_WELL, verified: true },
        extra: { label: 'SRHD water adequacy review (if required)', value: 180, asOf: '2025', source: SRHD, verified: true },
        // New permit-exempt wells in WRIA 55 (Little Spokane), Spokane County BP-04 Section VII.
        // No comparable charge is listed for WRIA 54, 56 or 57. The schedule does not say which
        // certificate package applies, so the range spans both.
        wria: {
          55: {
            surcharge: { label: 'ESSB 6091 WRIA 55 surcharge', value: 500, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true },
            certificate: { label: 'Stream flow mitigation certificate (Package A $3,000 or B $5,000)', low: 3000, high: 5000, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true }
          }
        }
      },
      permits: [
        {
          match: /^city of spokane$/i, jurisdiction: 'City of Spokane', kind: 'table',
          low: { value: 3560.05, valuation: 350000 }, high: { value: 4703.80, valuation: 500000 },
          asOf: '2025-01-21', source: SPOKANE_PERMIT_2025, verified: true,
          note: 'Total of processing, plan review (50%), stormwater review, permit, technology and state fees. An undated, owner-provided City schedule (plan review 25%) gives the same base permit fee and is used as a formula reference only.',
          approach: { label: 'Residential driveway approach permit', value: 32.10, asOf: '2026-01-01', source: SPOKANE_DEV_2026, verified: true }
        },
        {
          match: /^spokane county$/i, jurisdiction: 'Spokane County (unincorporated)', kind: 'spokane-county',
          // BP-04: cost-based fees since Jan 1, 2011 (not valuation-based).
          building: {
            processing: 138.29, planReview: 89.70, inspectionPerSf: 0.23, inspectionMin: 936.88, stateSurcharge: 6.50,
            asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true
          },
          plumbing: { label: 'Plumbing permit (county example, 17 fixtures)', value: 139.23, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true, note: '$27.12 processing + $11.38/fixture (min $81.35) - $81.35 new-home credit' },
          mechanical: { label: 'Mechanical permit (county example)', value: 192.53, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true, note: '$27.12 processing + per-item fees - $81.35 new-home credit' },
          septicReviewProcessing: { label: 'Septic review processing (BP-04)', value: 56.57, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true },
          manufactured: { label: 'Manufactured home (no basement): processing $104.16 + inspection $378.74', value: 482.90, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true },
          planningUga: { label: 'Residential permit planning review (UGA)', value: 246.81, asOf: '2026-08-21', source: SPOKANE_COUNTY_BP04P, verified: true },
          planningRural: { label: 'Residential permit planning review (rural)', value: 411.36, asOf: '2026-08-21', source: SPOKANE_COUNTY_BP04P, verified: true },
          septicReview: { label: 'Septic review (BP-04P)', value: 164.54, asOf: '2026-08-21', source: SPOKANE_COUNTY_BP04P, verified: true },
          info: {
            shoreline: { label: 'Shoreline exemption', value: 1151.82, asOf: '2026-08-21', source: SPOKANE_COUNTY_BP04P, verified: true, note: 'docks for a single-family home $919.28' },
            buffer: { label: 'Buffer adjustment', value: 822.73, asOf: '2026-08-21', source: SPOKANE_COUNTY_BP04P, verified: true }
          },
          note: 'Road approach permits are a separate Spokane County Public Works fee, not sourced and not included.'
        }
      ],
      driveway: {
        aggregatePerTon: { low: 32, high: 45, asOf: '2026-04-22', sources: [WSDOT_26Z001, WSDOT_25Z012], verified: true, note: 'Crushed surfacing base course, low bids' },
        excavationPerCy: { low: 37, high: 50, asOf: '2026-04-22', sources: [WSDOT_26Z001, WSDOT_25Z012], verified: true, note: 'Roadway excavation incl. haul, low bids' }
      }
    },
    'ID:kootenai': {
      key: 'ID:kootenai', state: 'ID', county: 'Kootenai', label: 'Kootenai County, ID', researched: '2026-11-12',
      power: {
        avista: {
          ...avistaRates(AVISTA_ID),
          allowance: { value: 2755, unit: 'per individual residence', asOf: '2026-05-15', source: AVISTA_ID, verified: true, note: 'Sheet 51B. Needs at least 2,500 kWh/yr of new load.' }
        },
        kec: {
          engineeringFee: { value: 750, unit: 'one time, applied toward the project', asOf: '2026-11-12', source: KEC, verified: true }
        }
      },
      connections: [
        {
          match: /coeur d.?alene|\bcda water\b/i, provider: "City of Coeur d'Alene",
          water: { value: 12303, unit: '1" meter', asOf: '2026-04-01', source: CDA_WATER_CAP, verified: true, note: 'Capitalization fee; rises to $16,404 on 2027-04-01.' },
          waterHookup: { value: 7116, unit: '1" or less, if the City installs', asOf: '2026-08-04', source: CDA_WATER, verified: true, note: '$6,066 hookup + $1,050 asphalt cut.' },
          sewer: { value: 6665, unit: 'single-family dwelling', asOf: '2023-03-07', source: CDA_SEWER, verified: true, note: 'Ordinance 3715 sets this charge for FY 2023-24 through FY 2027-28.' }
        },
        {
          match: /post falls/i, provider: 'City of Post Falls',
          water: { value: 3260, unit: '3/4"-1" residential', asOf: '2026-10-13', source: POST_FALLS, verified: true, note: 'Water capitalization; the meter and the dig-in are billed at cost.' },
          sewer: { value: 7725, unit: '1 service unit (single family)', asOf: '2026-10-13', source: POST_FALLS, verified: true }
        },
        {
          match: /^city of hayden$/i, provider: 'City of Hayden',
          sewer: { value: 10404, unit: 'per dwelling', asOf: '2023-09-01', source: HAYDEN, verified: true, note: '$5,244 collection + $5,160 HARSB treatment. A 2026 update was scheduled for hearing; outcome not confirmed.' }
        }
      ],
      septicPermits: {
        agency: 'Panhandle Health District',
        items: [],
        note: "Panhandle Health District's fee schedule could not be read (its site blocks automated requests), so no permit fee is added. Confirm it with PHD."
      },
      wellPermit: {
        start: { label: 'IDWR drilling permit (domestic)', value: 75, asOf: '2026-11-12', source: IDWR, verified: true }
      },
      permits: [
        {
          match: /^kootenai county$/i, jurisdiction: 'Kootenai County', kind: 'kootenai-ubc',
          valuation: { livingPerSf: 196.82, garagePerSf: 75.04 },
          brackets: [{ over: 100000, upTo: 500000, base: 993.75, perThousand: 5.60 }, { over: 500000, upTo: 1000000, base: 3233.75, perThousand: 4.75 }],
          planReviewPct: 0.30, applicationFee: 141, zoningReview: 176, siteDisturbance: 187,
          asOf: '2026-06', source: KC_FEES, verified: true,
          approach: { label: 'Approach permit (Post Falls Highway District fee, used as a placeholder for other highway districts)', value: 250, asOf: '2021-06-16', source: PFHD, verified: true, placeholder: true }
        }
      ],
      impactFees: [
        { match: /^city of post falls$/i, label: 'City of Post Falls impact fees (parks, public safety, streets, multimodal, fire, EMS; not water or sewer)', value: 14594, asOf: '2026-10-13', source: POST_FALLS, verified: true }
      ],
      driveway: {
        aggregatePerTon: { low: 29, high: 34.20, asOf: '2026-10-20', sources: [ITD], verified: true, note: '3/4" aggregate type B for base, low-bid medians (District 1 / statewide)' },
        excavationPerCy: { low: 21, high: 24, asOf: '2026-10-20', sources: [ITD], verified: true, note: 'Excavation, low-bid medians (statewide / District 1)' }
      }
    }
  };

  const T = Object.freeze({ COUNTIES, PLANNING, SOURCES: { ACRESX } });
  root.AcresXCostTables = T;
})(typeof window !== 'undefined' ? window : globalThis);
