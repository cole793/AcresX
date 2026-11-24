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
- Coverage: Spokane and Stevens (WA), Kootenai (ID), Gallatin and Yellowstone (MT). All five
  are level 3 (Gallatin since #101).
- Accounts (#75) are merged but OFF: `/api/me` answers `enabled:false` until the D1 tables exist
  and `RESEND_API_KEY` is set (see "Waiting on the owner").
- Tests: offline smoke tests in `test/` (see `testing.md`).

## Strategy (owner, 2026-11-23)

"Nationwide coverage (eventually)", then compare properties and AI insights ("most buildable
5-10 ac lots in Spokane County", "allows a manufactured home"). No new features except realtor
feedback until expansion and AI search are underway. Plan:
- **Phase 1 (current): Explore.** Pre-score rural-relevant parcels of the 5 counties into the
  separate D1 database `acresx-index`, refreshed by a GitHub Actions job. Then a hidden `/explore`
  page with filters, then "Ask AcresX" (Claude translates a question into a strict
  `search_parcels` tool call over the index; only returned rows are summarized), then compare.
  Design: `docs/explore-index.md`. Kept separate: own page (not in the injection list), own
  routes `/api/explore/*`, own DB, `EXPLORE_ENABLED` flag, batch job off the Worker.
- **Phase 2:** nationwide parcel vendor (Regrid or similar; quotes needed, nothing bought) for
  "Limited coverage" reports anywhere.
- **Phase 3:** state-by-state depth, a zoning data vendor, PostGIS when past a few states.

## Open work

| Branch | SHA | PR | Status |
|---|---|---|---|
| `claude/index-pipeline-spokane` | 12c3b05 | not opened | Phase 1 step 2A: `pipeline/` batch job scoring Spokane into local SQLite. Verifier PASS (1424/1424 twice, dry-run 848.77 KiB, fresh 5-parcel live parity 5/5). Live sample 30 parcels: median 8.0 s and ~49 requests per parcel (~23 to gismo.spokanecounty.org), ~664 parcels/h at concurrency 4; ~60k Spokane parcels qualify, so ~90 h and ~1.4M county requests for a full build. **Do not run a full load yet** (see decisions below). |

### Explore: owner decisions still open (asked 2026-11-24, not answered)

1. Build a **local data store** first (weekly bulk download of county-wide layers: zoning,
   permits, city limits, flood, wetlands, soils, well logs, OSM power, roads, shared terrain
   tiles; parcels checked locally; nightly live parity sample). Lead recommends yes: cuts ~1.4M
   county requests to a few thousand and is the base for nationwide coverage.
2. Token savings: builder on Sonnet for routine work, capped agent reports, no second verifier
   pass on doc-only PRs, a fresh session per milestone. Lead recommends yes.
3. Floor for vacant rural lots (slivers down to 0.03 ac get in today): 0.25 ac recommended.
4. Fix the live-report bug: `findWells` in `public/index.html` fails on every MultiPolygon parcel
   (`turf.polygonToLine` returns a FeatureCollection), so water shows "not checked" (3/30 sample
   parcels, all large). The pipeline copies this behaviour for parity; fix both together.

### Explore: next steps after those answers

- (If 1 = yes) builder: local data store, then re-measure requests and time per parcel.
- Database setup PR: `INDEX_DB` binding in `wrangler.jsonc` (database `acresx-index`, id
  `fc0bf7b8-82cd-469c-b2f0-172f74d4424b`, `migrations_dir: "migrations-index"`), a migration
  workflow using the `CLOUDFLARE_D1_TOKEN` secret, the nightly/sharded index workflow writing to
  D1, and the "Apply D1 migrations" workflow for accounts switched to the same secret. The
  secret's existence can't be checked from a cloud session (Actions secrets API is blocked by
  the proxy); the first workflow run confirms it.
- First Spokane load, then a 50-parcel check against live reports; then the other 4 counties.
- Refactors still pending from the design: R4 (shared request builders; `pipeline/report-inputs.mjs`
  is a marked copy with drift tests), R5 (`src/zoning/use-flags.js`), R7 (`p50Pct`), pin Turf on
  the page (pipeline pins 7.4.0).
- Offered, not done: the third inline score formula in `index.html` `renderSummary`; the two
  near-duplicate generic cost models; WA codes 68, 69, 71-79 not excluded yet.

Merged 2026-11-02 to 11-04 (owner-approved, all deploys succeeded): #29 WA power provider via
HIFLD + wrong-state labels, #30 terrain/slope fallback across 3DEP getSamples/identify/EPQS,
#31 verifier on Sonnet, #32 Spokane city zoning from each city's layer, #33 Gallatin/Yellowstone
zoning fixes + MT validation configs, #36 WA validation tool + Spokane/Stevens/Kootenai expected
values, #37 county coverage levels from the 2026-11-03 runs.

Merged 2026-11-05 to 11-07 (owner-approved, all deploys succeeded): #41 Stevens assessor
(RealPropertyParcels_Public), #42 Stevens flood from the county's digitized FIRM, #43 Stevens
zoning adapter (city layers, LAMIRD/UGA).

Merged 2026-11-09 to 11-11 (owner-approved, all deploys succeeded): #46, #48, #49, #50, #51,
#52.

Merged 2026-11-12 to 11-13 (owner-approved, all deploys succeeded): #53 validation results
publish resilience, #54 Kootenai + Yellowstone to level 3, #55 local Spokane/Kootenai
development-cost model, #56 Spokane Valley backup zoning source.

Merged 2026-11-13 to 11-16 (each owner-approved; every deploy succeeded): #57-#59 Stevens level 3,
cost file cleanup, LinkedIn revert; #60 report redesign (4 pages, dashboard cost card); #61 FEMA
flood share; #62 Montana local costs; #63 buildable acres; #64 flood share in production (FEMA
403s requests without a User-Agent; Esri fallback); #65 Spokane level 3; #66 coverage badge,
grouped county lists, honest chips, existing-structure note; #67 consistency (one well depth,
flood-share/buildable-aware score, septic uses measured slope); #68 power line distance (HIFLD
transmission, Flathead Electric layers, osm-power browser fallback); #69 phone layout, overview
card, listing card; #70 address + map-click search; #71 OSM distance guard (<=1,000 ft only);
#72 report co-branding + Settings; #73 missing layers excluded from the score (Incomplete /
Provisional); #74 property tax (treasurer pages; Kootenai levy estimate); #75 accounts (email
magic link, D1 migration 0002, share links; OFF until setup); #76 "likely" utilities priced as
well+septic, Yellowstone city limits from MapServer/30, MT permits by city limits; #77 in-page
report view (no prompt/popup); #78 iOS text-size-adjust + no clipped pages; #79 Download PDF
(self-hosted html2canvas 1.4.1 + jsPDF 4.2.1); #80 iPhone Home Screen app: Open in Safari +
deep links (`?state=&county=&parcel=&report=1`).

