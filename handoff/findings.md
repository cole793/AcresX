# Findings

Verified facts, decisions and gotchas, each with its source. Newest first.

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
