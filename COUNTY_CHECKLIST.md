# County checklist

Use this for every county AcresX adds or upgrades. It is modeled on **Spokane, WA** (the reference
for zoning depth) and **Kootenai, ID** (the reference for data reliability, rebuilt and validated
in Oct 2026). The goal from `PRODUCT.md`: a realtor gets the same depth and reliability in every
county, and every layer is either right or honestly marked unavailable, never silently wrong.

Start a new county by opening a **New county** issue on GitHub (Issues → New issue → New county).
That issue carries a copy of this checklist. Agents follow this file and record findings in
`handoff/findings.md`.

## Readiness levels

| Level | Meaning | Realtor-ready? |
|---|---|---|
| 1 | Statewide/national data only (parcel, wells, soil, terrain, flood, wetlands, utilities). No county adapter. | No |
| 2 | County adapter exists, but some layers are partial or unvalidated. | Testing only |
| 3 | Every section below is done and validation passes the bar in section 7. | **Yes** |

Record the level and `lastValidated` date in `src/config/county-coverage.js`.

## 1. Source inventory (research before any code)

For **every** source below, record in `handoff/findings.md`:

- [ ] Owner (county, city, state, federal, or a third party; prefer official)
- [ ] Service URL and layer id
- [ ] Field list, taken from the layer metadata (`<layer>?f=json`), never assumed
- [ ] A real sample query result for a known parcel, quoted
- [ ] Last-edit date if exposed, response time, and any rate limit seen
- [ ] Personal fields present (owner names, mailing addresses). They are never requested or shown.

| Source | Spokane (reference) | Kootenai (reference) | Required for level 3 |
|---|---|---|---|
| Parcel outlines + ID formats | Statewide WA parcels (`/api/arcgis`) | County `Ownership_Display/MapServer/0` (statewide ID layer has **no** Kootenai parcels) | Yes |
| Assessor values + property class | SCOUT `Assessor/SCOUTSimple` | `Assessor_Layers/MapServer` 5-11 | Yes |
| County zoning | SCOUT `ZoningLookup` | `Data_Layers/MapServer/21` | Yes |
| City limits / jurisdiction | SCOUT `PermittingLookup` | `Data_Layers/MapServer/18` (`CITY`) | Yes |
| City zoning, each incorporated city | Spokane County jurisdiction lookup | Coeur d'Alene (`gis.cdaid.org`), Post Falls (`gis.postfalls.gov`); others "city zoning applies" | Yes, or an honest "city zoning applies" with a link |
| Impact areas / growth boundary | UGA layer | `Data_Layers/MapServer/17` (info only; county zoning applies) | If the county has them |
| Comprehensive plan | SCOUT | Not yet | Nice to have |
| Permit history | `BPPublic/MapServer/5` | Not yet | Nice to have |
| Zoning code document + use table | `src/zoning/spokane-rules.js` | `src/zoning/kootenai-rules.js` | Yes, for county zones |
| Wells | WA Ecology | IDWR (`src/states/idaho/wells.js`) | Yes (state) |
| Utilities / power | Avista, Inland Power, OSM | Kootenai Electric, Avista, OSM | Yes |
| Flood, wetlands, soil, terrain | National (FEMA, NWI, USDA, USGS) | Same | Check coverage only |

## 2. Parcel lookup

- [ ] Accept every ID format a realtor might type: county PIN, dashed PID, lower case, spaces.
      Escape quotes in every `where` clause.
- [ ] Confirm the statewide layer actually contains this county. If it doesn't, use the county layer
      first. (Kootenai: statewide had 0 parcels and its useless queries caused rate-limit errors.)
- [ ] Request only named, non-personal fields. Strip owner/mailing fields from any fallback source.
- [ ] Esri rings → GeoJSON correctly: orientation, holes, multipart, duplicate rows.
- [ ] Map county fields to the property names the frontend reads (`ORIG_PARCEL_ID`,
      `PARCEL_ID_NR`, `SITUS_ADDRESS`, `SITUS_CITY_NM`, `ACRES`, `_countyDisplay`, …) inside the
      county adapter.
- [ ] Compare mapped outline acres with assessor acres. Show both when they differ.

