# AcresX: product context

What the product is for and where it's going. Read this before deciding what to build or how to
prioritize. Technical guidance is in `CLAUDE.md`.

## What it is

A due-diligence tool for rural land: "understand the land before you buy." A user picks a county
and enters a parcel number. AcresX pulls official public records (parcel, wells, soils, slope,
flood, wetlands, power/utility territory, zoning and permits, assessment/tax, MLS listing context)
and produces a buildability score, a preliminary development-cost range and a two-page property
report.

## Who it's for

- **Realtors**, who use it on listings and give clients a feasibility report.
- **Land buyers**, who check a parcel before they buy.

## Stage (as of Oct 2026)

- **Testing phase with realtors, free.** The realtor test site is live, and a separate marketing
  landing page is live.
- **Planned business model:** a subscription for realtors and/or per-report pricing for land
  buyers, possibly both. Not built yet. No accounts, billing or paywall exist in the code.
- **MLS:** access is approved for a **demo sample only** (MLS Grid demo API, Spokane MLS `sarmls`),
  not the full Spokane-area listings. Listing context will be sparse until full access is
  granted. Don't treat missing listing matches as a bug.

## The core goal: consistent, reliable results in every county

The product must give the user **the same quality and shape of result no matter which county or
state they search**. A realtor testing in Kootenai County should get the same depth and
reliability as one in Spokane County.

That means, for each supported county:

- every data layer either works reliably or is clearly marked unavailable, never silently wrong
- the score and cost model use the same inputs and the same rules everywhere
- results are checked against known parcels, so we know they're right, not just present
- when a county's GIS service changes or goes down, we find out before a realtor does

## Current priority: depth over breadth

**Make the existing Northwest counties fully reliable before adding new ones**, so more realtors
can test with confidence. Today's state is in `src/config/county-coverage.js`:

| County | Level | Gaps |
|---|---|---|
| Spokane, WA | 3 (reference) | tax partial |
| Yellowstone, MT | 3 (reference) | utilities unvalidated, tax partial |
| Kootenai, ID | 3 (reference) | utilities unvalidated, assessment partial, tax not configured |
| Gallatin, MT | 2 | most layers unvalidated, zoning partial, zoning rules not configured |

New counties (the `priority2` list in `county-coverage.js`) come after these are solid.

## Product rules

- Results are screening information. Keep the "verify with the responsible agency" framing.
- Prefer official county/state/federal GIS and REST services over scraping web pages.
- Listing/MLS claims are unverified context and never affect the buildability score.
- An unavailable data layer is shown as unavailable, never guessed.
