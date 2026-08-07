# AcresX Worker Architecture

AcresX is being migrated from a monolithic Cloudflare Worker into small service and county modules while preserving the existing API contract.

## Target structure

```text
src/
  worker.js
  shared/
    http.js
  services/
    soils.js
    terrain.js
    parcels.js
    wells.js
    utilities.js
    listings.js
  counties/
    spokane.js
  zoning-counties.js
```

## Rules

1. `worker.js` owns routing and top-level error handling only.
2. `services/` owns reusable data-source integrations and analysis.
3. `counties/` owns county-specific GIS and permitting adapters.
4. County adapters return a normalized AcresX response shape so the front end does not need county-specific code.
5. API keys remain in Cloudflare Worker environment secrets.
6. Unverified listing claims never replace authoritative public-record data.
7. Refactors should preserve existing `/api/*` routes until a deliberate versioned API change is made.

## Migration order

1. Shared HTTP helpers.
2. Spokane zoning / permit adapter.
3. USDA soil service.
4. Terrain service.
5. Listing evidence service.
6. Hazard services.
7. ArcGIS parcel / well / utility proxy.
8. Buildability scoring.

Each migration should be independently deployable and should preserve the current response contract.
