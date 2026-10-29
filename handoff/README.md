# Team handoff: current state

The lead (see `.claude/skills/team/SKILL.md`) keeps this file current. A new session reads it to
pick up where the last one stopped. Re-check SHAs and PR states with git before trusting them.

## Current state

- Merged: #3 (CLAUDE.md), #4 (agent team, tests, deploy gate), #5 (per-PR preview links), #6 (removed restore-index.yml, issue forms,
  level 1 merge policy), #7 (PRODUCT.md), #8 (county validation tool), #9 (results branch),
  #10 (discovery diagnostics), #11 (Kootenai missing-ZONING fix), #12 (approval buttons),
  #13 (flood reliability: FEMA retry, Esri official backup, cache; Kootenai flood 4/12 -> 12/12).
  All merged in chat on 2026-10-26; every deploy succeeded.
- Also merged: #14 (team notes), #15 (flood labels/scoring), #16 (Kootenai assessor values),
  #17 (batched elevation), #18 (daily validation + issue alerts), #19 (county checklist),
  #20 (wetlands fixes), #21 (Kootenai city zoning, merged 2026-10-29 after the outage cleared),
  #22 (Kootenai parcel search from the county layer + "show both" acreage, 2026-10-29).
  Deploys for #21 and #22 succeeded; live spot-checks passed (C72150030040 = Coeur d'Alene R-12).
- 2026-10-28/29 outage: Kootenai, IDWR, Stevens and MT DNRC servers blocked or timed out
  Cloudflare for about a day; all answered again on 2026-10-29 12:20 UTC. FEMA's main flood
  server still returns 403 to Cloudflare (the Esri backup covers it).
- 2026-10-26: Cloudflare Workers Builds (Git integration) disconnected by the owner. GitHub
  Actions is the only deploy path. PR #1 (Cloudflare autoconfig) closed unmerged.
- Production: `main`, deployed to Cloudflare by `.github/workflows/deploy-cloudflare.yml` on every
  push. As of Oct 2026, every push to `main` is first gated by `npm run check`.
- Coverage: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| `claude/shared-upstream-client` | b4f9c5a (being updated) | #23 | Builder merging main and moving the #21/#22 Kootenai code onto the shared client; then verifier |
| `claude/progressive-loading` | 4853360 (being updated) | not yet | Builder merging main (conflict in `test/ui-harness.js`); then verifier, then PR |
| `claude/browser-fallback` | none yet | none | Owner chose option A (2026-10-28). Starts after #23 is updated, based on it |

## Up next (owner-requested, 2026-10-28 backend audit, "Start 1 and 2")

1. Progressive loading with per-section time limits (branch above).
2. Shared upstream client, fewer county requests, `/api/upstream-health` (#23).
3. Browser fallback for government servers that block Cloudflare (option A), wired into
   progressive loading.
- Stevens County, WA scored 33/100 on the checklist (2026-10-28). No Stevens work approved yet.

## Waiting on the owner

- Upload the ChatGPT history export for project context.
- Note: the session network is now open (owner allowed all domains on 2026-10-26).
- Live domain names (realtor test site, landing page), for `PRODUCT.md`.

## Approvals

Each entry: date, the exact action approved.

- 2026-10-26: delete `.github/workflows/restore-index.yml`; add issue templates.
- 2026-10-26: owner allowed all network domains for the cloud environment.
- 2026-10-26: approvals are asked with Approve / Not now buttons (AskUserQuestion).
- 2026-10-26: merge policy is level 1. The owner approves each merge in chat and the lead merges
  it. This is standing policy, not approval for any particular PR.

- 2026-10-26 to 10-28: merges #13-#20, each approved with its button.
- 2026-10-28: #21 and #22 approved, held until Kootenai answered again ("Wait & monitor"); merged
  2026-10-29. "Not yet" on contacting the county.
- 2026-10-28: "Start 1 and 2" from the backend audit; browser fallback option A; keep the
  power-provider score change (Avista-territory parcels about +0.1).

## Next steps (offered, not approved)

- Remove the Netlify GitHub app if Netlify isn't used.
- Delete the leftover `cloudflare/workers-autoconfig` branch (from closed PR #1).
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
