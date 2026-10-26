# Testing recipe

## Commands

| What | Command | Who | Time |
|---|---|---|---|
| Offline tests | `npm test` | anyone, while iterating | ~1 s |
| Build check | `npm run build-check` (`wrangler deploy --dry-run`) | verifier | ~10 s |
| Full gate | `npm run check` (both of the above) | verifier, CI | ~15 s |
| Local site | `npx wrangler dev` | manual checks | n/a |

Run `npm install` first (Node 20+).

## What the tests cover

`test/worker.test.js` imports the Worker (`src/index.js`) and calls it directly in Node, with
`globalThis.fetch` stubbed to fail. It checks:

- the homepage is served and every injected or referenced `public/*.js` file exists
- unknown API routes return JSON 404; unsupported parcel states return JSON 400
- every main `/api/*` route still answers with JSON when upstream data sources are down

They don't check live county/government data. Those servers are outside our control, and calling
them would make tests slow and flaky. Changes to data parsing should add tests with a recorded
sample response (save it under `test/fixtures/`) and a stubbed `fetch` that returns it.

## Live county validation

`scripts/validate-county.mjs` runs test parcels through the deployed API and reports per-layer
status per county. It needs internet access, so it runs in GitHub Actions
(`.github/workflows/county-validation.yml`), not in `npm test`. Each run commits its results to
the `validation-results` branch, so they can be read without Actions artifact access:
`git fetch origin validation-results && git show origin/validation-results:latest/kootenai.md`.
See `validation/README.md`.

## CI

- `.github/workflows/test.yml` runs `npm run check` on every pull request.
- `.github/workflows/deploy-cloudflare.yml` runs `npm run check` before `wrangler deploy`, so a
  failing gate blocks the deploy.
- `.github/workflows/preview.yml` uploads every PR as a Cloudflare Worker version (not a
  deployment) and comments its preview link on the PR, `https://pr-<number>-acresx.<subdomain>.workers.dev`.
  The link updates on every push to the PR.

## Preview links: what to know

- Previews run the PR's code with the **live** secrets and the **live** `MLS_DB` database. Don't
  run MLS syncs (`/api/reso-listings` with `sync: true`) or anything else that writes data from a
  preview.
- Cron triggers only run on the deployed (production) version, never on previews.
- Preview links are public, like the live site.
- `"preview_urls": true` in `wrangler.jsonc` turns preview URLs on for the Worker. It's applied
  by the production deploy.

## Expected skips / flaky tests

None.
