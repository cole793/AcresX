# Changes since the previous run: Stevens, WA

- Run: 2026-11-18T21:35:36.788Z

## Cells

Parcel x layer cells: newly broken 11, still broken 0, recovered 3, newly unavailable 4.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "not\_found", got "unavailable"; publicUtilities.sewer: expected "not\_found", got "unavailable" |
| 8974701 | Zoning | ok | mismatch | zoning.code: expected "RA-5", got null |
| 8974701 | Zoning rules | ok | mismatch | zoningRules.code: expected "RA-5", got null |
| 8974701 | Assessment | ok | mismatch | assessment.propertyClass: expected "99", got null |
| 0763202 | Zoning | ok | mismatch | zoning.code: expected "R-1", got null |
| 0763202 | Zoning rules | ok | mismatch | zoningRules.code: expected "R-1", got null |
| 0763202 | Assessment | ok | error | Stevens County Assessor timed out |
| 0231200 | Zoning | ok | mismatch | zoning.code: expected "R1", got null |
| 0231200 | Assessment | ok | mismatch | assessment.propertyClass: expected "11", got null |
| 0000500 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "served", got "likely"; publicUtilities.sewer: expected "likely", got "unavailable" |
| 0000500 | Zoning | ok | mismatch | zoning.code: expected "C-2", got null |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 2214900 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |
| 8673053 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |
| 8673053 | Zoning | error | ok | request failed: fetch failed |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0763202 | Public water/sewer | ok | unavailable | water likely \(Stevens Co Pud - Suncrest\); sewer unavailable |
| 0763202 | Property tax | ok | unavailable | unavailable: property tax not available |
| 0231200 | Public water/sewer | ok | unavailable | water likely \(Chewelah Water Dept South\); sewer unavailable |
| 0231200 | Property tax | ok | unavailable | unavailable: property tax not available |

