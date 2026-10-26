# Findings

Verified facts, decisions and gotchas, each with its source. Newest first.

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
