# County validation

`scripts/validate-county.mjs` runs a set of test parcels through the **deployed** AcresX API, using
the same requests the browser makes, and records a status for each data layer: parcel, wells,
existing well, soil, terrain, slope grid, flood, wetlands, utility, power, zoning, zoning rules,
assessment and listing context. It shows which layers work in each county and catches a county
GIS service that changes or goes down before a realtor does.

It only makes read-only lookups. It never sends `sync` to `/api/reso-listings` (that writes to the
live MLS database), never calls `/api/property-tax-test`, and skips `/api/listing-evidence` (it
spends paid web-search quota).

## Statuses

| Status | Meaning |
|---|---|
| `ok` | The layer returned usable data. |
| `unavailable` | The API answered cleanly that the data isn't available, or the browser wouldn't request it (for example power intelligence when no utility was found). |
| `error` | HTTP error, timeout (30 s), invalid JSON, or an `error` field in the response. |
| `mismatch` | The layer's result differs from the parcel's `expected` values. |
| `skipped` | Not run because the parcel lookup failed. |

## Run it

From GitHub Actions (the normal way): **Actions, County validation, Run workflow**. Pick the
county, optionally tick `discover`, optionally give a base URL (for example a PR preview link).
The run summary shows the table, and the `county-validation-<county>` artifact holds the JSON and
Markdown. A scheduled run checks every county file daily at 13:23 UTC.

## Where results live

Every workflow run also commits its results to the `validation-results` branch, so anyone who can
`git fetch` the repo can read them (no Actions artifact download needed):

```sh
git fetch origin validation-results
git show origin/validation-results:latest/kootenai.md          # latest table and details
git show origin/validation-results:latest/kootenai.json        # same run, full JSON
git log --oneline origin/validation-results                    # one commit per county per run
git ls-tree -r --name-only origin/validation-results history/  # every past run
```

Layout on that branch:

| Path | Contents |
|---|---|
| `latest/<county>.json`, `latest/<county>.md` | The most recent run, overwritten each time. |
| `latest/<county>-discovered.json` | The sample from the most recent `discover` run. A later run without discovery leaves it in place; check its `generatedAt`. |
| `history/<YYYY-MM-DD>/<county>-<run_id>.json` | Every run's JSON report, kept (the date is UTC). |

Commit messages read `Validation <county> <date> run <run_id>: <failed> failed`, so
`git log origin/validation-results` is a quick pass/fail history. `<run_id>` is the GitHub Actions
run id (`https://github.com/<owner>/<repo>/actions/runs/<run_id>`).

The branch holds only results and shares no history with `main`. The workflow's `publish` job is
the only job with write access, and it only pushes to `validation-results`. Pushing there doesn't
deploy anything: the deploy workflow runs on `main` only, and pushes made with the workflow's
token don't start other workflows. Don't merge `validation-results` into `main` or open a PR
from it.

Locally (needs internet access to the deployed site and the county servers):

```sh
node scripts/validate-county.mjs --county kootenai                 # saved parcels
node scripts/validate-county.mjs --county kootenai --discover      # fresh varied sample
node scripts/validate-county.mjs --county kootenai --discover --count 8 --seed 42
node scripts/validate-county.mjs --county kootenai --base-url https://pr-12-acresx.example.workers.dev --out /tmp/v
```

The base URL defaults to `ACRESX_BASE_URL`, else `https://acresx.cole-groshens.workers.dev`.
Output goes to `validation-results/` (`<county>.json`, `<county>.md`, and with `--discover`
`<county>-discovered.json`). The exit code is 0 unless the script itself crashes; the report's
`summary.failed` counts parcels with an error or mismatch.

## Discovery

`--discover` queries the county's public ArcGIS parcel layer directly (not AcresX) and picks a
varied sample: each acreage band crossed with "situs city is a named city" / "other or blank
locality", then any ZONING values those queries missed (only when `zoningField` is set; without
it, variety comes from acreage band and locality only). Each pick has a `label` and a `why`. The
locality field is the situs city, so it doesn't prove a parcel is inside city limits; the zoning
layer's `jurisdiction` value in the report is the better check. The seed is recorded, so
`--seed` reproduces a sample.

Discovery first fetches the layer's metadata (`<layerUrl>?f=json`) to check the server answers and
that the configured field names exist. It records the layer's field names (`fieldNames`; the
markdown lists the first 40). When the probe gets a field list, configured fields the layer lacks
are left out of that run's queries, with a note in the diagnostics (a wrong-case name uses the
layer's spelling); if `idField` is missing, discovery stops there. Every request it makes (that probe, then each count,
sample and zoning query) is recorded in the `diagnostics` array of `<county>-discovered.json`,
with the full URL, HTTP status, feature count, time and error (status, content type and the start
of the body, the ArcGIS error code and details, or the network error cause). `<county>.md` has a
"Discovery diagnostics" table whenever discovery ran, so an empty sample says why.

## Add a county

Create `validation/counties/<name>.json` (lowercase file name):

```json
{
  "county": "Bonner",
  "state": "ID",
  "parcels": [],
  "discover": {
    "layerUrl": "https://<county ArcGIS>/MapServer/0",
    "idField": "PIN", "acresField": "Acres", "zoningField": "ZONING",
    "cityField": "Loc_City", "addressField": "Loc_Addr", "where": "PIN IS NOT NULL",
    "cities": ["Sandpoint"],
    "acreBands": [{ "label": "under 1 ac", "max": 1 }, { "label": "1-5 ac", "min": 1, "max": 5 },
                  { "label": "5-40 ac", "min": 5, "max": 40 }, { "label": "40+ ac", "min": 40 }]
  }
}
```

`zoningField` is optional: leave it out when the parcel layer has no zoning attribute (Kootenai's
doesn't). `county` and `state` are sent to the API exactly as the browser's dropdowns send them. The
harness follows the Idaho/Montana request path (`/api/parcel-search`); Washington counties use
the legacy `/api/arcgis` parcel path in the browser and aren't supported by the harness yet.

## Add parcels and expected values

Run discovery, copy the picks you want from `<county>-discovered.json` into `parcels`, and once a
result has been checked against the county's own records, add `expected` values:

```json
{
  "parcelId": "...",
  "label": "Athol, 10 ac, rural",
  "why": "Unincorporated 5-40 ac parcel",
  "expected": {
    "zoning": "ok",
    "zoning.code": "Rural",
    "zoning.jurisdiction": "Kootenai County",
    "flood.high": false,
    "utility.providers": "Kootenai Electric Cooperative",
    "terrain.gradePct": { "max": 15 },
    "assessment.assessedValue": { "min": 100000, "max": 900000 }
  }
}
```

A key without a dot checks the layer status. `layer.field` checks a value from the report's
per-parcel details (the names in `[...]`). Strings compare case-insensitively, a list value
matches if any item matches, and `{ "min", "max" }` checks a numeric range.

Tests for the harness are in `test/validate-county.test.js` (offline, fetch stubbed).
