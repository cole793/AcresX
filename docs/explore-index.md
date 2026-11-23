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

**Excluded** (counted per reason in `index_runs.excluded_json`, not stored per parcel):

| Reason | How it is detected | Status |
|---|---|---|
| `city_small` | inside city limits and acres < `INCLUDE_MIN_ACRES` | city-limits layers below |
| `condo` | WA DOR land use code 14 or 50 (`WA_LAND_USE_CODES`, `src/counties/stevens-assessor.js:86`); ID/MT: see open questions | partial |
| `commercial_industrial` | WA DOR codes 16, 21-39, 51-59, 61-66 (commercial/industrial/services; exact list to confirm); MT `PropType` commercial/industrial values; Kootenai `Property_ClassDescr` | partial |
| `right_of_way` | WA DOR codes 41-45 (rail, motor vehicle, highway/street ROW), 48 utilities; MT `PropType` "Centrally Assessed"; plus a shape test (long, thin: area / (perimeter^2) below a cutoff, to tune on samples) | needs tuning |
| `public_land` | PAD-US fee ownership (federal, state, tribal, local) covering most of the parcel; plus exempt status from the assessor (WA exemption codes in `spokane-assessor.js:99`, MT `PropType` "Exempt Property", ID exempt class) combined with WA DOR code 67 (governmental services) | needs reader check |
| `no_geometry` / `no_id` | missing outline or parcel number | mechanical |

Rules:
- **Acres** used for the rule are the same acres the report headlines (see the acres row in the
  data plan). A parcel near the cutoff keeps its decision for the run.
- **City limits** come from each county's city-limits layer (below). The parcel is "inside" when a
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
report. Owner and mailing fields are never requested (the adapters' field lists below already
exclude them).

| County | Live parcel source (code) | Bulk layer | City-limits layer (code) |
|---|---|---|---|
| Spokane WA | `src/counties/spokane-parcels.js:25` `SPOKANE_PARCEL_LAYER` (Assessor/Parcels MapServer/0, maxRecordCount 2000, 214,711 rows on 2026-11-10); statewide WA layer as fallback | same layer, fields `SPOKANE_PARCEL_FIELDS` (`:27`) | SCOUT/PermittingLookup/MapServer/0 "Jurisdictions" (`spokane-cities.js:5`, `SPOKANE_JURISDICTIONS`); NAME 'Spokane County' = unincorporated |
| Stevens WA | statewide WA `Current_Parcels` FeatureServer/0 (`public/index.html:92` `PARCEL_URL`, via `/api/arcgis`), `FIPS_NR='065'` (`validation/counties/stevens.json`) | same layer, `where FIPS_NR='065'` | Stevens_County_Zoning_Data/MapServer/0 "Cities" (`stevens-cities.js:5,9`); no polygon = unincorporated |
| Kootenai ID | `src/counties/kootenai-parcels.js:18` `KC_PARCEL_LAYER` (Ownership_Display MapServer/0, maxRecordCount 1000), IDWR/statewide as fallback (`src/states/idaho/parcels.js:6-7`) | same layer, fields `KC_PARCEL_SEARCH_FIELDS` (`:21`) | Data_Layers/MapServer/18 "City Limits" (really tax code areas; `kootenai-cities.js:3,14` `KC_CITY_LIMITS`) |
| Yellowstone MT | `src/states/montana/parcels.js:21` `MONTANA_CADASTRAL` (DNRC Cadastral FeatureServer/0), `COUNTYCD=3`; county TaxparcelOrion MapServer/1 (`:20`) | same layer, fields `MONTANA_CADASTRAL_FIELDS` (`:10`) | Yellowstone/MapServer/30 "City Limits" (`yellowstone-utilities.js:32`) |
| Gallatin MT | same DNRC Cadastral layer, `COUNTYCD=6` | same layer | Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267 (`gallatin.js:28`) |

