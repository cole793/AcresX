# AcresX — project guide for Claude

AcresX is a rural land / parcel feasibility tool. A user enters a parcel number; the app pulls
official county/state/federal GIS data (parcels, zoning, permits, soils, slope, wetlands, hazards,
wells, power/utility territory, property tax, MLS listings) and produces a buildability screening
and property report. Coverage today: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).

This project was started in ChatGPT and moved to Claude Code in Oct 2026. `ARCHITECTURE.md` is the
source of truth for the backend migration plan. The `README*.md` files are old per-release notes
from the ChatGPT era ("replace these files and redeploy"). They describe history, not current
workflow.

## Stack and deploy

- One Cloudflare Worker (`wrangler.jsonc`, name `acresx`) serves both the API and static assets.
- `src/index.js` is the entrypoint. `public/` is the static asset directory (`run_worker_first: true`).
- D1 database `acresx-mls` (binding `MLS_DB`), schema in `migrations/`.
- Cron `17 * * * *` runs an incremental RESO/MLS listing sync (`scheduled()` in `src/index.js`).
- No build step, no framework. Plain ES modules on the Worker; plain scripts in the browser.
- **Deploy = push to `main`.** `.github/workflows/deploy-cloudflare.yml` runs `wrangler deploy`
  using the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Every merge to `main`
  ships to production, so do your work on branches and open PRs.
- Local dev: `npm install && npx wrangler dev`.

## Tests

- `npm test`: offline smoke tests in `test/` (Node 22, network stubbed). `npm run check`: tests
  plus `wrangler deploy --dry-run`. CI runs `npm run check` on every PR and before every deploy.
- Every PR gets a preview link (`.github/workflows/preview.yml`). Previews use live secrets and the
  live D1 database, so never trigger data writes from one.
- Tests must not call live county or government servers. Stub `globalThis.fetch`. Details are in
  `handoff/testing.md`.

## Agent team

Work runs through a small agent team adapted from the OpenRig rig-team kit:

- **lead**: the main session. Follows `.claude/skills/team/SKILL.md` (`/team`) and talks to the
  owner.
- **builder** (`.claude/agents/builder.md`): makes code changes on `claude/*` branches with tests.
- **verifier** (`.claude/agents/verifier.md`): checks each change at an exact SHA and reports
  counts.
- **reader** (`.claude/agents/reader.md`): researches data sources, with quoted sources.
- Deploys happen through GitHub Actions when the owner merges to `main`.

Team state lives in `handoff/` (`README.md` = current state and open work). Read it at the start
of a session and update it at the end. Merging to `main`, `wrangler deploy`, Cloudflare/D1
changes and deletions need the owner's explicit yes each time. The owner can approve a merge in
chat ("merge #12"); the lead then merges and reports the deploy (see `/team`, "Merging").

## Secrets (set in Cloudflare, never commit them)

`SERPER_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `RESO_CLIENT_ID`,
`RESO_CLIENT_SECRET`, `RESO_TOKEN_URL`, `RESO_SCOPE`, `RESO_PROPERTY_FIELDS`. The non-secret vars
are in `wrangler.jsonc` (`RESO_BASE_URL`, `RESO_PROVIDER`, `RESO_ORIGINATING_SYSTEM_NAME`).

## Backend layout (`src/`)

- `index.js`: router. It handles new routes directly and passes anything it doesn't know to the
  legacy `worker.js` (strangler pattern).
- `worker.js`: legacy routes (`/api/arcgis`, `/api/hazards`, `/api/listing-evidence`, …).
  Don't add features here. Extract them into `services/` and route them from `index.js`.
- `services/`: one module per data layer (soils, slope-grid, wetlands, power, utility territory,
  zoning rules, property tax, existing well, RESO listings, MLS evidence).
- `counties/`: official-source adapters per county. `zoning/`: county zoning rule tables.
- `states/{idaho,montana}/`: state parcel and well lookups. `utilities/`: power-provider lookups.
- `config/county-coverage.js`, `zoning-counties.js`: coverage and zoning profiles.
- `shared/http.js`: `json()` response and timeout helpers.

## Frontend layout (`public/`)

- `index.html` loads Leaflet, Turf, and a few scripts directly.
- **Most `public/*.js` files get injected at request time** by `maybeInjectUiPolish()` in
  `src/index.js`, which uses a hard-coded list. To add a new frontend module, add its name to that
  list (or add a `<script>` tag to `index.html`). Otherwise it never loads.
- These modules are layered "polish" scripts that patch the DOM after page load. Their load order
  matters, so check the injection list order when debugging UI conflicts.

## Rules

- Keep existing `/api/*` request and response shapes unchanged while refactoring.
- Prefer official GIS/REST endpoints over scraping.
- Keep county-specific field mappings inside the county adapters.
- Listing/MLS claims are unverified context and must not affect the buildability score.
- When an upstream source fails, degrade only that data layer. Never blank the whole report.
- Results are screening info. Keep the "verify with the responsible agency" framing in the UI.

## Work intake

Bugs and feature ideas live in GitHub Issues (`.github/ISSUE_TEMPLATE/`: Bug, Feature idea). When
working from an issue, link it in the PR ("Fixes #12") so merging closes it.
