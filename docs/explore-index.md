# Parcel search index ("Explore"): design, Phase 1 step 1

Status: design and schema only (2026-11-23, branch `claude/explore-index-design`). No runtime
code, route, binding or database exists yet. The schema is `migrations-index/0001_parcel_index.sql`.

## In plain words

Today AcresX answers one question at a time: you type a parcel number and it builds a report.
"Explore" turns that around. You ask "show me 5 to 20 acres in Stevens County, mostly flat, no
flood zone, manufactured home allowed" and get a list and a map of the parcels that fit.

To do that fast, AcresX needs every rural parcel already checked ahead of time. The plan:

1. **A list of rural parcels.** Once a week or so, a job on GitHub (not the live website) reads
   the parcel maps of the five counties and keeps the parcels that matter for rural land:
   anything 1 acre or more outside city limits, vacant lots outside city limits, and 1 acre or more
   inside city limits. It skips small city lots, condos, commercial and industrial property, road
   and rail strips, and public land.
2. **The same checks the report does.** For each kept parcel the job runs the same AcresX code
   the report runs (flood, wetlands, slope, soil, wells, power, zoning, buildable acres), and the
   same scoring code, so the score in the list is the score the report would show.
3. **A separate database.** The results go into a new database, `acresx-index`, kept apart from
   the existing MLS database, so a mistake in the index can never touch the live listings data.
4. **Honest gaps.** If a government map server is down when a parcel is checked, that one fact is
   left blank and marked "not checked". The parcel stays in the list, and its score is marked
   incomplete exactly as the report does today.
5. **Nothing changes on the live site** until later steps add a hidden `/explore` page, and only
   when the owner turns it on.

What the owner will be asked to approve, step by step, is listed under "Approvals needed" below.

## Scope

- Counties: Spokane WA, Stevens WA, Kootenai ID, Yellowstone MT, Gallatin MT.
- Store: new Cloudflare D1 database `acresx-index`, binding `INDEX_DB` (not `MLS_DB`).
- Refresh: a scheduled GitHub Actions workflow (not the Worker cron, which stays the MLS sync).
- Later steps (not in this PR): hidden `/explore` page with its own HTML (not added to
  `maybeInjectUiPolish()`), routes under `/api/explore/*` in `src/index.js` behind an
  `EXPLORE_ENABLED` var, an "Ask AcresX" box that turns a question into one strict
  `search_parcels` tool call, and a compare view. The existing dashboard and report do not change.
- Screening framing stays: every Explore result is screening information to verify with the
  responsible agency. Listing/MLS data may be shown and filtered on (price) but never feeds the
  score (CLAUDE.md "Rules").

## 1. Inclusion rule

One config value: `INCLUDE_MIN_ACRES = 1` (proposed home: `scripts/index/config.mjs`; every run
records the value it used in `index_runs.min_acres`). A parcel is **included** when it passes the
exclusions and one of the inclusion reasons:

| Reason (`inclusion_reason`) | Rule |
|---|---|
| `rural_acreage` | outside incorporated city/town limits and acres >= `INCLUDE_MIN_ACRES`, vacant |
| `rural_improved` | outside city limits, acres >= `INCLUDE_MIN_ACRES`, improved (tagged `improved = 1`) |
| `rural_vacant_small` | outside city limits, vacant, acres < `INCLUDE_MIN_ACRES` (any size) |
| `city_acreage` | inside city limits and acres >= `INCLUDE_MIN_ACRES` (vacant or improved) |

(a) in the brief maps to `rural_acreage` + `rural_improved`; (b) to `rural_vacant_small` (and
vacant rural >= 1 ac, already in (a)); (c) to `rural_improved`; the last clause to `city_acreage`.

**Excluded** (counted per reason in `index_runs.excluded_json`, not stored per parcel). WA DOR
land use codes are from WAC 458-53-030(5) (WSR 23-01-006), checked 2026-11-23; the same table is
`WA_LAND_USE_CODES` (`src/counties/stevens-assessor.js:86`). Kootenai `property_class` and MT
`PropType` values are the distinct values read live on 2026-11-23 (`handoff/findings.md`,
"Parcel index sources").

