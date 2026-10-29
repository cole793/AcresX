# Findings

Verified facts, decisions and gotchas, each with its source. Newest first.

## 2026-10-28: Shared upstream client, per-host cap and /api/upstream-health

Owner-approved 2026-10-28 (backend cleanup step 2, branch `claude/shared-upstream-client`).

- **Edge caching of raw upstream answers is gone.** 14 files passed `cf: { cacheTtl,
  cacheEverything: true }`; ArcGIS servers return errors as HTTP 200 bodies, so the edge could
  keep an error as a success for up to 24 h. `src/shared/upstream.js` drops any `cf` option.
  Validated answers are cached with `cachedJson()` (Cache API) instead.
- **Slow bodies were unbounded.** The old `fetchWithTimeout` cleared its timer when headers
  arrived. The shared client's timeout covers the host-slot wait, headers and body.
- **Per-host cap (4 in flight).** One Kootenai search sent ~13 requests to map.kcgov.us, 7 of them
  at once (assessor layers). Hypothesis (not proven): county firewalls throttle Cloudflare; on
  2026-10-28 map.kcgov.us, gis.idwr.idaho.gov and gis.stevenscountywa.gov timed out (10-40 s)
  from the live site but answered in under 1.3 s from elsewhere. The assessor now sends at most 4
  layers at once, layers queued behind a hit are never sent, and found records are cached 7 days
  per PIN. The cap is per isolate (Workers has no request-scoped storage without `nodejs_als`).
- **Visibility.** Every attempt logs `{"evt":"upstream","host","label","status","ms","ok",
  "attempt","err"}` to Workers Logs (`observability` is on). `GET /api/upstream-health` probes 21
  targets (20 hosts) in parallel, 10 s each. From the builder sandbox on 2026-10-28 every target
  answered (0.5-1.1 s, whole probe 1.1 s). `elevation.nationalmap.gov/arcgis/rest/info`
  answered 502 while the 3DEP ImageServer worked, so that probe reads the ImageServer metadata.
- **Behaviour changes** (outputs for stubbed fixtures unchanged, `test/upstream-callers.test.js`):
  one retry on transient failures with the old timeout split (20 s -> 12 s + 8 s, 15 s -> 9 s +
  6 s); timeout and invalid-JSON error messages are now "<agency> timed out after Ns" /
  "<agency> returned invalid JSON" instead of the runtime's abort/SyntaxError text; long GETs
  (over 3,500 characters, e.g. Spokane permit polygons) go as form POSTs; the legacy wetlands
  `queryArcGIS` in `worker.js` had no timeout and now has 20 s; the Spokane existing-well
  assessor lookup treats an HTTP error with a non-JSON body as "no assessor record" (before, it
  threw); land-analysis worst case is 27 requests (soil retry), was 26.
- Not migrated: `src/counties/kootenai.js` and `src/states/idaho/parcels.js` (open PRs #21/#22;
  they still pass `cf` in source, dropped at runtime by `fetchWithTimeout`), and
  `src/services/reso-listings.js` (MLS provider/OAuth).

## 2026-10-27: Kootenai parcel search now uses the county parcel layer

Owner-approved 2026-10-27 (branch `claude/kootenai-parcel-search`). Checked live by the builder.

- `/api/parcel-search` for `ID` + `Kootenai` queries
  `map.kcgov.us/.../NewServices/Ownership_Display/MapServer/0` first
  (`where=PIN='<id>' OR PID='<id>'`, `outFields=PIN,PID,Acres,Loc_Addr,Loc_City`, `outSR=4326`,
  `f=json`, 10 s timeout). Adapter: `src/counties/kootenai-parcels.js`. It falls back to the
  statewide layer and then IDWR when the county layer errors or misses. Live: 13/13 parcels found
  (the 12 validation parcels plus 47N03W052200), ~190-920 ms, one request each.