Paging: every layer above is ArcGIS REST. Hosted FeatureServers (WA statewide, DNRC Cadastral,
Gallatin cities) normally support `resultOffset`/`resultRecordCount`; MapServers (Spokane
Assessor/Parcels, Kootenai Ownership_Display) support it only when the service reports
`advancedQueryCapabilities.supportsPagination`. Where paging is not supported the job pages by
`OBJECTID` ranges (`where OBJECTID > last ORDER BY OBJECTID`, or `returnIdsOnly` then batches of
ids), which every ArcGIS layer supports. Which method each layer needs is an open question (Q1).

Pull plan per county: (1) `returnCountOnly` with the county where clause, (2) page ids, (3) fetch
attributes + outlines in pages of at most the layer's maxRecordCount, polite delay between pages
(the validation discovery uses 300 ms, `validation/counties/*.json` `delayMs`), (4) intersect with
the city-limits layer (one bulk download of the city polygons, then a local point-in-polygon/area
test with the same majority rule), (5) apply the rule.

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
| `assessed_land`, `assessed_improvements`, `assessed_total`, `assessment_year`, `property_class` | `/api/property-assessment` (`src/counties/*-assessor.js`, `src/states/montana/assessment.js`) | in-process, or from the bulk pull where the parcel layer carries values (MT Cadastral `TotalLandValue`, `TotalBuildingValue`, `PropType`) | assessor layers paged in bulk (WA/ID) |
| `tax_total`, `tax_year`, `tax_basis` | `/api/property-tax` `src/services/property-tax.js` (treasurer pages; Kootenai estimate from `kootenai-levy-2026.js`) | **not in the first runs**: these are web pages, not GIS layers; tens of thousands of page loads per county would be impolite and may trip bot checks. Kootenai's estimate is computed locally and can be filled. Others NULL with `tax` flagged `not_checked`; Explore links to the report for the bill | n/a |
| `improved` | see inclusion rule | bulk pull / assessment | n/a |
| `score`, `score_band`, `score_rating`, `score_factors_measured`, `score_provisional`, `score_factors_json`, `score_why` | browser only: `AcresXScore.calculate` `public/screening-refinements.js:226` (factors `:64`, missing inputs `:141`, buildable cap `:31`); terrain `AcresXTerrain` `screening-inputs.js:343`; flood `AcresXFlood` `flood-status.js:224,233`; wetlands `AcresXWetlands` `wetlands-status.js:105` | shared score core (R1-R3) run on a `last`-shaped object the batch assembles | n/a |
| `score_version` | does not exist today | new `SCORE_RULES_VERSION` (R2) | n/a |
| `cost_low`, `cost_central`, `cost_high` (optional) | `AcresXCostModel.estimate(last)` `public/local-cost-model.js:874`, prices `public/cost-tables.js:448` | same scripts (R8); not needed for step 2 | n/a |
| `list_price`, `listing_status`, `listing_key` | MLS demo data in `MLS_DB` (`/api/reso-listings`) | copied by the job with a read-only `SELECT` from `acresx-mls` (Q9). Filter and display only; never a score input | n/a |
| source timestamps | per answer (`checkedAt`, `asOf`, cache versions) | `parcel_layers.fetched_at`, `source_version` per parcel and layer | bulk file vintage in `source_version` |

### What is feasible in a GitHub Actions run

- Per parcel, the in-process path makes about 12-20 upstream requests (parcel already in hand;
  wells 1-3, zoning 2-6, flood 1-2, wetlands 1-2, land 2-3, slope tiles 1-9, buildable 0-2,
  utility 1, power 2-4, public utilities 2-4, zoning rules 0). At 4 parcels in flight and the
  shared 4-per-host cap (`shared/upstream.js`), a rough 2-4 s per parcel gives 3,600-7,200
  parcels per hour per job. This is an estimate to measure in step 2 (Q7).
