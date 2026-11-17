# Changes since the previous run: Kootenai, ID

- Run: 2026-11-17T21:48:47.355Z

## Cells

Parcel x layer cells: newly broken 2, still broken 4, recovered 18, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry timeout after 6s |
| 48N03W312100 | Flood | skipped | error | HTTP 502: Flood data unavailable: FEMA NFHL returned 525; retry timeout after 6s; Esri USA Flood Hazard Areas returned 404 |

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
| 0L8210010030 | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0L8210010030 | Flood | mismatch | ok | flood.high: expected false, got null |
| 0L8210010030 | Public water/sewer | mismatch | ok | publicUtilities.water: expected "not\_found", got null; publicUtilities.sewer: expected "not\_found", got null |
| 0L8210010030 | Zoning | mismatch | ok | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 0L8210010030 | Assessment | mismatch | ok | assessment.propertyClass: expected "515", got null |
| C72150030040 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| C72150030040 | Zoning | mismatch | ok | zoning.code: expected "R-12", got null; zoning.jurisdiction: expected "City of Coeur d'Alene", got null |
| 47N02W035500 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 47N02W035500 | Power | error | ok | request failed: fetch failed |
| 48N03W312100 | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0K245001002B | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 49N03W324950 | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 007740020050 | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0K2660010030 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 0K2660010030 | Zoning | error | ok | timeout after 30s |
| 0153400A001A | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 47N02W040800 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| C72150040140 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |

