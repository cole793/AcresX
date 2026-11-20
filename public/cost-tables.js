// Local development-cost price tables (owner request 2026-11-12: "tighter, based on local county
// data", starting with Spokane, WA and Kootenai, ID; Yellowstone and Gallatin, MT added
// 2026-11-14). Read by public/local-cost-model.js
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
// (re-read 2026-11-12; Montana 2026-11-14). verified: false means AcresX planning allowance or an unconfirmed
// figure, always labeled as such in the UI. Search-snippet figures are left out entirely.
// Listing/MLS data never feeds these tables or the estimate.
(function (root) {
  const src = (name, url) => Object.freeze({ name, url });

  const AVISTA_WA = src('Avista Utilities, Washington Schedule 51 (Tariff WN U-28)', 'https://www.myavista.com/-/media/myavista/content-documents/our-rates-and-tariffs/wa/wa_051.pdf');
  const AVISTA_ID = src('Avista Utilities, Idaho Schedule 51 (I.P.U.C. No. 28) as filed in case AVU-E-26-02; effective 2026-05-15', 'https://www.myavista.com/-/media/myavista/content-documents/our-rates-and-tariffs/id/rate-requests/id-schedule-51.pdf');
  const IPUC_ORDER = src('Idaho PUC Final Order No. 37042 (case AVU-E-26-02): Schedule 51 tariff approved as filed, effective 2026-05-15', 'https://puc.idaho.gov/Fileroom/PublicFiles/ELEC/AVU/AVUE2602/OrdNotc/20260515Final_Order_No_37042.pdf');
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
  // The county's Community Development page links this document as "Fee Schedule (PDF)"; the
  // document itself is Resolution No. 2026-62 (re-read 2026-11-13). Its old URL slug said 2024-55,
  // so the ID-only link is cited.
  const KC_FEES = src('Kootenai County Resolution No. 2026-62, Community Development Fee Schedule (June 2026)', 'https://www.kcgov.us/DocumentCenter/View/24018');
  const SPOKANE_PERMIT_2025 = src('City of Spokane, 2025 Building Permit Fee Table for New Single-Family Residences', 'https://static.spokanecity.org/documents/business/resources/permit-fees/building-permit-fee-schedule-new-homes-2025-01-21.pdf');
  const SPOKANE_DEV_2026 = src('City of Spokane, Development Fee Schedule 2026', 'https://static.spokanecity.org/documents/smc/attachments/development-fee-schedule-2026.pdf');
  const SPOKANE_COUNTY_BP04P = src('Spokane County Building & Planning, 2026 Land Use Fee Schedule (BP-04P rev. 08/26; owner-provided copy)', 'https://www.spokanecounty.org/194/Building-Planning');
  const SPOKANE_COUNTY_BP04 = src('Spokane County BP-04 Fee Schedule, Building Dept. (owner-provided, undated)', 'https://www.spokanecounty.org/194/Building-Planning');
  const PFHD = src('Post Falls Highway District, Set Fees and Deposits (effective 6/16/2021, CPI-adjusted yearly)', 'https://www.postfallshd.com/uploads/1/4/2/5/142542594/fees___deposits_1.pdf');
  const WSDOT_26Z001 = src('WSDOT bid tabulation 26Z001, 2026 Eastern Region (bids opened Apr 22, 2026)', 'https://wsdot.wa.gov/sites/default/files/2026-04/Contracts-bidtabulation-26Z001.pdf');
  const WSDOT_25Z012 = src('WSDOT bid tabulation 25Z012, SR 395 Stevens Co. (bids opened May 2025)', 'https://wsdot.wa.gov/sites/default/files/2025-05/Contracts-bidtabulation-25Z012.pdf');
  const ITD = src('ITD Average Unit Price History (low bids, 2025-2026 lettings)', 'https://apps.itd.idaho.gov/Apps/Estimating/Avg_Unit_Price.xlsx');
  const ACRESX = src('AcresX planning allowance (no official source)', '');

  // Montana (researched 2026-11-14; every figure re-read in the downloaded primary document).
  const DLI_BP_FAQ = src('Montana DLI Building Codes Bureau, Building Permit FAQ', 'https://bsd.dli.mt.gov/Building-Codes-Permits/permit-applications/building-permits/building-permit-faq');
  const DLI_ELEC = src('Montana DLI, Application for Residential Electrical Permit (ARM 24.301.431, Rev. 11/25)', 'https://bsd.dli.mt.gov/_docs/building-codes-permits/ApplicationResidentialElectrical.pdf');
  const DLI_PLUMB = src('Montana DLI, Application for Plumbing Permit (BCP-1, Rev. 11/25)', 'https://bsd.dli.mt.gov/_docs/building-codes-permits/ApplicationPlumbingPermit.pdf');
  const DNRC_602I = src('Montana DNRC Form 602I, Notice of Intent to Appropriate Groundwater (effective 01/2026)', 'https://dnrc.mt.gov/_docs/water/Water-Rights-Forms/602I.pdf');
  const DNRC_602 = src('Montana DNRC Form 602, Notice of Completion of Groundwater Development (revised 01/2026)', 'https://dnrc.mt.gov/_docs/water/Water-Rights-Forms/602.pdf');
  const NWE_RULE6 = src('NorthWestern Energy Montana Electric Tariff Rule No. 6, Line Extensions (sheet R-6.1, effective 2020-03-01)', 'https://northwesternenergy.com/docs/default-source/default-document-library/billing-and-payment/rates-and-tariffs/montana/rules/electric/rule_6_et.pdf');
  const YC_PW = src('Yellowstone County Public Works, Permits', 'https://www.yellowstonecountymt.gov/publicworks/permits.asp');
  // The document is headed "Subdivision Fee Schedule - YCO FY21-22-23"; its zoning section is
  // headed "Zoning Fee Schedule - YCO FY21-22" with one FY21 column. Latest published figures.
  const YC_PLANNING = src('Yellowstone County Planning Fee Schedule (headed YCO FY21-22-23)', 'https://www.billingsmt.gov/DocumentCenter/View/54699');
  const RSH = src('RiverStone Health, Subdivision Review Fee Calculation Checklist (revised 08/22/2024)', 'https://riverstonehealth.org/wp-content/uploads/Local-Fees-2024.8.22.pdf');
  const YVEC_LINE = src('Yellowstone Valley Electric Cooperative, Line Extensions', 'https://www.yvec.com/your-account/request-service/line-extensions/');
  const YVEC_NEW = src('Yellowstone Valley Electric Cooperative, New Construction', 'https://www.yvec.com/new-construction/');
  const MYEC_104 = src('Mid-Yellowstone Electric Cooperative Policy 104, Line Extensions and Temporary Services (revised 05/25/2021)', 'https://myec.coop/sites/default/files/Policy%20104%20Line%20Extensions%20and%20Temporary%20Services.pdf');
  const MDT_2026 = src('MDT Tabulation of Bids 2026 (lettings Jan 15 - Oct 22, 2026)', 'https://mdt.mt.gov/other/webdata/external/contractplans/contract/archives/Bid_tabs/2026.pdf');
  const MDT_2025 = src('MDT Tabulation of Bids 2025', 'https://mdt.mt.gov/other/webdata/external/contractplans/contract/archives/Bid_tabs/2025.pdf');
  const GAL_PLANNING = src('Gallatin County Planning & Community Development, Schedule of Fees (September 21, 2026)', 'https://www.gallatinmt.gov/DocumentCenter/View/1301/Fee-Schedule-');
  const GAL_ROAD = src('Gallatin County Road and Bridge Department, Application for an Access Permit', 'https://www.gallatinmt.gov/DocumentCenter/View/168/Road-Access-Permit-Application');
  const GCCHD = src('Gallatin City-County Health Department, Appendix 2 Environmental Health Services Fee Schedule (effective October 27, 2018)', 'https://www.healthygallatin.org/wp-content/uploads/2018/10/HC-1-Fee-schedule-only.pdf');
  const PARK_NEW = src('Park Electric Cooperative, New Services', 'https://www.parkelectric.coop/electrical-projects');
  const PARK_AID = src('Park Electric Cooperative, Construction Aid', 'https://www.parkelectric.coop/construction-aid');
  const FALL_RIVER = src('Fall River Electric, New Service Requirements', 'https://www.fallriverelectric.com/new-service-requirements');

  // Avista Schedule 51: identical 2026 rates in both states, different residential allowance.
  const avistaRates = (source) => Object.freeze({
    ohPrimaryFixed: { value: 5952, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ohPrimaryPerFt: { value: 12.04, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ugPrimaryFixed: { value: 2754, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ugPrimaryPerFt: { value: 14.31, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ohTransformer: { value: 5222, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    padTransformer: { value: 9134, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ohServicePerFt: { value: 5.56, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    ugServicePerFt: { value: 10.78, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    // Secondary circuit (sheet 51I in WA, 51N in ID): only where Avista's design runs one between
    // the transformer and the service, so it is added to the high end of the range only.
    ohSecondaryFixed: { value: 2466, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ugSecondaryFixed: { value: 688, unit: 'per customer', asOf: '2026-05-15', source, verified: true },
    ugSecondaryPerFt: { value: 13.18, unit: 'per ft', asOf: '2026-05-15', source, verified: true },
    // "(one) Design Fee of $150 (if paid)" is subtracted from the extension cost.
    designFeeCredit: { value: 150, unit: 'credited if paid', asOf: '2026-05-15', source, verified: true }
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
    secondaryFt: 100, // assumed underground secondary run, high end of the Avista range only
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
    // Below minFt the driveway is the minFt "minimum allowance". Over longFt the measured length is
    // shown as a range from 100 ft; maxFt caps it ("a private
    // road or easement likely serves this parcel"). Both are AcresX assumptions.
    driveway: { widthFt: 12, baseDepthFt: 0.5, excavationDepthFt: 0.5, tonsPerCy: 1.5, unknownLengthFt: { low: 100, high: 500 }, minFt: 50, longFt: 1000, maxFt: 1500 },
    // Building-pad earthwork by slope tier (cy), on a 60 x 80 ft pad (4,800 sf).
    padCy: { flat: { low: 89, high: 178 }, rolling: { low: 178, high: 356 }, steep: { low: 356, high: 622 }, verySteep: { low: 622, high: 1067 } },
    // "Most likely" pricing (owner request 2026-11-20: the total range was too wide, mostly from
    // power and wells, because lines were priced low quantity x low rate to high quantity x high
    // rate). public/local-cost-model.js prices each power and well line at a central quantity x the
    // central rate (the midpoint of the low/high rates above), gives a likely range from the main
    // unknown only, and states the worst case in words ("could reach ...") outside the range.
    // All AcresX assumptions (no official source); every one is named in the line's basis.
    likely: {
      well: {
        bandPct: 0.25,          // likely depth range with low confidence: central +/- 25% (inside the depth range)
        waterPenetrationFt: 50  // a well goes at least ~50 ft below the static water level at the homesite
      },
      power: {
        shortRunFt: 150,        // a run this short or shorter: an underground service from the nearest pole/transformer
        structureRunFt: 150,    // assessor lists improvements: service is likely already on or next to the site
        minRunFt: 50,
        unknownRunFt: 500,      // no mapped line, no improvements and no road answer
        unknownBandFt: [200, 1000],
        roadBand: { lowPct: 0.75, highPct: 1.5, minExtraFt: 200 }, // the line may be across the road or a few spans along it
        mappedBandPct: 0.20,    // a utility-published line distance: +/- 20% (route, rock, design details)
        osmBandPct: 0.25,       // an OpenStreetMap pole/line within 1,000 ft (mapped lines only)
        genericMappedBandPct: 0.25, // no published per-foot rate (NorthWestern, co-ops, KEC, others) with a mapped distance
        tailMinFt: 1320,        // "could exceed": a line extended at least a quarter mile ...
        tailMaxFt: 2640         // ... and at most half a mile (twice the likely run in between)
      }
    }
  });

  // Montana, both counties. Neither county issues building permits outside city limits and neither
  // is a DLI-certified county program, so on county land the state (DLI) issues the electrical and
  // plumbing permits and no building permit is needed for a single-family home.
  const MT_STATE = Object.freeze({
    noBuildingPermit: { label: 'Building permit: none required for a single-family home outside a city that issues its own', value: 0, asOf: 'undated', source: DLI_BP_FAQ, verified: true },
    electrical: { label: 'DLI electrical permit, single-family dwelling (up to 200 A $200; 201-400 A $380)', low: 200, high: 380, asOf: '2025-11', source: DLI_ELEC, verified: true, note: 'The homeowner permit for an owner who wires their own home lists the same amounts.' },
    // Itemized for the same assumed home as the Spokane County worked example (17 fixtures/traps).
    plumbing: { label: 'DLI plumbing permit, itemized (17 fixtures/traps x $10 + water supply connection $20 + building drain connection $20 + water heater $25 + 2 hose bibbs x $6)', value: 247, asOf: '2025-11', source: DLI_PLUMB, verified: true, note: 'not needed when the owner does the plumbing on a home for their own use, not for resale or rent, per DLI' },
    well: {
      start: { label: 'DNRC Notice of Intent (Form 602I)', value: 400, asOf: '2026-01-01', source: DNRC_602I, verified: true },
      also: [{ label: 'DNRC Notice of Completion (Form 602)', value: 250, asOf: '2026-01-01', source: DNRC_602, verified: true }]
    },
    northwestern: {
      allowance: { value: 400, unit: 'per residential service', asOf: '2020-03-01', source: NWE_RULE6, verified: true, note: 'the service drop, up to 150 ft overhead or 100 ft underground, plus the transformer and meter are allowed on top of it' }
    }
  });
  // State DOT bid prices per cubic yard (MDT bids crushed aggregate course by the CY, not the ton).
  // Low = median low-bidder unit price of the 2025-2026 lines of 1,000 CY or more in the district;
  // high = median low-bidder unit price of all the district's lines (small quantities included),
  // so the high end leans toward small-job prices. Low-bidder prices only; unbalanced bids included.
  const mdtDriveway = (district, agg, exc) => ({
    bidLabel: `MDT ${district} District`,
    aggregatePerCy: { low: agg[0], high: agg[1], asOf: '2026-11-04', sources: [MDT_2026, MDT_2025], verified: true, note: `Crushed aggregate course, ${district} District low bids` },
    excavationPerCy: { low: exc[0], high: exc[1], asOf: '2026-11-04', sources: [MDT_2026, MDT_2025], verified: true, note: `Excavation-unclassified, ${district} District low bids` }
  });

  const COUNTIES = {
    'WA:spokane': {
      key: 'WA:spokane', state: 'WA', county: 'Spokane', label: 'Spokane County, WA', researched: '2026-11-12',
      power: {
        avista: {
          ...avistaRates(AVISTA_WA),
          allowance: { value: 7210, unit: 'per individual residence', asOf: '2025-05-15', source: AVISTA_WA, verified: true, note: 'Sheet 51A; the March 2026 rate filing did not change the allowance. Needs at least 4,800 kWh/yr of new load.', condition: 'at least 4,800 kWh a year of new load' }
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
          plumbing: { label: 'Plumbing permit, county worked example (typical home, 17 fixtures)', value: 139.23, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true, note: '$27.12 processing + $11.38/fixture (min $81.35) - $81.35 new-home credit' },
          mechanical: { label: 'Mechanical permit, county worked example (typical home)', value: 192.53, asOf: 'undated', source: SPOKANE_COUNTY_BP04, verified: true, note: '$27.12 processing + per-item fees - $81.35 new-home credit' },
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
          allowance: { value: 2755, unit: 'per individual residence', asOf: '2026-05-15', source: AVISTA_ID, verified: true, note: 'Sheet 51B. No immediate allowance for a load under 2,500 kWh/yr.', condition: 'at least 2,500 kWh a year of new load' },
          order: { asOf: '2026-05-15', source: IPUC_ORDER, verified: true }
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
    },
    'MT:yellowstone': {
      key: 'MT:yellowstone', state: 'MT', county: 'Yellowstone', label: 'Yellowstone County, MT', researched: '2026-11-14',
      power: {
        northwestern: MT_STATE.northwestern,
        // Co-ops publish no per-foot rate or allowance; only deposits and payment rules.
        coops: [
          { match: /yellowstone valley/i, name: 'Yellowstone Valley Electric Cooperative', short: 'YVEC',
            fee: { label: 'construction deposit (non-refundable, credited toward construction charges)', value: 150, credited: true, asOf: 'undated', source: YVEC_NEW, verified: true },
            policy: { text: 'final cost is the actual construction expense; prepay 50% of the estimate up to $2,000 and 100% above $2,000', asOf: 'undated', source: YVEC_LINE, verified: true } },
          { match: /mid[- ]?yellowstone/i, name: 'Mid-Yellowstone Electric Cooperative', short: 'MYEC',
            policy: { text: 'construction costs are paid in full before line construction starts; MYEC may, but is not required to, contribute up to $1,000', asOf: '2021-05-25', source: MYEC_104, verified: true } }
        ]
      },
      connections: [],
      septicPermits: {
        agency: 'RiverStone Health',
        items: [
          { label: 'Individual water supply system', value: 110, asOf: '2024-08-22', source: RSH, verified: true },
          { label: 'New gravity system (1 drainfield)', value: 120, asOf: '2024-08-22', source: RSH, verified: true },
          { label: 'Nondegradation review, individual (1 drainfield)', value: 70, asOf: '2024-08-22', source: RSH, verified: true },
          { label: 'Inspection before backfilling (1 drainfield)', value: 300, asOf: '2024-08-22', source: RSH, verified: true }
        ],
        highItems: [
          { label: 'dosed/mound system design', value: 180, asOf: '2024-08-22', source: RSH, verified: true },
          { label: 'subdivision lot or COS tract fee (not charged for unplatted land)', value: 160, asOf: '2024-08-22', source: RSH, verified: true }
        ],
        note: 'RiverStone Health says an engineer or land use consultant typically prepares the application; that fee is not sourced and not included.'
      },
      wellPermit: MT_STATE.well,
      permits: [
        {
          match: /^yellowstone county$/i, jurisdiction: 'Yellowstone County (outside city limits)', kind: 'mt-county',
          noBuildingPermit: { ...MT_STATE.noBuildingPermit, source: YC_PW, note: 'Yellowstone County does not issue building permits outside the city limits of Billings' },
          electrical: MT_STATE.electrical, plumbing: MT_STATE.plumbing,
          zoning: { kind: 'flat', label: 'Zoning compliance permit (residential)', value: 77, asOf: 'FY21-22', source: YC_PLANNING, verified: true, where: 'a county zoning district', dated: 'from a fee schedule headed FY21-22-23; the latest published figure, possibly out of date' },
          approach: { label: 'Residential road approach permit (county road)', value: 75, asOf: 'undated', source: YC_PW, verified: true }
        }
      ],
      cityPermitNote: 'Billings, Laurel and Broadview issue their own building permits; those fee schedules are not sourced here.',
      driveway: mdtDriveway('Billings', [50, 65], [16.53, 22])
    },
    'MT:gallatin': {
      key: 'MT:gallatin', state: 'MT', county: 'Gallatin', label: 'Gallatin County, MT', researched: '2026-11-14',
      power: {
        northwestern: MT_STATE.northwestern,
        coops: [
          { match: /park electric/i, name: 'Park Electric Cooperative', short: 'Park Electric',
            fee: { label: 'site visit fee (credited toward the aid of construction)', value: 500, credited: true, asOf: 'undated', source: PARK_NEW, verified: true },
            policy: { text: 'aid of construction is estimated from Park Electric\'s historical average costs and paid in full before the job is scheduled', asOf: 'undated', source: PARK_AID, verified: true } },
          { match: /fall river/i, name: 'Fall River Electric', short: 'Fall River',
            fee: { label: 'estimate fee (charged for every estimate)', value: 250, credited: false, asOf: 'undated', source: FALL_RIVER, verified: true },
            policy: { text: 'in Montana the member pays the estimated aid to construction', asOf: 'undated', source: FALL_RIVER, verified: true } },
          { match: /vigilante/i, name: 'Vigilante Electric Cooperative', short: 'Vigilante',
            policy: { text: 'no published line-extension terms found (its website blocks automated reads)' } }
        ]
      },
      connections: [],
      septicPermits: {
        agency: 'Gallatin City-County Health Department',
        items: [
          { label: 'Wastewater system permit, new', value: 375, asOf: '2018-10-27', source: GCCHD, verified: true },
          { label: 'Review fee, lot requiring site evaluation', value: 275, asOf: '2018-10-27', source: GCCHD, verified: true }
        ],
        note: 'The review fee is $140 instead for a lot not requiring site evaluation (one with a COSA). The site evaluation must be done by a Gallatin County Registered Site Evaluator or a Montana PE; that fee is not sourced and not included.'
      },
      wellPermit: MT_STATE.well,
      permits: [
        {
          match: /^gallatin county$/i, jurisdiction: 'Gallatin County (outside city limits)', kind: 'mt-county',
          noBuildingPermit: { ...MT_STATE.noBuildingPermit, note: 'Gallatin County is not a DLI-certified building code program; Bozeman, Belgrade, Manhattan and West Yellowstone are certified for their own limits' },
          electrical: MT_STATE.electrical, plumbing: MT_STATE.plumbing,
          // "The greater of $430 or 1/4 of one percent (0.0025) of the market value of construction,
          // excluding land cost. Maximum fee is $5,400"; market value at least $200/sf finished and
          // $100/sf unfinished (the garage is counted as unfinished).
          zoning: { kind: 'lup', label: 'Land Use Permit (standard, residential)', min: 430, pct: 0.0025, max: 5400, finishedPerSf: 200, unfinishedPerSf: 100, asOf: '2026-09-21', source: GAL_PLANNING, verified: true, where: 'a county zoning district' },
          approach: { label: 'Access permit application (county road)', value: 125, asOf: '2020-10-27', source: GAL_ROAD, verified: true }
        }
      ],
      cityPermitNote: 'Bozeman, Belgrade, Manhattan and West Yellowstone issue their own building permits; those fee schedules are not sourced here.',
      driveway: mdtDriveway('Butte', [68, 75], [20, 24])
    }
  };

  const T = Object.freeze({ COUNTIES, PLANNING, SOURCES: { ACRESX } });
  root.AcresXCostTables = T;
})(typeof window !== 'undefined' ? window : globalThis);
