# Changes since the previous run: Gallatin, MT

- Run: 2026-11-24T00:59:40.814Z

## Cells

Parcel x layer cells: newly broken 3, still broken 0, recovered 11, newly unavailable 10.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 06079621201790000 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "not\_found", got "unavailable"; publicUtilities.sewer: expected "not\_found", got "unavailable" |
| 06079801358210000 | Zoning | ok | mismatch | zoning: expected "ok", got "unavailable"; zoning.code: expected "R-3", got null |
| 06079812230210000 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "served", got "likely"; publicUtilities.sewer: expected "served", got "likely" |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 06079621201790000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06079611101010000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06069818101020000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry timeout after 6s |
| 06079801358210000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06069905302080000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |
| 06069624301010000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06033804413010000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |
| 06033908402700000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06101033302010000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06042734301530000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry timeout after 6s |
| 06079812230210000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 06079611101010000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06069818101020000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06069905302080000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06069624301010000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06033804413010000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06033908402700000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06110827101470000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06101033302010000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06042734301530000 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 06079812230210000 | Zoning | ok | unavailable | City of Bozeman zoning lookup unavailable · overlays: none mapped |