- **The statewide layer has no Kootenai parcels.** `Public_Idaho_Parcels_/FeatureServer/7` holds
  381,144 parcels from 13 counties (Ada, Bear Lake, Boise, Camas, Gooding, Jerome, Lincoln,
  Minidoka, Nez Perce, Oneida, Teton, Valley, Washington), and 0 of the 13 Kootenai PINs. Before
  this change every Kootenai search sent it 3 queries that could never match (exact, dashed, prefix
  LIKE), then asked IDWR. Those wasted queries are what tripped "Too many requests". In the
  fallback chain they still run (as instructed), now with one retry on a rate limit.
- **The county outlines are the same as IDWR's.** For all 12 validation parcels, the county and
  IDWR outlines differ by under 0.0001 ac in area and under 0.1 mm in centroid. IDWR republishes
  the county geometry. So the county layer is not more accurate. Its gains are reliability,
  one request instead of four, the assessor `Acres`, the situs address and city, and the dashed PID.
- **Mapped area is not the assessor acreage.** 47N03W052200: outline 1.98 ac, assessor `Acres`
  2.888 (the "1.97 statewide" figure was IDWR's outline, which is the county outline). The
  48N03W312100 outline is 91.45 ac against 65.33 assessor acres. The response's `ACRES` is now
  the assessor figure; before, Kootenai answers had no `ACRES` and the report computed the area
  from the outline.
- The layer has no ZIP or assessor link field, so `SITUS_ZIP_NR` and `DATA_LINK` stay `''`
  (as from IDWR). Its `Name` field is the owner, and the adapter never requests it. Kootenai
  answers from the statewide/IDWR fallbacks have `OWNER*`, `PUBLIC_STD` and `MAIL_*` removed.
  Other Idaho counties still return the statewide owner and mailing fields (unchanged).
- `_source {name, url}` is added to Kootenai answers. Responses for other Idaho counties and
  Montana are byte-identical to 2d12331 (`test/fixtures/parcel-search-legacy-snapshot.json`).
- Owner decision 2026-10-27: **show both acreages.** `public/acreage.js` (`window.AcresXAcreage`)
  feeds the overview and the report's Parcel Size, e.g. "2.89 ac (assessor) · 1.98 ac mapped",
  and adds "Assessor and mapped acreage differ; verify with the county." when they differ by more
  than 10% of the assessor figure. Assessor acreage is `ACRES` (Idaho), then `ACREAGE`, Montana
  cadastral `TotalAcres`, then `Acres`. Mapped acreage is `turf.area` of the outline. The report's
  10-acre density warning uses assessor acres when present, else mapped. Spokane and Yellowstone
  answers carry no acreage field, so they still show mapped acreage only.
- **Listing evidence no longer feeds the score.** `renderSummary` (`public/index.html`) added
  +20 for a found listing and +10 for none into the "data confidence" factor (weight 0.08). The
  score now uses wells and utility only for that factor. The data-confidence dot and the listing
  card still show listing status. In a stubbed example, the score was 9.2 / 9.1 / 9.0
  (found / none / error) before the change and is 9.0 for all three now. The later
  `score-cost.js` and `screening-refinements.js` scores never used listings.
## 2026-10-27: Kootenai zoning inside cities, and by parcel area

Owner-approved 2026-10-27 (branch `claude/kootenai-city-zoning`). Sources checked live by the
lead and the builder on 2026-10-27.

- **City limits:** `map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18`
  ("City Limits", really tax code areas). `CITY` is set only inside a city ('Coeur d Alene',
  'Post Falls', 'Hayden', 'Rathdrum', 'Dalton Gardens', 'Hayden Lake', 'Athol', 'Spirit Lake',
  'Harrison', 'Worley', 'Fernan', 'Hauser Lake', 'Huetter', 'State Line'); `' '` or null outside.
- **City impact areas:** `Data_Layers/MapServer/17`, fields `CITY`, `ORDINANCE` (e.g.
  `ORA25-0013` CdA, `ORA25-0012` Hayden, `ORA25-0009` Post Falls, `ORA25-0018` Rathdrum; State
  Line spelled `STATELINE`). Land in an impact area but outside city limits keeps county zoning
  (Athol code: "the Kootenai County zoning ordinance shall be the zoning ordinance applicable to
  the land in the area of city impact which is outside the Athol city limits"; Hauser applies the
  same by its 1999 agreement). AcresX shows it as info only.
- **Coeur d'Alene zoning:** `gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8`,
  fields `ZONING`, `ZoningInfo` (HTML link to a zone PDF), `PUD`, `Notes`, `last_edited_date`.
  Gotcha: many `ZoningInfo` links name another zone's PDF (a `C-17` polygon links `R-17.pdf`,
  an `R-1` links `R-3.pdf`), so the adapter uses the link only when the file name matches
  `ZONING`, otherwise `https://www.cdaid.org/planning`.
- **Post Falls zoning:** `gis.postfalls.gov/server/rest/services/GIS2/LandUse/MapServer/5`,
  fields `ZONING`, `LAST_UPDATED`. Planning page `https://www.postfalls.gov/179/Planning`.
- **Other cities:** no live public zoning GIS (the old KCGIS consortium server
  `gis.postfallsidaho.org` is unreachable). Planning pages that loaded: Hayden
  `https://www.haydenid.gov/departments/planning_/index.php` (cityofhaydenid.us redirects
  there), Spirit Lake `https://www.spiritlakeid.gov/planningandzoning` (it also links an ArcGIS
  Online zoning web map, not used yet). Not linked: rathdrum.gov (bot check, could not verify),
  cityofhauser.org and haydenlake.org (parked domains), Athol, Dalton Gardens, Harrison, Worley,
  Fernan, Huetter, State Line (no reachable site found).
- **Center-point misses:** the county zoning layer 21 has gaps (e.g. 48N03W312100: about half
  the parcel is in no zone polygon, probably water; the layer 23 flood zone there is mostly AE),
  and the parcel's vertex-average center fell in a gap. Zoning is now read by parcel area: query
  with the parcel polygon (POST when the URL would be long), then sample about 200 grid points
  inside the parcel and count which polygon holds each (`src/shared/polygon-coverage.js`).
- Layer 21 `LABEL` holds the long name ('AGRICULTURE') and `ZONE_NAME` the short code ('AG');
  some rows disagree (e.g. `LABEL` 'AG-SUBURBAN' with `ZONE_NAME` 'HDRES' or 'RUR'). The adapter
  still uses `LABEL` first.

## 2026-10-27: Wetlands "present" with "0.0% of parcel" was a broken clip request, not a boundary touch

Owner-approved 2026-10-27 (branch `claude/wetlands-fixes`). Checked live by the builder from the
sandbox (Kootenai parcel layer geometry, USFWS NWI layer 0, Esri GeometryServer), not via the
AcresX site.

- **The NWI query was fine.** It sends the exact parcel polygon with `esriSpatialRelIntersects`
  (no envelope, no buffer). The features it returns really overlap both parcels.
- **The clip request always failed.** `src/services/wetlands.js` sent the GeometryServer
  `intersect` parameter `geometry` as a bare Esri polygon. The service answers HTTP 200 with
  `{"error":{"code":400,"message":"Unable to complete operation.","details":["Syntax error in JSON
  geometry representation"]}}` for every parcel. It needs `{"geometryType":"esriGeometryPolygon",
  "geometry":{"rings":...}}`. The code caught the error and returned `coveragePct: null,
  wetlandAcres: null, coverageMethod: 'NWI intersection presence only'` every time.
- **The page turned null into 0%.** `public/screening-refinements.js` `number(null)` is
  `Number(null)` = 0, so the score card showed "Mapped wetlands: 0.0% of parcel · 0.00 ac" and
  scored the factor as under 5% (90), next to the overview's "Mapped wetlands present". The
  validation tool's `round(null)` also printed `coveragePct: 0`.