Merged 2026-11-17 to 11-18 (each approved with its own button; every deploy succeeded): #81
handoff notes; #87 (draft) closed, replaced by #88 calm report layout (6 pages; page 1 is the
summary; "More findings" on page 2); #89 soil backup (Esri Living Atlas USA Soils Map Units when
USDA SDA is down); #90 Montana road centerlines (Yellowstone MapServer/40, Gallatin ArcGIS Online
Streets; ownership 'unknown' shows "Road status not mapped"); #91 cleanups (soil backup label,
30-day SDA cache, tax link allowlist, tax validated in Spokane and Stevens); #92 Gallatin zoning
rules (67 zones across 22 districts); #93 slope raster (Terrarium tiles, Horn slope, >30% slope
removed, gradual terrain score with anchors 0-5% -> 96, 10% -> 82, 15% -> 62, 25% -> 35; septic
graded on the gentlest clear ~1 ac homesite; `homesiteStatus`); #94 terrain-aware well depth
(+/-50 ft = comparable, >100 ft lower = drainage, deep-well rules; well addresses and owner names
never displayed); #95 interior homesite point, fewer than 3 comparable wells -> one deep upland
well sets the range top, versioned cache key `WELL_TERRAIN_RULES_VERSION` (bump it on any rule
change: previews share the Cache API with production); #96 recorded restrictions (plats, COS,
subdivisions, Spokane development agreements, PAD-US + MSL conservation easements, recorder
links).