| Reason | WA (Spokane, Stevens): DOR code | Kootenai: `property_class` | MT (Yellowstone, Gallatin): `PropType` | Status |
|---|---|---|---|---|
| `city_small` | inside city limits and acres < `INCLUDE_MIN_ACRES` (spatial overlay, section 2) | same | same | ready |
| `condo` | 14 residential condo, 50 other condo | 526 (residential), 527 (commercial) | Condominium, Townhouse | ready |
| `commercial_industrial` | 16, 21-39, 51-59, 61-66 (list to finish against the WAC), plus 43 aircraft, 44 marine, 46 parking | 4xx (413, 416, 421, 435, 438, 442, 451), 3xx industrial (314, 317, 322, 336, 339, 343), 441 mixed | Industrial Property, Apartment, Mobile/RV Parks, Golf Course, Gravel Pit | MT has **no Commercial type**: commercial land is inside "Improved Property". Known gap until another signal is found (Q4) |
| `right_of_way` | 41 rail/transit, 42 motor vehicle, 45 highway/street ROW, 47 communication, 48 utilities, 49 other TCU | 667 operating property (likely utility/rail; unconfirmed, Q1) | "CA - Centrally Assessed", "CN - Centrally Assessed Non-Valued Property" | MT has no road ROW type; a shape test (long, thin: area / perimeter^2 below a cutoff, tuned on samples) catches strips with no code |
| `public_land` | PAD-US Fee overlay (below); 67 governmental services; Spokane `exmp_code` GOVT / WATD / CEM (meanings unconfirmed, Q2) | PAD-US Fee overlay; 681, 548 "NREV" (meanings unconfirmed, Q1) | PAD-US Fee overlay; Exempt Property, Tribal Property | ready, with unconfirmed codes used only together with PAD-US or exempt status |
| `no_geometry` / `no_id` | missing outline or parcel number | same | same | mechanical |

Choice made here: 43 (aircraft), 44 (marine craft) and 46 (parking) are commercial/transport
property, not strips, so they count as `commercial_industrial`, not `right_of_way`. Both are
excluded either way; only the reason count differs. MT "Townhouse" is counted with condos (attached units on small lots); also a choice. Kootenai 525 (common areas) is not excluded
by code: common areas under 1 ac inside a city are already out, and larger ones fall to PAD-US or
the shape test, or stay as a known oddity. Rural residential classes (512, 515, 534, 537) and
in-city residential (541, 520) are kept and decided by the acreage and city rules. MT
"Non-Valued Property", "Partial Exempt Property", "On Leased Land" and null `PropType` (about
1,300 Yellowstone and 683 Gallatin rows) are not excluded by type.

**Public land:** the PAD-US 4.1 service AcresX already uses
(`Protection_Mechanism_Category_PADUS/FeatureServer/0`, `src/services/padus-easements.js`; last
edited 2025-06-04) also holds **Fee** records, including state trust lands (WA SDNR, WA SFW,
ID SDOL, MT SDNR) as large multipart features. The job downloads the Fee features inside each
county once per run and excludes a parcel when Fee land (federal, state, tribal, local) covers
most of it, or when the parcel's code says exempt/government (table above) and any Fee polygon
touches it. Whether a newer state trust-land source exists is open (Q6).

Rules:
- **Acres** used for the rule are the same acres the report headlines (see the acres row in the
  data plan). A parcel near the cutoff keeps its decision for the run.
- **City limits** come from each county's city-limits layer (section 2), by spatial overlay. The parcel is "inside" when a
  city covers most of it, the rule `kootenai-cities.js` already uses (`:49`). A failed city-limits
  layer does not drop parcels: the parcel is kept with `in_city = NULL` and the `city_limits`
  layer flagged (degraded-layer rule), and the rule falls back to the acreage test only.
- **Vacant vs improved**: `improved = 1` when the assessor lists improvement value > 0, the same
  test the report uses for "Assessor lists improvements" (`public/coverage-trust.js:82`
  `existingStructure`). MT also has `PropType` "Vacant Land"/"Improved Property"
  (`src/states/montana/assessment.js:19`). Unknown improvement value: `improved = NULL`; such
  parcels are included only by the acreage test.
- Owner names are never read for the rule, never stored and never displayed (policy 2026-11-18;
  `CLAUDE.md`). Public land is detected from PAD-US and tax status, not owner name. If the reader
  finds owner-name matching is needed for accuracy ("UNITED STATES", "STATE OF"), it may be used
  in memory only during the run, under the 2026-11-18 rule, and that needs an owner decision.

## 2. Per-county parcel source for the bulk pull

**Parity rule:** the bulk pull reads the same parcel layer the live parcel search uses for that
county, with the same fields and `outSR=4326`, so acres, outline and interior point match the
report. Owner and mailing fields are never requested (the adapters' field lists already exclude
them). Attributes the parcel layer lacks (land use code, exemption, assessed values) are joined
from the county's assessor layer by parcel number.

Verified 2026-11-23 (live read-only queries; `handoff/findings.md`, "Parcel index sources"):
every layer below supports pagination (`resultOffset`/`resultRecordCount`), `returnCountOnly`,
statistics and distinct values.

