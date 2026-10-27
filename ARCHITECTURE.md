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
  shared/
    edge-cache.js
    http.js
```

Future services should be extracted into `services/` and routed from `index.js`. County-specific official GIS integrations belong under `counties/`.

## Module responsibilities

### `shared/http.js`
Shared response and timeout helpers. This should stay dependency-light so every service can use it.

### `services/soils.js`
USDA NRCS Soil Data Access integration and soil-feasibility classification. The spatial lookup uses `SDA_Get_Mukey_from_intersection_with_WktWgs84` as a table-valued function.

### `shared/edge-cache.js`
`caches.default` helpers keyed by a SHA-256 of the parcel geometry rounded to 6 decimals. Each helper is a no-op where `caches` is undefined (Node tests), and cache errors never fail a lookup.

### `services/elevation.js`
Batched raster sampling. One ArcGIS ImageServer `getSamples` request (multipoint, form-encoded POST, `returnFirstValueOnly=true`, `interpolation=RSP_NearestNeighbor`) returns every point a lookup needs. It is used for USGS 3DEP elevation (meters, converted to feet) and USFS tree canopy. Samples are matched on `locationId`. A point missing from the answer is NoData (`null`). A failed request gets one retry (6 s, then 250 ms backoff, then 4 s). After two failures, callers use a capped per-point fallback: at most 9 EPQS points (one attempt, 4 s each). Nearest neighbour is used because it reproduces the old `identify`/EPQS values; bilinear differs by up to ~0.3 ft.

### `services/land-analysis.js`
Coordinates soil, USGS terrain and USFS tree-canopy screening while preserving the existing `/api/land-analysis` response shape. Terrain samples 9 points and canopy up to 36, one `getSamples` request each. The canopy fallback is at most 12 per-point `identify` calls. Terrain and canopy answers are cached separately in `caches.default` for 30 days. Only complete `getSamples` answers are cached, never failures, fallbacks or partial canopy. Upstream requests per call: 3 normally (soil + terrain + canopy), 26 at worst.

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