Merged 2026-11-19 to 11-24 (each approved with its own button; every deploy succeeded): #97 small
fixes; #99 Montana existing-well matching (GWIC + DNRC + cadastral owner matching; owner fields
never returned); #100 Montana assessor details; #101 Gallatin level 3; #102 tighter cost ranges
(each line: central, likely range, tail; totals show the most likely value; power/well first;
`WELL_TERRAIN_RULES_VERSION` 5); #103 power lookup timeouts (Overpass cap 1.5 s, route budget
6 s, `power-intelligence/v1` cache, browser keeps the Worker answer); #109 Explore design +
index schema (docs only); #110 `public/score-core.js`: the score rules in one shared file,
`SCORE_RULES_VERSION` 1, 11 fixture parcels, duplicate score in `score-cost.js` removed (verifier
parity: 24 cases, 0 differences).

Product gap report (2026-11-14): all 16 gaps closed except accounts setup (owner steps).

Yearly chore: replace `src/counties/kootenai-levy-2026.js` each fall when Kootenai certifies levies.

## County report card (checklist score)

Update 2026-11-24: all five are level 3. Gallatin went to level 3 in #101 (lastValidated
2026-11-19). Known flaky spots: Yellowstone county server slow some days (e.g.
03113520290010000 "unavailable"); Kootenai parcel 015270010070 lookup failures.