- **Live numbers with the clip request fixed** (checked by hand with an independent 400x400 grid
  point-in-polygon estimate, which agreed to within 0.01 ac):

  | Parcel | Mapped parcel | NWI features | Overlap | Before (page) | After |
  |---|---|---|---|---|---|
  | 47N03W052200 | 1.98 ac | 3 Riverine (R4SBC, R5UBH x2) | 0.221 ac, 11.2% (0.208 + 0.013 + a 1 sq m sliver) | present + "0.0% · 0.00 ac", factor 90 | present, "11.2% of parcel · 0.22 ac", factor 80 |
  | 015270010070 | 9.99 ac | 1 Riverine (R4SBA) | 0.473 ac, 4.7% | present + "0.0% · 0.00 ac", factor 90 | present, "4.7% of parcel · 0.47 ac", factor 90 |

  Both parcels really do have mapped wetland on them. The label was right and the coverage was
  wrong. Five other validation parcels also measure as present (47N02W035500 70.5%,
  48N03W312100 64.5%, 49N03W324950 2.3%, 47N02W040800 3.4% on a 4-part MultiPolygon via POST)
  and 0L8210010030 as none.
- 47N03W052200's county `Acres` is 2.888, but its mapped polygon is 1.98 ac (two independent
  area methods agree). Coverage uses the mapped polygon.
- **New rule (wetlands `category`):** present = overlap >= 0.05 ac, or >= 0.5% of the parcel and
  >= 0.01 ac. Nearby = NWI polygon touches the parcel with less overlap than that (boundary
  slivers; NWI is mapped at about 1:24,000). None = no NWI polygon intersects. Unmeasured = the
  clip failed after a retry (amber, 55, never cached). Polygons near the parcel but not
  touching it are not queried. A buffered query (`distance`, which NWI layer 0 supports) would be
  a separate change.
- NWI layer 0 is ArcGIS 11.5, `maxRecordCount` 500, `supportsQueryWithDistance` true, and
  accepts POST queries. The GeometryServer accepts counter-clockwise (GeoJSON) parcel rings, but
  the service now sends Esri orientation anyway.

## 2026-10-27: terrain, slope grid and tree canopy now use batched getSamples

Owner-approved 2026-10-26 (branch `claude/batch-elevation`). Checked live by the builder on
2026-10-27.

- Cause of the Kootenai failures (validation run 40391761739: slope grid 11/12 timeouts, terrain
  4/12 "Too many subrequests"): one request per point, with up to 3 attempts x 2 sources. On a
  ~16 ac test parcel the old code made 74 upstream requests. `/api/land-analysis` took 20.9 s and
  `/api/slope-grid` took 46 s. EPQS often took 10-15 s per point or timed out.
- `3DEPElevation/ImageServer/getSamples` (multipoint, POST form-encoded) answers every point in
  one request. Verified live: `samples[].value` is a **string** in meters. Samples come back
  **out of request order**, so match on `locationId`. NoData points (e.g. ocean) are **left out**,
  not returned as a sentinel. At most **1000** samples per call: 2000 or 2500 points still return
  1000, silently. GET works for small batches; we always POST.
- `RSP_NearestNeighbor` equals the `identify` pixel value exactly, and EPQS (feet) to ~0.001 ft.
  `RSP_BilinearInterpolation` differs by up to ~0.3 ft. We use nearest neighbour.
- The USFS tree-canopy ImageServer (`imagery.geoplatform.gov/.../USFS_EDW_NLCD_TCC_CONUS`) also
  supports `getSamples` (maxRecordCount 1000, U8 values). Nearest neighbour equals `identify`
  exactly (82, 0 and 55 at the three centroids below).
- New code on the same parcel: 5 requests in total (one 3DEP request timed out at 6 s and the
  retry answered in 0.7 s). Land-analysis took 0.8 s and slope grid 7.0 s. Output keys and slope
  bands are unchanged. The largest numeric difference was 0.0015 ft (EPQS feet vs 3DEP meters x
  3.2808).
- Live getSamples timing (ms, 3 runs each) around the Kootenai centroids 47.430694,-116.844376 /
  47.905682,-116.770423 / 47.545631,-116.757814. 3DEP 25 points: 848/500/459, 754/922/394,
  1003/2418/556. 3DEP 9 points: 316/479/318, 1620/542/856, 308/317/525. Canopy 25 points:
  586/354/159, 663/285/166, 475/176/162. One cold call took 5.7 s.
- Request budget per call, before and after. Terrain: 9 to 54 before, 1 normally (2 with a retry,
  11 worst) after. Slope grid: 25 to 150 before, 1 (11 worst) after. Canopy: 36 before, 1 (14
  worst) after. Land-analysis route: 46 to 91 before (over Cloudflare's 50 cap), 3 normally and
  26 worst after.

## 2026-10-26: Kootenai assessment now comes from the county assessor layers

Owner-approved 2026-10-26 (branch `claude/kootenai-assessor`). Checked live by the builder.

- `/api/property-assessment` for `ID` + `Kootenai` now queries
  `map.kcgov.us/.../Assessor_Layers/MapServer` layers 5-11 in parallel
  (`where=PIN='<id>' OR PID='<id>'`, 13 named `outFields`, 10 s timeout each, first hit wins) and
  never calls the rate-limited statewide layer. Adapter: `src/counties/kootenai-assessor.js`.
  Live: 12/12 validation parcels found (was 0/12), each in exactly one layer, ~350-900 ms.
- **`find` works but was not used.** `MapServer/find?searchText=<PIN>&searchFields=PIN&layers=5,...,11`
  answers in one request (~780 ms), but it cannot limit fields: every answer carries all 52
  attributes, including owner names and mailing addresses. Query with `outFields` keeps that data
  out of the Worker. There is no `Assessor_Layers/FeatureServer` (HTTP 200 with error 500).
- All seven layers have the same 52 fields. Personal fields: `Owner_Primary`, `*Name_Primary`,
  `OwnSfx_Primary`, `LegalPartyType_Primary`, `Recipient_Primary`, `AttentionLine_Primary`,
  `DeliveryAddr_Primary`, `LastLine_Primary`, `City/State/PostalCd/Country_Primary`. None are
  requested or returned.
- **Net value is often far below land + improvements:** 0L8210010030 land $372,460, net $93,115;
  49N03W324950 land $154,534, net $5,660 (exemptions other than the homeowner one, probably
  ag/timber). The overview's "Assessor value" shows land + improvements (like the statewide
  `VAL_TOTAL` before); net taxable and the homeowner exemption appear in the source line.
- An upstream failure returns HTTP 200 `{available:false, countyRecords:[], error}` (only this
  layer degrades). The validation tool counts that as `error`; not found counts as `unavailable`.

## 2026-10-26: Flood zones are scored by category, not by "any zone intersects"

Owner-approved 2026-10-26 (branch `claude/flood-zone-scoring`).

- Before: any FEMA zone intersection showed "Mapped zone" (amber, 55/58) and no zone showed
  "Clear" (95/96). Unshaded zone X ("AREA OF MINIMAL FLOOD HAZARD"), the best outcome and most of
  Kootenai, was flagged; an unmapped parcel looked proven safe; FEMA's `AREA NOT INCLUDED`
  matched `/^(A|V)/` and counted as high risk.
- Now the worst intersecting zone sets the category, ranked by score (lowest wins; on the 70 tie
  a known hazard beats not mapped): high (SFHA / A* / V*) 20 > undetermined (D) 55 > moderate
  (shaded X, B) 70 > not mapped (no zone, `AREA NOT INCLUDED`, `OPEN WATER`) 70 > minimal
  (unshaded X, C) 96. An empty Esri-backup answer has `category: 'limited'`; limited and
  unavailable stay 50.
- `src/services/flood.js` adds `zoneDetails` and `category` (cache key `flood/v4/`) and no longer
  sends `cf` edge-cache options (ArcGIS errors arrive as HTTP 200 bodies). `public/flood-status.js`
  holds the labels and scores; every consumer still works if it has not loaded.
- Shaded X subtypes other than 0.2 PCT (levee, 1 PCT depth/drainage, future conditions) count as
  moderate. An Esri-backup X with no subtype counts as moderate, because that layer has no minimal X.

