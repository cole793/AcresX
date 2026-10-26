# Team handoff: current state

The lead (see `.claude/skills/team/SKILL.md`) keeps this file current. A new session reads it to
pick up where the last one stopped. Re-check SHAs and PR states with git before trusting them.

## Current state

- Merged: #3 (CLAUDE.md), #4 (agent team, tests, deploy gate).
- Production: `main`, deployed to Cloudflare by `.github/workflows/deploy-cloudflare.yml` on every
  push. As of Oct 2026, every push to `main` is first gated by `npm run check`.
- Coverage: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| `claude/pr-previews` | `4a108f8` | [cole793/AcresX#5](https://github.com/cole793/AcresX/pull/5) | Per-PR preview links. Preview run worked: https://pr-5-acresx.cole-groshens.workers.dev. Waiting on owner review. |

## Waiting on the owner

- Try the preview link on PR #5, then merge it.
- Upload the ChatGPT history export for project context.

## Approvals

None recorded yet. Each entry: date, the exact action approved.

## Next steps (offered, not approved)

- Delete `.github/workflows/restore-index.yml` (a one-off ChatGPT-era fix that overwrites
  `public/index.html`).
- Remove the Netlify GitHub app if Netlify isn't used.
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
