# Changes since the previous run: Gallatin, MT

- Run: 2026-11-24T23:03:57.106Z

## Cells

Parcel x layer cells: newly broken 3, still broken 0, recovered 3, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 06079611101010000 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 525; retry returned 521 |
| 06069818101020000 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 521; retry returned 521 |
| 06101033302010000 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 521; retry returned 521 |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 06079621201790000 | Public water/sewer | mismatch | ok | publicUtilities.water: expected "not\_found", got "unavailable"; publicUtilities.sewer: expected "not\_found", got "unavailable" |
| 06079801358210000 | Zoning | mismatch | ok | zoning: expected "ok", got "unavailable"; zoning.code: expected "R-3", got null |
| 06079812230210000 | Public water/sewer | mismatch | ok | publicUtilities.water: expected "served", got "likely"; publicUtilities.sewer: expected "served", got "likely" |