## 2026-10-26: Kootenai zoning vs Zillow "512", assessor source, Idaho parcel rate limit

- **Zillow's "Zoning: 512 - Res Rural" is not zoning.** Parcel 47N03W052200 (2.9 ac near St. Maries):
  county zoning is **AGRICULTURE** in both `NewServices/Data_Layers/MapServer/21` (ZONE_NAME `AG`,
  LABEL `AGRICULTURE`) and Community Development's `KCWEBMAP_CD/MapServer/1` (LABEL `AGRICULTURE`).
  "512" is the assessor's **property class**: `Assessor_Layers/MapServer/10` returns
  `property_class: '512'`, `Property_ClassDescr: '512- Rural residential tract'`. Zillow labels the
  assessor class as "Zoning". AcresX was correct.
- **Kootenai assessor source (fixes assessment 0/12):**
  `https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer` layers 5-10 "TaxParcels D1-D6"
  (by appraisal district) and 11 "TaxParcels Commercial". Fields include PIN, PID, AIN,
  property_class, Property_ClassDescr, AssessValue_Land, AssessValue_Imp, AssessValue_Net,
  HO_Exemption, AssessValue_Date, PclArea_Acres, TAG, neighborhood. Owner name/mailing fields exist
  too; don't display or store owner personal data unless the owner of AcresX decides to.
