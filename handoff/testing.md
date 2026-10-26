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

## CI

- `.github/workflows/test.yml` runs `npm run check` on every pull request.
- `.github/workflows/deploy-cloudflare.yml` runs `npm run check` before `wrangler deploy`, so a
  failing gate blocks the deploy.

## Expected skips / flaky tests

None.
