# Team handoff: current state

The lead (see `.claude/skills/team/SKILL.md`) keeps this file current. A new session reads it to
pick up where the last one stopped. Re-check SHAs and PR states with git before trusting them.

## Current state

- Production: `main`, deployed to Cloudflare by `.github/workflows/deploy-cloudflare.yml` on every
  push. As of Oct 2026, every push to `main` is first gated by `npm run check`.
- Coverage: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| `claude/agent-team` | `602ec38` | [cole793/AcresX#4](https://github.com/cole793/AcresX/pull/4) | Agent team setup and smoke tests. Waiting on owner review. |

## Waiting on the owner

- Review and merge the agent-team PR.

## Approvals

None recorded yet. Each entry: date, the exact action approved.

## Next steps (offered, not approved)

- Delete `.github/workflows/restore-index.yml` (a one-off ChatGPT-era fix that overwrites
  `public/index.html`).
- Remove the Netlify GitHub app if Netlify isn't used.
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