| County | Polygons (live source = bulk source) | Attributes joined | maxRecordCount | Rows (all / >= 1 ac, acres field) |
|---|---|---|---|---|
| Spokane WA | Assessor/Parcels MapServer/0 (`src/counties/spokane-parcels.js:25`), fields `SPOKANE_PARCEL_FIELDS` (`:27`) | ISDSDE/LandCapacityAnalysis/MapServer/0 by `PID_NUM`: `prop_use_code`, `exmp_code`, values (0.3 s per query vs 2.3 s on the SCOUT layer) | 2000 / 2000 | 214,839 / 52,303 (`acreage`) |
| Stevens WA | WA statewide Current_Parcels FeatureServer/0 ("Parcels_2026"), `FIPS_NR='065'` (the layer the report already uses, `public/index.html:92`). Native wkid 2927, `Shape__Area` in sq ft, no acres field; `LANDUSE_CD` filled (102 null of 42,943; matches the county `property_u`) | RealPropertyParcels_Public/MapServer/0 (`stevens-assessor.js:38`) by parcel number. **This county layer returns `geometry: null`**, so it can only supply attributes | 2000 / 2000 | 43,092 / 32,432 (`legal_acre`) |
| Kootenai ID | Ownership_Display MapServer/0 (`kootenai-parcels.js:18`), fields `KC_PARCEL_SEARCH_FIELDS` (`:21`). 94,992 rows vs 94,987 on Assessor_Layers 5-11; the 5 extra are left unscored if no assessor row joins | Assessor_Layers/MapServer 5-11 (`kootenai-assessor.js:23`) by PIN: `property_class`, values | 1000 / 1000 | 94,992 / 28,237 (`Acres`) |
| Yellowstone MT | DNRC Cadastral FeatureServer/0 (`src/states/montana/parcels.js:21`), `COUNTYCD=3`, fields `MONTANA_CADASTRAL_FIELDS` (`:10`) | on the same layer (`PropType`, `TotalLandValue`, `TotalBuildingValue`) | 2000 | 84,060 / 21,587 (`GISAcres`) |
| Gallatin MT | same layer, `COUNTYCD=6` (codes 3 and 6 confirmed by `Geocode` prefixes) | same | 2000 | 53,638 / 22,862 (`GISAcres`) |

Sum of parcels >= 1 ac: about 157,000. With the small rural vacant lots and minus the
exclusions, the index is expected at roughly **160,000-175,000 parcels**.

Note for Stevens parity: the statewide layer has no acres field, so `acres` is `Shape__Area` /
43,560 (the outline area, as the report computes it today) and the county `legal_acre` is kept
as context. The inclusion rule uses the same acres the report headlines.

**City limits** (spatial overlay; no parcel layer carries a reliable city flag: Kootenai
Ownership_Display `Incorp`, `CityCD` and `CITY_1` are null on every row):

| County | City-limits layer | Notes |
|---|---|---|
| Spokane | SCOUT/PermittingLookup/MapServer/0 "Jurisdictions" (`spokane-cities.js:5`) | NAME 'Spokane County' and 'Fairchild Air Force Base' (MUNITYP 'Other') = outside cities |
| Stevens | Stevens_County_Zoning_Data/MapServer/0 "Cities" (`stevens-cities.js:5,9`) | 6 cities; no polygon = unincorporated |
| Kootenai | **CAD_Map_Polygons/MapServer/3 "City Limits"** (15 dissolved features; areas match Census TIGER) | not Data_Layers/MapServer/18, which is tax code areas (`kootenai-cities.js:3,14`) |
| Yellowstone | Yellowstone/MapServer/30 (`yellowstone-utilities.js:32`) | values BILLINGS / LAUREL / BROADVIEW / COUNTY; COUNTY rows with `ISLAND='Y'` look like county islands inside a city (unconfirmed, Q9): treat COUNTY as outside |
| Gallatin | Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267 (`gallatin.js:28`) | |
| Fallback (any county) | Census TIGERweb `tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4` "Incorporated Places" | used only when the county layer fails; the run records which source it used |

Pull plan per county: (1) `returnCountOnly` with the county where clause, (2) page with
`resultOffset` in pages of the layer's maxRecordCount, `orderByFields=OBJECTID`, polite delay
between pages (the validation discovery uses 300 ms, `validation/counties/*.json` `delayMs`),
(3) page the attribute layer the same way and join by parcel number, (4) download the city
polygons and the PAD-US Fee features once, then a local area test with the majority rule,
(5) apply the rule. Measured from a container (not yet from a GitHub runner): paging all five
counties takes minutes, not hours. The expensive part is the per-parcel layers in section 3.

## 3. Per-field data plan

The key requirement is that index scores match the live report. So each field names where the
live report computes it today and how the batch gets the same value. "In-process" means the batch
calls the Worker's own handler in Node, the way `test/worker.test.js:27` calls
`worker.fetch(request, env, ctx)`: same code, same request body, no deploy, no load on the
production Worker. In Node `caches` is undefined, so `shared/edge-cache.js` is a no-op (its
documented behaviour) and every answer is fresh.

