# Team handoff: current state

The lead (see `.claude/skills/team/SKILL.md`) keeps this file current. A new session reads it to
pick up where the last one stopped. Re-check SHAs and PR states with git before trusting them.

## Current state

- Merged: #3 (CLAUDE.md), #4 (agent team, tests, deploy gate), #5 (per-PR preview links), #6 (removed restore-index.yml, issue forms,
  level 1 merge policy; merged in chat on 2026-10-26, deploy succeeded).
- Production: `main`, deployed to Cloudflare by `.github/workflows/deploy-cloudflare.yml` on every
  push. As of Oct 2026, every push to `main` is first gated by `npm run check`.
- Coverage: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| (none) | | | |

## Waiting on the owner

- Upload the ChatGPT history export for project context.
- Live domain names (realtor test site, landing page), for `PRODUCT.md`.

## Approvals

Each entry: date, the exact action approved.

- 2026-10-26: delete `.github/workflows/restore-index.yml`; add issue templates.
- 2026-10-26: merge policy is level 1. The owner approves each merge in chat and the lead merges
  it. This is standing policy, not approval for any particular PR.

## Next steps (offered, not approved)

- Remove the Netlify GitHub app if Netlify isn't used.
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
