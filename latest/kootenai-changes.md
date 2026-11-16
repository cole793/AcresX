# Changes since the previous run: Kootenai, ID

- Run: 2026-11-16T22:55:27.899Z

## Cells

Parcel x layer cells: newly broken 22, still broken 0, recovered 0, newly unavailable 2.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0L8210010030 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0L8210010030 | Flood | ok | mismatch | flood.high: expected false, got null |
| 0L8210010030 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "not\_found", got null; publicUtilities.sewer: expected "not\_found", got null |
| 0L8210010030 | Zoning | ok | mismatch | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 0L8210010030 | Assessment | ok | mismatch | assessment.propertyClass: expected "515", got null |
| 015270010070 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 015270010070 | Flood | ok | mismatch | flood.high: expected false, got null |
| 015270010070 | Zoning | ok | mismatch | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 015270010070 | Assessment | ok | mismatch | assessment.propertyClass: expected "537", got null |
| C72150030040 | Soil | ok | error | USDA soil service returned 502 with an invalid response. |
| C72150030040 | Zoning | ok | mismatch | zoning.code: expected "R-12", got null; zoning.jurisdiction: expected "City of Coeur d'Alene", got null |
| 47N02W035500 | Soil | ok | error | USDA soil service returned 502 with an invalid response. |
| 47N02W035500 | Power | ok | error | request failed: fetch failed |
| 48N03W312100 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0K245001002B | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 49N03W324950 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 007740020050 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 0K2660010030 | Soil | ok | error | USDA soil service returned 502 with an invalid response. |
| 0K2660010030 | Zoning | ok | error | timeout after 30s |
| 0153400A001A | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 47N02W040800 | Soil | ok | error | USDA soil service returned 502 with an invalid response. |
| C72150040140 | Soil | ok | error | USDA soil service returned 502 with an invalid response. |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0K2660010030 | Public water/sewer | ok | unavailable | water unavailable; sewer unavailable |
| 0K2660010030 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |

