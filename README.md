# AcresX v0.5.1 — Cloudflare data fix

This release is structured for Cloudflare Workers with static assets.

## Fixes
- Cloudflare `/api/hazards` route replaces the Netlify FEMA/NWI function.
- Well search continues until at least five records are found, so the map and average use the same five-well set.
- Cloudflare `/api/zoning-permits` attempts a live public ArcGIS zoning-layer match and returns the mapped zoning value when a reliable intersecting feature is found.
- Existing listing-evidence logic is available at `/api/listing-evidence` when Cloudflare secrets are configured.

## Cloudflare build settings
- Build command: `npm install`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

Upload the contents of this folder to the root of the GitHub repository.
