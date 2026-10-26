# Findings

Verified facts, decisions and gotchas, each with its source. Newest first.

## 2026-10-26: FEMA NFHL sometimes answers 200 with no features; Esri fallback URL is wrong

- Preview validation run 40396618433 (PR #13 preview, `git show
  origin/validation-results:latest/kootenai.json`, compared with
  `history/2026-10-26/kootenai-40391761739.json`): flood went from 4/12 to 11/12 OK, all via FEMA.
  The retry fixed most of the 525s.
- 3 parcels came back `{available:true, intersects:false, zones:[]}` ("no mapped FEMA zone") where
  the earlier run had zones (015270010070: D; 49N03W324950: X). The query was identical, so FEMA
  returned 200 with an empty `features` array under load (those calls took about 7-15 s). A
  false "no flood zone" is worse than an error.
- Fix (`src/services/flood.js`): a 0-feature FEMA answer gets the one retry. If FEMA's final
  answer is still empty (or empty and then an error), the response keeps the no-intersection
  shape but adds `source.emptyResult: true`. It is sent with `Cache-Control: no-store` and never
  written to the 7-day cache. The cache key moved to `flood/v2/` so `v1` entries that may hold
  empty answers are dropped. Real no-zone parcels now always cost 2 FEMA requests.
- The Esri fallback URL `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0`
  returned HTTP 404 in the same run. The fallback is off (`ESRI_FALLBACK_ENABLED = false`) until
  a correct URL is found and verified in a preview run.
- `scripts/validate-county.mjs` now records flood `provider` and `emptyResult` in the layer values
  and shows "(via FEMA NFHL)" or "(FEMA NFHL returned empty; unconfirmed)" in the detail.

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
  without internet access. It returned 404 in the next preview run (see the entry above).

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