## 3. Assessor

- [ ] Assessed land, improvement and net value, tax year, homeowner exemption.
- [ ] **Property class code** shown next to zoning, labeled **"Tax category, not zoning"**. Zillow
      and others label this code as "Zoning" (e.g. Kootenai "512 – Rural residential tract" on an
      Agriculture-zoned parcel).
- [ ] Missing values show "Not available", never "$0".
- [ ] If the assessor data is split across layers (districts), return on the first hit.

## 4. Zoning (the layer realtors check first)

- [ ] **Jurisdiction first:** decide city vs unincorporated from the city-limits layer. A parcel
      inside a city must never show county zoning or "no zoning found".
- [ ] City zoning from the city's official layer where it exists. Otherwise show
      "City of X zoning applies" with a link to the city's planning page. Don't guess.
- [ ] Unincorporated: look up zoning **across the parcel outline**, not only its center point.
      Report the zone covering most of the parcel and note the others. (Kootenai: a 65-acre river
      parcel's center fell in a gap in the zoning map.)
- [ ] Impact areas: confirm in the county code which zoning applies there and quote it.
- [ ] Every zone label the layer returns maps to the rules table, including alternate spellings
      (Kootenai's layer returns `RURAL`, `RESTRICTED RESIDENTIAL`, `AG-SUBURBAN`). An unmapped
      zone shows "rules not mapped", never another zone's rules. City codes never get county rules.
- [ ] Rules table built from the official code, with the section cited, in `src/zoning/<county>-rules.js`.

## 5. Hazards and site data (national sources; verify for the county)

- [ ] Flood: the county has a digital FEMA map (NFHL). Check zone X minimal, shaded X, D and A/AE
      parcels label correctly (minimal 96, moderate 70, undetermined 55, high 20).
- [ ] Wetlands: labels and coverage agree (no "present" with 0%).
- [ ] Soil, terrain, slope map: answer for typical parcel sizes within a few seconds.
- [ ] Wells: the state source returns nearby wells with depths.
- [ ] Power: providers found. Distance is "not verified" unless a real distribution source exists.

## 6. Code

- [ ] County-specific URLs and field mappings live only in `src/counties/<county>*.js`
      (and `src/zoning/<county>-rules.js`).
- [ ] Every `/api/*` response keeps the shape the frontend expects. New fields are additive.
- [ ] One failing source degrades only its own layer. The rest of the report still loads.
- [ ] Upstream calls: query fields only after probing them; POST long geometry; one retry on
      5xx/timeouts; no edge caching of ArcGIS answers (their errors arrive as HTTP 200); cache
      only validated results; stay well under Cloudflare's 50-subrequest limit.
- [ ] Listing/MLS data never changes the buildability score.
- [ ] Offline tests with fixtures recorded from the live services (personal fields replaced with
      placeholders), including each fallback path.
- [ ] Add the county to `src/config/county-coverage.js`, and to `public/zoning-potential.js` if it
      has zoning rules.

## 7. Validation (the bar for level 3)

- [ ] Run **discovery** to pick about 12 real parcels covering: small lots, 1-5 ac, 5-40 ac,
      40+ ac, inside a city, unincorporated, a high-risk flood zone, zone D or unmapped, mapped
      wetlands.
- [ ] Save them in `validation/counties/<county>.json`. For at least 3, record `expected` zoning,
      flood zone and assessor class checked by hand against the county's own website.
- [ ] Two consecutive validation runs on the **live** site, with no `error` or `mismatch` on any
      layer. `unavailable` is acceptable only where the data genuinely doesn't exist.
- [ ] Daily check enabled (it runs automatically for counties with saved parcels).
- [ ] Owner sign-off: search at least 2 parcels on the preview link and compare them with the
      county's own site.

## 8. Known gaps in the references (Oct 2026)

- The validation tool doesn't support Washington's parcel path yet, so **Spokane has never been
  run through it**. Add that before calling a Washington county level 3.
- Kootenai doesn't have comprehensive plan or permit history yet (Spokane does).
- Coeur d'Alene and Post Falls zoning rules aren't mapped to plain language; the city's own
  document is linked instead.