| Column(s) | Live source today | Batch source | Bulk alternative (later, only after a parity test) |
|---|---|---|---|
| `acres`, `acres_source` | parcel layer acres (assessor) and outline area; "show both" display `public/acreage.js`, overview `public/parcel-preview.js` | bulk parcel pull (same layer) | n/a |
| `lat`, `lng` | interior point: `zoningPoint()` `public/index.html:124` (centroid if inside, else nearest inside grid point) | same function, shared (refactor R4) | n/a |
| `in_city`, `city_name` | city-limits layers (table above), via `/api/zoning-permits` and `/api/public-utilities` | bulk city polygons + local test | n/a |
| `zoning_code`, `zoning_name`, `zoning_jurisdiction`, `zoning_status` | `/api/zoning-permits` (`src/counties/{spokane,stevens,kootenai,yellowstone,gallatin}.js`) | in-process, same body as `findZoningPermits` (`public/index.html:125`) | county zoning polygons downloaded once per run, then the adapter's pure share logic (needs R6) |
| `home_allowed`, `manufactured_home_allowed` (+ `_status`) | `/api/zoning-rules` tables in `src/zoning/*-rules.js` via `src/services/zoning-rules.js`; the report finds the single-family use with a regex at `public/property-report-v2.js:348` | in-process `/api/zoning-rules`, then a shared use matcher (R5). Tri-state: 1 permitted outright, 0 not permitted, NULL unknown/zone not mapped; `_status` keeps permitted / limited / conditional / not_permitted / not_mapped | static tables: no network at all |
| `flood_share_pct`, `flood_high`, `flood_zones` | `/api/hazards` kind flood: `src/services/flood.js` + `flood-share.js`; Stevens county FIRM `stevens-flood.js` | in-process | FEMA NFHL state download (MSC) fed to the same share code (needs R6); vintage recorded |
| `wetlands_pct`, `wetlands_category` | `/api/hazards` kind wetlands: `src/services/wetlands.js` | in-process | NWI state download (USFWS) to the same clip code (R6) |
| `slope_mean_pct`, `slope_median_pct`, `slope_p90_pct`, `slope_max_pct` | `src/services/slope-raster.js` (Terrarium tiles, Horn slope; outputs meanPct, p90Pct, maxPct) via `/api/land-analysis` terrain `gradePct` and `/api/slope-raster` | in-process `/api/slope-raster`; median needs a `p50Pct` output added to slope-raster (R7) | tiles are already a static dataset (AWS Terrain Tiles); a local tile mirror only saves requests |
| `buildable_acres`, `buildable_status`, `homesite_slope_pct` | `/api/buildable-area` `src/services/buildable-area.js` (flood SFHA + NWI + >30% slope removed; zoning setback text from the zoning-rules answer) | in-process, same body as `public/buildable-area.js` | follows flood/wetlands/slope |
| `septic_grade`, `soil_drainage`, `soil_hydro_group` | `/api/land-analysis` soil (`src/services/soils.js`, USDA SDA, Esri SSURGO backup), then re-graded in the browser with the homesite slope: `AcresXSeptic` `public/screening-inputs.js:236-334` | in-process land-analysis, then the shared septic code (R1) | SSURGO/gSSURGO state download (only after parity, R6) |
| `well_depth_ft`, `well_depth_low_ft`, `well_depth_high_ft`, `well_confidence`, `well_count` | wells list (WA: Ecology layer via `/api/arcgis` in `findWells` `public/index.html:112`; ID/MT: `/api/well-search`), then `/api/well-depth-terrain` (`src/services/well-depth-terrain.js`, `WELL_TERRAIN_RULES_VERSION` `:62`), then `AcresXWellDepth.stats/grade` `public/screening-inputs.js:89,197` | in-process, same requests as `findWells` and `public/well-terrain.js`; shared stats/grade (R1) | live only (records change; the wells layers are small queries) |
| `public_water`, `public_sewer` | `/api/public-utilities` `src/services/public-utilities.js`; scored by `AcresXUtilities.waterScore/septicScore` `public/public-utilities.js:193-194` | in-process + shared (R1) | n/a |
| `power_provider`, `power_territory_confirmed`, `power_line_distance_ft`, `power_line_source` | `/api/utility-territory` (ranked in the browser: `rankedProviders` `public/index.html:118`), `/api/power-intelligence` `src/services/power-intelligence.js` | in-process; ranking shared (R4). Overpass (OSM) is capped server-side and has a browser fallback (`src/utilities/osm-power.js`); the batch uses the server path only, so OSM-only distances may be missing where the browser would add them (only the distance, which the score does not use) | HIFLD transmission lines as a bulk file |
| `road_distance_ft`, `road_public` | `/api/cost-context` `roadAccess` (`src/services/road-access.js`; Stevens not configured) | in-process | county road centerlines downloaded once per run |
| `assessed_land`, `assessed_improvements`, `assessed_total`, `assessment_year`, `property_class` | `/api/property-assessment` (`src/counties/*-assessor.js`, `src/states/montana/assessment.js`) | bulk join (section 2: Spokane LandCapacityAnalysis/0, Stevens RealPropertyParcels_Public/0, Kootenai Assessor_Layers 5-11, MT Cadastral `TotalLandValue`/`TotalBuildingValue`/`PropType`); the report's `/api/property-assessment` reads the same layers per parcel, so the step 2 check compares the two | n/a |
| `tax_total`, `tax_year`, `tax_basis` | `/api/property-tax` `src/services/property-tax.js` (treasurer pages; Kootenai estimate from `kootenai-levy-2026.js`) | **not in the first runs**: these are web pages, not GIS layers; tens of thousands of page loads per county would be impolite and may trip bot checks. Kootenai's estimate is computed locally and can be filled. Others NULL with `tax` flagged `not_checked`; Explore links to the report for the bill | n/a |
| `improved` | see inclusion rule | bulk pull / assessment | n/a |
| `score`, `score_band`, `score_rating`, `score_factors_measured`, `score_provisional`, `score_factors_json`, `score_why` | browser only: `AcresXScore.calculate` `public/screening-refinements.js:226` (factors `:64`, missing inputs `:141`, buildable cap `:31`); terrain `AcresXTerrain` `screening-inputs.js:343`; flood `AcresXFlood` `flood-status.js:224,233`; wetlands `AcresXWetlands` `wetlands-status.js:105` | shared score core (R1-R3) run on a `last`-shaped object the batch assembles | n/a |
| `score_version` | does not exist today | new `SCORE_RULES_VERSION` (R2) | n/a |
| `cost_low`, `cost_central`, `cost_high` (optional) | `AcresXCostModel.estimate(last)` `public/local-cost-model.js:874`, prices `public/cost-tables.js:448` | same scripts (R8); not needed for step 2 | n/a |
| `list_price`, `listing_status`, `listing_key` | MLS demo data in `MLS_DB` (`/api/reso-listings`) | copied by the job with a read-only `SELECT` from `acresx-mls` (Q7). Filter and display only; never a score input | n/a |
| source timestamps | per answer (`checkedAt`, `asOf`, cache versions) | `parcel_layers.fetched_at`, `source_version` per parcel and layer | bulk file vintage in `source_version` |