- Actions limits (GitHub-hosted runners, to confirm, Q8): 6 h per job, 72 h per workflow run,
  matrix jobs in parallel, monthly minutes quota on private repos. A county is split into shards
  (`parcel_id` hash mod N) so each job stays well under 6 h and a failed shard is retried alone.
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
  never touches `MLS_DB` except an optional read-only `SELECT` for list prices (Q9).
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
- **D1 limits to design for** (from Cloudflare's published limits as last known; the docs site was
  not reachable from this session, so a reader confirms them, Q8): database size 10 GB on Workers
  Paid, 500 MB on Free; about 100 bound parameters per statement; 100 KB per SQL statement; rows
  written are billed and each index on a written column adds a written row; Free plan has a daily
  rows-written cap of the order of 100,000. Sizing: one `parcels` row is about 1 KB; 100,000
  included parcels is about 100 MB plus indexes, and `parcel_inputs` (the raw `last` JSON, about
  20-60 KB each) would be 2-6 GB: too much for Free and heavy for Paid. So `parcel_inputs` is
  optional and stores a trimmed input set (only what the score core reads, about 2-5 KB); the full
  answers stay as Actions artifacts for a few days for debugging. On a Free plan the first build
  (rows x (1 + indexes) writes) would take many days; Workers Paid is assumed (Q10).
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
- Step 2: the new scheduled workflow (GitHub Actions minutes; nightly traffic to county, state
  and federal servers).
- Step 2: whether the job may read list prices from `acresx-mls` (read-only `SELECT`).
- Step 3: adding the `INDEX_DB` binding and `EXPLORE_ENABLED` var to `wrangler.jsonc` (a deploy).
- Step 4: an Anthropic API key as a Cloudflare secret (e.g. `ANTHROPIC_API_KEY`), and its spend.
- Any merge to `main` (each deploys).

## 10. Open questions for a reader

Each needs a quoted source; none of these is guessed above.

1. Paging support for each bulk layer: does `?f=json` on Spokane Assessor/Parcels MapServer/0,
   Kootenai Ownership_Display MapServer/0, WA statewide Current_Parcels FeatureServer/0 and DNRC
   Cadastral FeatureServer/0 report `supportsPagination`, and what is each maxRecordCount?
2. Row counts per county with the county where clause (`returnCountOnly`), and how many pass
   "acres >= 1" (where the layer has an acres field), to size the index and the first build.
3. Stevens: the statewide WA layer has no property class. Which Stevens layer gives the WA DOR
   land use code in bulk (`RealPropertyParcels_Public/MapServer/0`, `stevens-assessor.js:38`)?
   Same for Spokane (`LandCapacityAnalysis/MapServer/0` `prop_use_code`?).
4. Kootenai: which assessor field marks condos, commercial/industrial, exempt/public property
   (`Property_ClassDescr` values in `Assessor_Layers/MapServer`, `kootenai-assessor.js:23`)?
5. Montana: the full list of `PropType` values on DNRC Cadastral for COUNTYCD 3 and 6, and which
   mean condo, commercial, industrial, exempt, centrally assessed.
6. Public land: is PAD-US (the layer `src/services/padus-easements.js` already queries) the right
   bulk source for federal/state/tribal/county fee ownership in these counties, and is there a
   state source that is more current (WA DNR, IDL, MT DNRC trust lands)?
7. Measured time and request count per parcel for the in-process path on a GitHub runner
   (10 Spokane parcels), and whether any county host refuses or rate-limits GitHub runner IPs.
8. Current limits: Cloudflare D1 (database size, rows written per day/month on Free and Paid,
   whether index updates count as extra rows written, statement size, bound parameters) and
   GitHub Actions (job and workflow time limits, minutes on this repo's plan). The Cloudflare docs
   host was not reachable from this session.
9. MLS data: may the index job read `acresx-mls` (MLS Grid demo terms), and is a list price from
   the demo feed allowed to be shown in a search list?
10. Which Cloudflare plan the account is on (Free vs Workers Paid): decides whether the first
    build fits D1's write limits.
11. Right-of-way detection: which WA DOR codes and MT/ID classes reliably mark road, rail and
    utility strips, and is a shape test still needed?
12. Kootenai "City Limits" layer 18 is tax code areas: does a CITY value always mean inside
    incorporated limits (e.g. impact areas, layer 17)?
