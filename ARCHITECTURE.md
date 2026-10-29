# AcresX Worker Architecture

AcresX is migrating from a single Cloudflare Worker file to route-oriented services and county adapters.

## Current entrypoint

`src/index.js` is the Cloudflare Worker entrypoint.

It uses a transitional strangler pattern:

- `/api/land-analysis` runs through the modular land/soil services.
- Spokane County `/api/zoning-permits` runs through the dedicated Spokane adapter.
- `/api/hazards` with `kind: 'flood'` runs through `services/flood.js`, and `kind: 'wetlands'` through `services/wetlands.js`.
- All other existing routes are delegated to the legacy `src/worker.js` implementation.

This lets us migrate one route at a time without changing the public API contracts or forcing a full rewrite.

## Target structure

```text
src/
  index.js
  worker.js                 # legacy routes during migration
  zoning-counties.js
  counties/
    spokane.js
  services/
    elevation.js
    land-analysis.js
    slope-grid.js
    soils.js
    upstream-health.js
  shared/
    edge-cache.js
    http.js
    upstream.js
```

Future services should be extracted into `services/` and routed from `index.js`. County-specific official GIS integrations belong under `counties/`.

## Module responsibilities

### `shared/upstream.js`
The one way to call government map servers and other upstream sources (added 2026-10-28). `upstreamJson(url, opts)` fetches JSON; `arcgisQuery(layerUrl, params, opts)` returns the features of `<layer>/query` (`shared/arcgis.js` `arcgisQuery` is a thin wrapper over it that keeps a 1,800-char GET limit for parcel-polygon queries); `arcgisJson()` returns any ArcGIS answer; `upstreamFetch()` returns a buffered `Response` for older callers; `cachedJson()` caches validated answers only (Cache API via `edge-cache.js`). Every request:
- has a timeout that covers the wait for a host slot, the headers and the body;
- is never edge-cached with `cf` (ArcGIS sends errors as HTTP 200 bodies; `cf` options are dropped);
- counts against a cap of 4 in flight per host (per isolate, which includes every request the isolate serves; Workers has no request-scoped storage without the `nodejs_als` flag);
- writes one Workers Logs line per attempt: `{"evt":"upstream","host","label","status","ms","ok","attempt","err"}` (no query strings, bodies or headers).

`upstreamJson` retries once by default (short backoff) on timeout, network error, HTTP 5xx, invalid JSON, or an ArcGIS `{error}` whose code is not 4xx; an `{error}` in a 200 body is an error in ArcGIS mode. A GET over 3,500 characters becomes a form-encoded POST. Error messages follow the callers' old wording (`<agency> returned <status>`, the ArcGIS message or a per-caller fallback). Callers with a retry keep their old worst case by splitting the old timeout (e.g. 20 s became 12 s + 8 s).

Migrated: `services/` soils, existing-well, utility-territory, property-tax-test, land-analysis (canopy fallback); `utilities/osm-power.js`; `states/montana/{parcels,wells}.js`; `states/idaho/wells.js`; `states/idaho/parcels.js`; `counties/{spokane,yellowstone,gallatin,kootenai,kootenai-assessor,kootenai-cities,kootenai-parcels}.js`. `worker.js` and `services/{flood,wetlands,elevation}.js` use `shared/http.js` `fetchWithTimeout`, which is now built on `upstreamFetch` (same rules, one attempt). Not migrated: `services/reso-listings.js` (MLS provider and OAuth token).

Per-parcel caches (validated answers only): Kootenai assessor per PIN, found records, 7 days; Montana/Yellowstone parcel layer answers with features, 7 days; Spokane's five layer answers when all five answered, 1 day; Yellowstone zoning when every layer query succeeded, 1 day; Gallatin zoning per parcel center, 1 day.

### `services/upstream-health.js`
`GET /api/upstream-health`: one tiny read-only request per dependency host (ArcGIS `<server>/rest/info?f=json`, the 3DEP ImageServer metadata, one EPQS point, a one-row USDA SDA catalog query), in parallel, 10 s each, no retry. Answers `{ checkedAt, results: [{ host, name, ok, status, ms, error }] }` with `no-store`. Use it to see which servers Cloudflare cannot reach.