### What is feasible in a GitHub Actions run

- **Bulk paging is cheap.** Paging all five parcel layers plus their attribute layers took
  minutes, not hours (measured 2026-11-23 from a container, not yet from a GitHub runner).
- **The per-parcel layers are the expensive part.** Per parcel, the in-process path makes about
  12-20 upstream requests (parcel already in hand; wells 1-3, zoning 2-6, flood 1-2, wetlands
  1-2, land 2-3, slope tiles 1-9, buildable 0-2, utility 1, power 2-4, public utilities 2-4,
  zoning rules 0). Several run in chains (parcel, then zoning, then zoning rules, then buildable
  area), so a parcel takes roughly 8-16 s of wall time, as the live report does. With 4 parcels in
  flight and the shared 4-per-host cap (`shared/upstream.js`), that is about 900-1,800 parcels
  per hour per job (requests x latency / concurrency). An estimate to measure on a runner in
  step 2 (Q3); runner-IP behaviour is unconfirmed.
- **First build:** about 170,000 parcels / 900-1,800 per hour = roughly 95-190 job-hours. With
  shards in parallel that is one to two weeks of nightly runs if the per-host request rate stays
  at today's level (shards share each host's budget, so more shards do not mean more load per
  host). Spokane alone (step 2) is a few nights.
- **Actions limits:** 6 h per job (verified 2026-11-23). The repo is public, so standard
  GitHub-hosted runners cost nothing. A county is split into shards (`parcel_id` hash mod N), each
  job stops cleanly before 6 h and the next run continues where it stopped (refresh order in
  section 4), so a long build needs no long job.
- Politeness: the same per-host cap, retries and timeouts as production; a daily per-host request
  budget; runs at night US Pacific; stop a county's run when a host keeps failing (mark the rest
  `stale`, do not hammer). County servers have blocked Cloudflare before (2026-10-28 outage,
  `handoff/README.md`); GitHub's runner IPs may also be blocked if the job is aggressive.
- The first full build is the expensive one; afterwards incremental runs touch only changed or
  stale parcels (section 4).
- Bulk federal downloads (NFHL, NWI, SSURGO, 3DEP) are a later optimisation, layer by layer, only
  where a parity test on the 50-parcel set gives the same numbers as the live services. Bulk data
  is a different vintage than the live service at times, which would break "matches the report";
  so the default is the live in-process path.

## 4. Refresh strategy

- **Schedule:** weekly full pass of the parcel list per county (cheap: paging the parcel layer),
  plus a nightly incremental scoring pass with a parcel budget per county.
- **What gets (re)scored**, in order:
  1. new parcels (in the pull, not in the index);
  2. parcels whose source changed: `source_hash` (hash of id, acres, outline rounded to 6
     decimals, assessor values, property class) differs from the stored one;
  3. parcels with any layer `unavailable`/`timeout` (retry, oldest first);
  4. parcels scored under an older `score_version` or `rules_version` (see below);
  5. parcels older than `MAX_AGE_DAYS` (proposed 90: wells, zoning and FEMA maps change).
