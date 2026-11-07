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
| (none) | | | |

Merged 2026-11-02 to 11-04 (owner-approved, all deploys succeeded): #29 WA power provider via
HIFLD + wrong-state labels, #30 terrain/slope fallback across 3DEP getSamples/identify/EPQS,
#31 verifier on Sonnet, #32 Spokane city zoning from each city's layer, #33 Gallatin/Yellowstone
zoning fixes + MT validation configs, #36 WA validation tool + Spokane/Stevens/Kootenai expected
values, #37 county coverage levels from the 2026-11-03 runs.

Merged 2026-11-05 to 11-07 (owner-approved, all deploys succeeded): #41 Stevens assessor
(RealPropertyParcels_Public), #42 Stevens flood from the county's digitized FIRM, #43 Stevens
zoning adapter (city layers, LAMIRD/UGA).

## County report card (checklist score)

Kootenai 87, Yellowstone 80, Spokane 79, Gallatin 75 (all level 2, 2026-11-03); Stevens 78
(level 2, 2026-11-07).
Kootenai's first fully clean run was 2026-11-03T23:25Z; level 3 needs a second consecutive clean
daily run plus the owner comparing 2 parcels with the county site. All five counties are in the
daily validation run.

## Offered next (not approved)

- USDA soil (SDA) timed out on large parcels on 2026-11-03; give soil a fallback/longer window.
- Stevens: cite the UGA code section (the county site blocks automated fetches); zoning rules
  for Crossroads and Resort; owner sign-off.
- terrain: USGS still exceeds the 17 s budget at times (3/12 Stevens parcels on 2026-11-07); fix
  in progress.
- Spokane: assessor property class not read; statewide WA parcel lookup sometimes 5-25 s.
- Gallatin: zoning rules table. Yellowstone: thin rules for D16/EB_CW; Broadview town limits.
- Plain-language rules for city zones (CdA, Post Falls, Spokane cities).
- Browser fallback for MT DNRC parcels and Stevens.
- Draft a note to Kootenai County GIS about Cloudflare blocking (owner said "not yet").

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
