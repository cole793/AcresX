# AcresX v0.7 — Spokane County Intelligence Adapter

Deploy `index.html` with the site assets and replace the Cloudflare Worker entry file with `worker.js`.

## Added
- Direct Spokane County SCOUT zoning lookup (ZONECLASS / ZONEDESC)
- Comprehensive-plan designation
- Urban Growth Area intersection
- Permit-jurisdiction lookup
- Pending and issued permit features intersecting the parcel polygon
- Existing likely-permit checklist retained separately

## Important
- Keep the existing `zoning-counties.js` file in the Worker project because `worker.js` imports it.
- No additional API key is required for Spokane County GIS.
- County GIS results are screening information and should be verified with the responsible agency.