- **Rules versions:** `index_runs.rules_json` records every version the run used:
  `SCORE_RULES_VERSION` (new, R2), `WELL_TERRAIN_RULES_VERSION` (`well-depth-terrain.js:62`), the
  cache prefixes that already encode rule versions (e.g. `PUBLIC_UTILITIES_CACHE_PREFIX`
  `public-utilities.js:76`), the zoning table versions, the git SHA. A score-only change (weights,
  thresholds) is a **rescore**: no network, the stored inputs (`parcel_inputs.inputs_json`) are
  re-run through the new score core. An input-rule change (e.g. well terrain) re-fetches that
  layer only.
- **Stale marking:** a parcel that is older than `MAX_AGE_DAYS`, or whose score version is behind,
  gets `stale = 1` and keeps its values; Explore shows "checked <date>". A parcel that leaves the
  parcel layer, or no longer passes the rule, gets `index_status = 'removed'` (kept for one
  weekly cycle, then deleted by the job) so a bad pull cannot wipe a county: if a pull returns
  fewer than 90% of the previous count, the run stops before marking anything removed.

## 5. Where it runs and limits

- **Job:** `.github/workflows/parcel-index.yml` (step 2), `schedule` + `workflow_dispatch`, Node
  22, running `scripts/index/*.mjs`. It imports `src/index.js` (in-process handlers) and the
  shared score core. It needs no Cloudflare Worker secrets: none of the score layers use
  `SERPER_*`/`RESO_*`. It never calls `/api/listing-evidence` or `/api/reso-listings` sync, and it
  never touches `MLS_DB` except an optional read-only `SELECT` for list prices (Q7).
- **Writes to D1:** two options, both batched:
  - `wrangler d1 execute acresx-index --remote --file batch.sql` with files of a few hundred
    `INSERT ... ON CONFLICT DO UPDATE` statements (simple, uses wrangler already in
    `devDependencies`);
  - the D1 HTTP API (`POST /accounts/{account_id}/d1/database/{database_id}/query`) with
    parameterized statements, for retries per batch.
  Either needs a Cloudflare API token with **D1 Edit** on the account, stored as a GitHub secret.
  The existing `CLOUDFLARE_D1_TOKEN` request (handoff "Waiting on the owner") would serve.
- **Binding change (later PR, not now):** after the database exists, `wrangler.jsonc` gets a
  second entry in `d1_databases`:
  `{ "binding": "INDEX_DB", "database_name": "acresx-index", "database_id": "<id from wrangler d1 create>", "migrations_dir": "migrations-index" }`.
  Adding it before the database exists would break `wrangler deploy`, so this PR does not touch
  `wrangler.jsonc`. `migrations_dir` keeps the index migrations apart from `migrations/`
  (the MLS database). Previews share the binding with production, so `/api/explore/*` must be
  read-only and `EXPLORE_ENABLED` is `false` for previews (as `ACCOUNTS_ENABLED` is in
  `preview.yml`).
- **D1 limits** (quoted from developers.cloudflare.com, verified 2026-11-23): database size
  10 GB on Workers Paid, 500 MB on Free; 100 KB per SQL statement; 100 bound parameters per
  statement; 30 s per query; 1,000 queries per Worker invocation on Paid, 50 on Free (a batch
  counts as one). Rows written: Free 100,000 per day; Paid 50 million per month included, then
  $1 per million. **Every index a write touches counts as an extra row written.** The job writes
  in chunks of about 1,000 rows, each statement under 100 KB.