- **Kootenai parcel layer fields** (`Ownership_Display/MapServer/0`, 45 fields) include PIN, PID,
  Acres, Legal, Loc_Addr, Loc_City, Ex_Value, Net_Val, Gross_Val, KTCA, SCHOOL, FIRE, WATER, SEWER,
  FLOOD. There is no ZONING field (fixed in PR #11).
- **Idaho statewide parcel service rate-limits.** Preview validation run 40400939399: 6 of 12
  Kootenai parcels failed `/api/parcel-search` with "Unable to perform query. Too many requests."
  from `services1.arcgis.com/CNPdEkvnGl65jCX8/.../Public_Idaho_Parcels_/FeatureServer/7`. The county's
  own `Ownership_Display/MapServer/0` answered every query today and could be the primary source for
  Kootenai.

## 2026-10-26: False "no flood zone" answers came from the guessed Esri layer, not FEMA

Checked live by the lead with open internet on 2026-10-26. This corrects an earlier entry that
blamed FEMA empty answers, which was wrong.

- Preview run 40396618433 (PR #13): flood went from 4/12 to 11/12 OK. 3 parcels came back
  `{available:true, intersects:false, zones:[]}` where the earlier run had zones
  (015270010070: D; 49N03W324950: X). Those answers came from the guessed Esri fallback
  `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0`.
  That layer answers HTTP 200 but returns `features: []` at 015270010070 (47.430694, -116.844376),
  where FEMA says zone D. The timing fits: 8 s FEMA timeout + 0.5 s + 6 s retry + ~0.4 s Esri,
  about 14.9 s.
- The one "404" was the 65-acre parcel, most likely because the GET URL with the full parcel
  polygon was too long for ArcGIS Online.
- FEMA NFHL is flaky from everywhere, not just the Worker (from the lead's sandbox: one 25 s
  timeout, one TLS `SSL_ERROR_SYSCALL`). When it answers, it is correct: D at 015270010070, and
  X "AREA OF MINIMAL FLOOD HAZARD" at C72150030040.
- Esri's official layer is
  `https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0`
  (owner `esri_landscapes`, item "USA Flood Hazard Areas", last edit April 2026,
  maxRecordCount 2000). Its fields are FEMA's (`FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`,
  `esri_symbology`, ...). At 48N03W312100 (47.462958, -116.763586) it returns AE / `SFHA_TF` T,
  matching FEMA.
- That layer only holds high- and moderate-risk areas. Counts: AE 892,618; A 423,181; X 3,293,637,
  and every X subtype is 0.2-percent, levee or 1-percent. There is no "AREA OF MINIMAL FLOOD
  HAZARD", and D has only 114 features nationally. So an empty Esri answer means "not in a mapped
  high- or moderate-risk area", not "no flood zone", zone X-minimal or D.
- Design now (`src/services/flood.js`):
  - FEMA first, with one retry on errors. A FEMA answer is authoritative even when it is empty,
    so it is cacheable and has no flag.
  - The official Esri layer is used only if FEMA gives no answer. Its results carry
    `source.coverage: 'high-and-moderate-risk-only'`. An empty Esri answer is also flagged
    `source.emptyResult: true`, sent `no-store`, and never cached.
  - Queries whose GET URL would exceed 3,500 characters go as a form-encoded POST.
  - The cache key moved to `flood/v3/`. At most 3 requests, worst case 22.5 s.
- `scripts/validate-county.mjs` records flood `provider`, `coverage` and `emptyResult`. It shows
  "(via FEMA NFHL)" or "(via Esri USA Flood Hazard Areas, high/moderate-risk zones only)".

## 2026-10-26: FEMA NFHL flood queries fail intermittently from the Worker

- Kootenai validation run 40391761739 (`git show origin/validation-results:latest/kootenai.md`):
  `/api/hazards {kind:'flood'}` failed for 8 of 12 parcels. Most were `HTTP 502: Upstream service
  returned 525` (Cloudflare 525 = SSL handshake failure between the Worker and
  `hazards.fema.gov`), one was `timeout after 30s`. The other 4 succeeded, so it is intermittent.
- Flood now lives in `src/services/flood.js`: FEMA NFHL layer 28 (8 s timeout), one retry after
  500 ms on 5xx/timeout/network error (6 s), then Esri Living Atlas "USA Flood Hazard Areas"
  (8 s). Worst case is 22.5 s with at most 3 upstream requests. Successes are cached for 7 days in
  `caches.default`. If both sources fail, the route returns 502 with the usual unavailable shape.
- The Esri fallback URL (`ESRI_USA_FLOOD_HAZARD_LAYER` in `src/services/flood.js`) was written
  without internet access. It was the wrong layer (see the entry above).

## 2026-10-26: Kootenai parcel layer has no ZONING field

- The Kootenai parcel layer
  `https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0` has
  `PIN`, `Acres`, `Loc_City` and `Loc_Addr`, but no `ZONING` field. The layer-metadata probe
  reported "missing: ZONING" (not a case mismatch). Source: county validation run 40389472214,
  `git show origin/validation-results:latest/kootenai.md`.
- Every query whose `outFields` included `ZONING` failed with `ArcGIS error 400: Failed to
  execute query.` (all 8 sample queries, their retries, and distinct-zoning). Count queries
  without it succeeded (e.g. 59,495 parcels under 1 ac in city-named localities).
- The site adapter (`src/counties/kootenai.js`) also asked for `ZONING`, so its parcel lookup
  failed the same way. Zoning itself comes from the `Data_Layers/MapServer/21` point query.
  The parcel query no longer requests `ZONING`, and on an ArcGIS error it retries once with
  `PIN,Acres,Loc_Addr,Loc_City` matched on `PIN` only.
- `PID`, `Legal`, `Ex_Value`, `Net_Val`, `Gross_Val` and `TCA` are still unconfirmed on that
  layer. The next discovery run records the layer's full field list (`fieldNames`) to settle it.

## Oct 2026: project handoff from ChatGPT

- Most frontend modules are injected at request time by `maybeInjectUiPolish()` in
  `src/index.js:43`, not by `public/index.html`. A new `public/*.js` file must be added to that
  list to load.
- `src/index.js` handles new routes and falls back to the legacy `src/worker.js` router
  (`src/worker.js:464-476`) for anything else.
- The Worker modules import cleanly in Node 22, which is how the offline tests run.
- `.github/workflows/restore-index.yml` overwrote `public/index.html` from commit `bf6f4c4`. Deleted
  with the owner's approval on 2026-10-26.
- The repo contains no Netlify configuration. The Netlify checks on PRs come from a GitHub app
  installed on the account.
