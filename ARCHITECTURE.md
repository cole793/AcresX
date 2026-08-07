# AcresX Worker Architecture

AcresX is migrating from a single Cloudflare Worker file to route-oriented services and county adapters.

## Current entrypoint

`src/index.js` is the Cloudflare Worker entrypoint.

It uses a transitional strangler pattern:

- `/api/land-analysis` runs through the modular land/soil services.
- Spokane County `/api/zoning-permits` runs through the dedicated Spokane adapter.
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
    land-analysis.js
    soils.js
  shared/
    http.js
```

Future services should be extracted into `services/` and routed from `index.js`. County-specific official GIS integrations belong under `counties/`.

## Module responsibilities

### `shared/http.js`
Shared response and timeout helpers. This should stay dependency-light so every service can use it.

### `services/soils.js`
USDA NRCS Soil Data Access integration and soil-feasibility classification. The spatial lookup uses `SDA_Get_Mukey_from_intersection_with_WktWgs84` as a table-valued function.

### `services/land-analysis.js`
Coordinates soil and USGS terrain screening while preserving the existing `/api/land-analysis` response shape.

### `counties/spokane.js`
Spokane County official-source adapter for SCOUT zoning, comprehensive plan, UGA, permit jurisdiction, and permit-history screening.

### `worker.js`
Legacy implementation retained temporarily so unmigrated routes continue to work. New feature logic should not be added here unless needed for an emergency production fix.

## Migration order

1. Spokane zoning/permits — routed through adapter.
2. Soil + terrain — routed through services.
3. Hazard screening.
4. Parcel/well/utility proxy.
5. Listing context.
6. Retire `worker.js` when no routes depend on it.

## Design rules

- Preserve existing `/api/*` request and response contracts during refactors.
- Prefer official county/state/federal GIS endpoints over scraping rendered pages.
- Keep county-specific field mappings inside county adapters.
- Listing claims remain unverified context and should not affect buildability scoring unless independently verified.
- Upstream failures should degrade a single data layer rather than blank the whole property analysis.