### `shared/http.js`
`json()` response helper, and `fetchWithTimeout()` kept for older callers (built on `shared/upstream.js`).

### `services/soils.js`
USDA NRCS Soil Data Access integration and soil-feasibility classification. The spatial lookup uses `SDA_Get_Mukey_from_intersection_with_WktWgs84` as a table-valued function.

### `shared/edge-cache.js`
`caches.default` helpers keyed by a SHA-256 of the parcel geometry rounded to 6 decimals. Each helper is a no-op where `caches` is undefined (Node tests), and cache errors never fail a lookup.

### `services/elevation.js`
Batched raster sampling. One ArcGIS ImageServer `getSamples` request (multipoint, form-encoded POST, `returnFirstValueOnly=true`, `interpolation=RSP_NearestNeighbor`) returns every point a lookup needs. It is used for USGS 3DEP elevation (meters, converted to feet) and USFS tree canopy. Samples are matched on `locationId`. A point missing from the answer is NoData (`null`). A failed request gets one retry (6 s, then 250 ms backoff, then 4 s). After two failures, callers use a capped per-point fallback: at most 9 EPQS points (one attempt, 4 s each). Nearest neighbour is used because it reproduces the old `identify`/EPQS values; bilinear differs by up to ~0.3 ft.

### `services/land-analysis.js`
Coordinates soil, USGS terrain and USFS tree-canopy screening while preserving the existing `/api/land-analysis` response shape. Terrain samples 9 points and canopy up to 36, one `getSamples` request each. The canopy fallback is at most 12 per-point `identify` calls. Terrain and canopy answers are cached separately in `caches.default` for 30 days. Only complete `getSamples` answers are cached, never failures, fallbacks or partial canopy. Upstream requests per call: 3 normally (soil + terrain + canopy), 27 at worst (soil now has one retry).

### `services/slope-grid.js`
`/api/slope-grid`: a 5 x 5 elevation grid (16 slope cells) from one `getSamples` request. If `getSamples` fails twice, it samples a coarser 3 x 3 grid from EPQS (4 cells, `partial: true`). Complete answers (`partial: false`) are cached for 30 days. Upstream requests per call: 1 normally, 11 at worst.

### `counties/spokane.js`
Spokane County official-source adapter for SCOUT zoning, comprehensive plan, UGA, permit jurisdiction, and permit-history screening.

### `services/flood.js`
FEMA flood-zone screening for `/api/hazards` (`kind: 'flood'`). Queries FEMA NFHL layer 28 and retries once on 5xx/timeout/network errors. A FEMA answer, including an empty one, is authoritative. If FEMA gives no answer, it falls back to Esri's official "USA Flood Hazard Areas" layer (`esri_landscapes`). That layer holds only high- and moderate-risk areas, so its answers carry `source.coverage: 'high-and-moderate-risk-only'`, and an empty Esri answer is flagged `source.emptyResult` and never cached. Long queries go as a form-encoded POST. Other answers are cached in `caches.default` for 7 days. The response shape matches the legacy handler (`available`, `intersects`, `high`, `zones`) plus `source`.

### `worker.js`
Legacy implementation retained temporarily so unmigrated routes continue to work. New feature logic should not be added here unless needed for an emergency production fix.

## Migration order

1. Spokane zoning/permits — routed through adapter.
2. Soil + terrain — routed through services.
3. Hazard screening — flood (`services/flood.js`) and wetlands (`services/wetlands.js`) routed through services.
4. Parcel/well/utility proxy.
5. Listing context.
6. Retire `worker.js` when no routes depend on it.

## Design rules

- Preserve existing `/api/*` request and response contracts during refactors.
- Prefer official county/state/federal GIS endpoints over scraping rendered pages.
- Keep county-specific field mappings inside county adapters.
- Listing claims remain unverified context and should not affect buildability scoring unless independently verified.
- Upstream failures should degrade a single data layer rather than blank the whole property analysis.
- Call upstream servers through `shared/upstream.js` (no raw `fetch`, no `cf` edge caching); cache only validated answers with `cachedJson()`.