- **Write budget.** Rows written per full build = parcels x (1 + indexes touched + layer rows +
  shape + inputs). With this schema:
  - `parcels`: 1 row + 12 secondary indexes + the primary-key index = 14
  - `parcel_layers`: about 18 layers x (1 row + primary-key index + `idx_layers_retry`) = 54
  - `parcel_shapes`: 1 row + primary-key index = 2
  - `parcel_inputs`: 1 row + primary-key index = 2
  - total about **72 rows written per parcel**; 170,000 parcels = about **12 million** rows.

  | Plan | Allowance | First full build |
  |---|---|---|
  | Free | 100,000 rows/day | about 120 days (and 500 MB may not hold it) |
  | Workers Paid | 50 million/month included | about a quarter of one month's allowance, no extra cost |

  **Change-hash skipping:** each parcel keeps `source_hash` (section 4) and the job keeps a hash
  of every row it last wrote (in the run's artifact). Nightly runs write only rows whose content
  changed, so a quiet night writes thousands of rows, not millions. If writes still matter,
  `parcel_layers` can be folded into a `layers_json` column on `parcels` (drops about 54 of the
  72 rows per parcel, at the cost of the per-layer retry index); decided in step 2 after a real
  Spokane run. Workers Paid is assumed (Q8).
- **Size:** one `parcels` row is about 1 KB, so 170,000 parcels is about 170 MB plus indexes;
  outlines add 0.5-3 KB each. `parcel_inputs` with the raw `last` JSON (20-60 KB each) would be
  3-10 GB, so it is optional and stores only what the score core reads (about 2-5 KB); the full
  answers stay as Actions artifacts for a few days for debugging.
- **Geometry:** `parcels.lat`/`lng` (interior point) for map pins and bbox filters, plus
  `bbox_*` columns so a large parcel that crosses the viewport edge is still found. Outlines are
  kept out of `parcels` and stored simplified (Douglas-Peucker to about 5 m, 6 decimals, GeoJSON
  text, typically 0.5-3 KB) in `parcel_shapes`, read only when the map zooms in or a compare view
  opens. That keeps the filter table narrow and list queries cheap; the outline is still needed to
  draw the parcel, so it is not omitted.

## 6. Degraded-layer rule

The report's rule applied to the index: **a failed layer never drops a parcel.**

- Each layer per parcel has a row in `parcel_layers` with `status` = `ok`, `none` (answered,
  nothing there), `unavailable`, `timeout`, `not_configured` (county has no source, e.g. Stevens
  roads), `not_checked` (deliberately skipped, e.g. tax).
- The layer's columns in `parcels` stay NULL when not `ok`/`none`, and `parcels.layers_missing`
  lists the missing keys (e.g. `flood,wetlands`) so Explore can say "flood not checked".
- The score follows `missingInputs()` exactly (`screening-refinements.js:141`): missing factors
  are left out and the weights re-normalized; fewer than 4 measured is "Provisional"; the
  completeness is stored (`score_factors_measured`, `score_provisional`). A filter such as
  "no flood zone" must not match a parcel whose flood layer is NULL; Explore shows those as
  "unknown" in a separate count, never as "no flood".
- A failed layer is retried by the next incremental run (refresh order 3).

## 7. Step plan

| Step | What | Done when |
|---|---|---|
| 1 (this PR) | design + schema | reviewed |
| 2 | refactors R1-R4 (each its own PR, no visible change); `scripts/index/` job for **Spokane only**; create `acresx-index` and apply `migrations-index/`; run on Spokane; **50-parcel check**: 50 parcels sampled across the acreage bands and inclusion reasons, each opened on the live site in a headless browser (Playwright, read-only) and its `#scoreMetric`, factor chips, buildable acres and zoning compared with the index row. Target: same score to 0.1 for every parcel whose inputs were all measured in both; any difference explained | 50/50 match or explained |
| 3 | `/explore` page (own HTML, not injected) + `/api/explore/search` (read-only, `INDEX_DB`) with the filters the schema indexes, map pins, link to the full report; `EXPLORE_ENABLED` off by default | owner try-out |
| 4 | "Ask AcresX": Claude turns the question into one strict `search_parcels` tool call (JSON schema of the same filters, no free SQL), the Worker runs it; needs an Anthropic API key secret | owner try-out |
| 5 | compare view; Stevens, Kootenai, Yellowstone, Gallatin added one at a time, each with its own 50-parcel check | per county |

## 8. Refactors needed for shared scoring (later PRs)

The score is computed only in the browser today, by classic scripts that hang helpers on
`window` (`AcresXScore`, `AcresXWellDepth`, `AcresXSeptic`, `AcresXTerrain`, `AcresXFlood`,
`AcresXWetlands`, `AcresXUtilities`) and read the page's global `last` and
`AcresXSections`. The browser has no build step, so the shared code stays a classic script in
`public/` (the `(function (root) { ... })(typeof window !== 'undefined' ? window : globalThis)`
pattern `screening-inputs.js` already uses), and Node loads it with `node:vm`, the way the tests
already do (`test/ui-harness.js`). No copy of the rules lives in `scripts/`.

- **R1. `public/score-core.js`:** move the pure parts of the score into one file: `WEIGHTS`,
  factor scores, `missingInputs`, `buildableCheck`, `calculateScore` from
  `screening-refinements.js:31-257`; `AcresXWellDepth` stats/grade, `AcresXSeptic`,
  `AcresXTerrain` from `screening-inputs.js`; `AcresXFlood.score/shareScore` and
  `AcresXWetlands.score` from `flood-status.js`/`wetlands-status.js`; the public water/sewer
  overrides from `public-utilities.js:193-194`. Every function takes `last` (and a section-status
  function) as an argument instead of reading globals. The existing files keep their `window`
  names as thin wrappers, so the dashboard and report do not change. Added to
  `maybeInjectUiPolish()` before `flood-status`.
- **R2. `SCORE_RULES_VERSION`** in `score-core.js`; bump on any weight, threshold or factor
  change (same discipline as `WELL_TERRAIN_RULES_VERSION`). A test fails when the score of the
  fixtures changes without a bump.
- **R3. Retire the duplicate score in `public/score-cost.js:2,53-99`** (an older copy of the
  weights and factors, superseded by `screening-refinements.js`, still rendering the same card
  first). Two copies is exactly the drift this project cannot afford.
- **R4. `public/report-inputs.js` (or part of R1):** the pieces of `public/index.html` the batch
  needs to build the same requests and the same `last`: `zoningPoint` (`:124`), `findWells` query
  plan (`:112`), `retailProviders`/`rankedProviders` (`:117-118`), and the request bodies of
  `progressive-loading.js` sections (`:34-58`) and follow-ups (`well-terrain.js`,
  `buildable-area.js`, `ui-polish.js` power, `public-utilities.js`). Then `scripts/index/assemble.mjs`
  calls the in-process handlers with exactly those bodies.
- **R5. Shared zoning use matcher** (`src/zoning/use-flags.js`, also loadable in the browser):
  the single-family regex from `property-report-v2.js:348` plus a manufactured-home matcher, each
  returning permitted / limited / conditional / not_permitted / unknown from the
  `src/zoning/*-rules.js` use lists. The report and the index both use it.
- **R6 (only if bulk data is adopted for a layer).** Split flood-share, wetlands clip, soils
  lookup and zoning shares into `fetch features` + `pure compute(features, parcel)` so bulk
  features can be fed to the same compute.
- **R7. `slope-raster.js`:** add `p50Pct` (median) beside `meanPct`/`p90Pct`/`maxPct`. Display
  only; `gradePct` (mean) stays the score input.
- **R8 (optional).** The same `node:vm` loading for `cost-tables.js` + `local-cost-model.js` if
  Explore shows a cost range.
- **Parity details to pin down:** the browser loads Turf from `@turf/turf@7` (unpinned minor,
  `public/index.html:90`); the batch must use the same Turf version (pin both). Browser fallbacks
  (`public/browser-fallback.js`) fetch some county layers from the user's browser when Cloudflare
  is blocked; the batch calls those hosts directly from the runner, which is the same data by a
  different route.

## 9. Approvals needed (owner)

- Step 2: create the D1 database `acresx-index` (`wrangler d1 create acresx-index`) and apply
  `migrations-index/0001_parcel_index.sql` to it.
- Step 2: a Cloudflare API token with D1 Edit as a GitHub secret (the pending
  `CLOUDFLARE_D1_TOKEN` would do), used only by the index workflow.
- Step 2: the new scheduled workflow (free on a public repo; nightly traffic to county, state
  and federal servers).
- Step 2: whether the job may read list prices from `acresx-mls` (read-only `SELECT`).
- Step 3: adding the `INDEX_DB` binding and `EXPLORE_ENABLED` var to `wrangler.jsonc` (a deploy).
- Step 4: an Anthropic API key as a Cloudflare secret (e.g. `ANTHROPIC_API_KEY`), and its spend.
- Any merge to `main` (each deploys).

## 10. Open questions for a reader

Each needs a quoted source; none of these is guessed above. Resolved on 2026-11-23 and moved
into the sections above (sources in `handoff/findings.md`, "Parcel index sources"): layer paging
and maxRecordCount, row counts, the Stevens and Spokane attribute layers, Kootenai and MT class
values, WA DOR codes, PAD-US Fee coverage, city-limits layers, D1 limits, the Actions job limit.

1. Kootenai codes whose meaning is unconfirmed: 548 "NREV" and 681 (exempt/public?), 667
   operating property (utility/rail?), 525 common areas.
2. Spokane `exmp_code` values GOVT, WATD, CEM: exact meanings (government, water district,
   cemetery?) from the assessor.
3. Measured time and request count per parcel for the in-process path on a **GitHub runner**
   (10 Spokane parcels), and whether any county host refuses or rate-limits GitHub runner IPs
   (timings so far are from a container).
4. Montana commercial land: `PropType` has no Commercial type (commercial is inside "Improved
   Property"). Is there another field or layer (e.g. the DOR property record class) that marks
   it, or is this accepted as a known gap?
5. MT parcels with null `PropType` (about 1,300 Yellowstone, 683 Gallatin): what are they?
6. Is there a state trust-land source newer than PAD-US 4.1 (last edited 2025-06-04) for WA DNR,
   IDL and MT DNRC lands?
7. MLS data: may the index job read `acresx-mls` (MLS Grid demo terms), and may a list price from
   the demo feed be shown in a search list?
8. Which Cloudflare plan the account is on (Free vs Workers Paid): decides whether the first build
   fits D1's write limits (section 5).
9. Yellowstone city-limits layer 30: do COUNTY rows with `ISLAND='Y'` mean county islands inside a
   city (outside city limits)?
10. Does a long, thin shape test still catch road/rail strips that carry no ROW code (MT has no
    road ROW type), and at what cutoff? Tune on samples in step 2.