Earlier notes: Kootenai 87 and Yellowstone 80: **level 3** (lastValidated 2026-11-11; clean daily runs
2026-11-09, 11-10 and 11-11, owner sign-off 2026-11-12; merged in #54). Stevens 78: **level 3**
(lastValidated 2026-11-12; clean daily runs 2026-11-11 and 11-12, owner sign-off 2026-11-13;
merged in #57-#59). Spokane about 90: level 3 (#65). Gallatin 75: level 2; owner signed off
parcels 06069905302080000 and 06033804413010000 on 2026-11-18, so level 3 is pending two
consecutive clean daily runs.
City of Spokane and Spokane Valley zoning rules are blocked: their code sites block automated
fetches, and the owner was asked for the code pages.
All five counties are in the daily validation run.

Daily run 2026-11-11: Kootenai, Spokane, Stevens and Yellowstone had 0 problems; Gallatin had 1
(GWIC wells timeout). Those results weren't published to `validation-results` because the
artifact upload failed (fixed on `claude/validation-publish-resilience`).

## Offered next (not approved)

- USDA soil (SDA) timed out on large parcels on 2026-11-03; give soil a fallback/longer window.
- Stevens: cite the UGA code section (the county site blocks automated fetches); zoning rules
  for Crossroads and Resort.
- terrain: USGS still exceeds the 17 s budget at times (3/12 Stevens parcels on 2026-11-07); fix
  in progress.
- Spokane: assessor property class not read; statewide WA parcel lookup sometimes 5-25 s.
- Gallatin: zoning rules table. Yellowstone: thin rules for D16/EB_CW; Broadview town limits.
- Plain-language rules for city zones (CdA, Post Falls, Spokane cities).
- Browser fallback for MT DNRC parcels and Stevens.
- Draft a note to Kootenai County GIS about Cloudflare blocking (owner said "not yet").

## Waiting on the owner

- Explore: the four open decisions above; an Anthropic API key (Cloudflare secret) at the
  "Ask AcresX" step; OK for a research agent to get nationwide parcel/zoning vendor quotes.
- Accounts: the `CLOUDFLARE_D1_TOKEN` secret is added (2026-11-24); the lead still has to switch
  the "Apply D1 migrations" workflow to it and rerun (the 2026-11-15 run failed with code 7403;
  this rides in the Explore database setup PR). Then: Resend account, verify
  acresx.info DNS, set Cloudflare secret `RESEND_API_KEY` on the `acresx` Worker. Meanwhile
  testers keep saved items in browser storage, behind Cloudflare Zero Trust.
- City of Spokane / Spokane Valley zoning code pages (their sites block automated fetches).
- Contractor quotes per county; Billings and Bozeman city fee schedules.
- Utility outreach for distribution line data (Avista written OK, Inland Power, Kootenai
  Electric, NorthWestern, co-ops; City of Cheney; Spokane County GIS "Power and Gas" layer).
- `SERPER_API_KEY` is not set in production, so web listing search is skipped (optional).
- Upload the ChatGPT history export for project context.
- Live domain names (realtor test site, landing page), for `PRODUCT.md`.

## Policy

- 2026-11-18 owner rule: "accurate data is the most important thing; owner names may be used
  internally where they improve accuracy but must never be displayed in the dashboard or
  reports". The same goes for other personal free text (well addresses, easement comments).

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
- 2026-11-09 to 11-11: merges #46, #48, #49, #50, #51 and #52, each owner-approved; all deploys
  succeeded.
- 2026-11-11: owner reviewed Spokane parcels 35204.2729 and 57344.0125 on the live site against
  SCOUT and signed off (checklist §7 owner sign-off for Spokane). Owner earlier confirmed
  Kootenai C72150030040 = R-12 (1 of 2 Kootenai sign-off parcels).
- 2026-11-12: owner signed off Kootenai (0L8210010030, plus C72150030040 earlier) and Yellowstone
  (03103233201230000, 03072527101010000) after comparing with county/state sources.
- 2026-11-12 to 11-13: merges #53, #54, #55 and #56, each owner-approved; all deploys succeeded.
- 2026-11-13: owner signed off Stevens (0231200, 2342700)
- 2026-11-13: owner approved deleting public/spokane-cost-model.js
- 2026-11-15: owner approved all product-gap merges ("Approval on all gap merges"); kept the
  23123.9051 score with the explanation line; yes to accounts (#14) including the D1 schema
  change, sign-in by email link (Resend); approved running the D1 migration workflow.
- 2026-11-16: the auto-mode permission check blocked a merge under the blanket approval, so each
  merge again gets its own Approve button. Merges #78-#80 approved that way.
- 2026-11-17: owner approved the calm report layout ("Looks great, push update").
- 2026-11-18: owner decisions: gradual terrain scale; 30% slope cutoff everywhere; septic uses the
  best homesite; the two-deep-wells rule with comparables, and one deep upland well sets the top
  when fewer than 3 wells are comparable. Owner signed off Gallatin parcels 06069905302080000 and
  06033804413010000. Merges #89-#96, each approved by button.

- 2026-11-23: owner set the strategy (nationwide, then compare + AI insights; no new features
  except realtor feedback). Approved Phase 1 and the inclusion rule: parcels >= 1 ac or vacant
  outside city limits, plus >= 1 ac inside city limits; improved rural parcels tagged; in-town
  lots < 1 ac, condos, commercial/industrial, ROW strips and public land left out.
- 2026-11-23: merge #109 (Explore design). Cloudflare: upgrade to Workers Paid (done by owner
  2026-11-24). MLS list prices stay on the report only, not in search results, until the MLS
  Grid terms are confirmed.
- 2026-11-24: merge #110 (score-core). Owner approved creating D1 `acresx-index` and created it
  (id `fc0bf7b8-82cd-469c-b2f0-172f74d4424b`); owner created a Cloudflare token (Account → D1 →
  Edit) and added it as GitHub secret `CLOUDFLARE_D1_TOKEN`.

## Next steps (offered, not approved)

- Wetlands backup source if NWI fails again (reminder set for 2026-11-19 23:30Z).
- Multi-property compare / batch reports (broker feedback).
- Kootenai levy table: replace `src/counties/kootenai-levy-2026.js` each fall.
- Stevens: add the county lot layer (layer 8) to recorded restrictions.
- Remove the Netlify GitHub app if Netlify isn't used.
- Delete the leftover `cloudflare/workers-autoconfig` branch (from closed PR #1).
- Continue the `ARCHITECTURE.md` migration: hazard screening, then the parcel/well/utility proxy,
  then listing context out of `src/worker.js`.
