# Changes since the previous run: Kootenai, ID

- Run: 2026-11-18T21:27:41.465Z

## Cells

Parcel x layer cells: newly broken 3, still broken 4, recovered 2, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Wells | ok | error | HTTP 502: Idaho well service timed out after 8s |
| C72150030040 | Zoning | ok | mismatch | zoning.code: expected "R-12", got null; zoning.jurisdiction: expected "City of Coeur d'Alene", got null |
| 47N02W040800 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 015270010070 | Parcel | error | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 015270010070 | Flood | mismatch | mismatch | flood.high: expected false, got null |
| 015270010070 | Zoning | mismatch | mismatch | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 015270010070 | Assessment | mismatch | mismatch | assessment.propertyClass: expected "537", got null |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry timeout after 6s |
| 48N03W312100 | Flood | error | ok | HTTP 502: Flood data unavailable: FEMA NFHL returned 525; retry timeout after 6s; Esri USA Flood Hazard Areas returned 404 |

