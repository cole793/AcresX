# Team handoff: current state

The lead (see `.claude/skills/team/SKILL.md`) keeps this file current. A new session reads it to
pick up where the last one stopped. Re-check SHAs and PR states with git before trusting them.

## Current state

- Merged: #3 (CLAUDE.md), #4 (agent team, tests, deploy gate), #5 (per-PR preview links), #6 (removed restore-index.yml, issue forms,
  level 1 merge policy), #7 (PRODUCT.md), #8 (county validation tool), #9 (results branch),
  #10 (discovery diagnostics), #11 (Kootenai missing-ZONING fix), #12 (approval buttons),
  #13 (flood reliability: FEMA retry, Esri official backup, cache; Kootenai flood 4/12 -> 12/12).
  All merged in chat on 2026-10-26; every deploy succeeded.
- 2026-10-26: Cloudflare Workers Builds (Git integration) disconnected by the owner. GitHub
  Actions is the only deploy path. PR #1 (Cloudflare autoconfig) closed unmerged.
- Production: `main`, deployed to Cloudflare by `.github/workflows/deploy-cloudflare.yml` on every
  push. As of Oct 2026, every push to `main` is first gated by `npm run check`.
- Coverage: Spokane (WA), Kootenai (ID), Gallatin and Yellowstone (MT).
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| (none) | | | |

## Approved queue (in order)

1. Flood labels and scoring (in progress, branch `claude/flood-zone-scoring`; also guards the flood helper, drops FEMA edge caching, fixes "AREA NOT INCLUDED" counted as high; proposes "not mapped" = amber 70, pending owner review): zone X minimal = good (~96); shaded X (0.2%) = moderate (~70); D = undetermined (~55); A/V = high (20). Needs ZONE_SUBTY passed through additively. Approved 2026-10-26.
2. Kootenai assessor data from `Assessor_Layers` (values; assessor class shown next to zoning, labeled as a tax category, not zoning). Approved 2026-10-26.
3. Batch terrain/slope/canopy elevation requests (USGS getSamples, one request) and cache. Approved 2026-10-26.

Not yet approved (offer): Kootenai parcel search from the county layer instead of the rate-limited statewide service; wetlands retry; wetlands label contradiction ("Mapped wetlands present" with 0.0% of parcel, seen on 015270010070).

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

## Next steps (offered, not approved)

- Remove the Netlify GitHub app if Netlify isn't used.
- Delete the leftover `cloudflare/workers-autoconfig` branch (from closed PR #1).
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
