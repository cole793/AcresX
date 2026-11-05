# Changes since the previous run: Kootenai, ID

- Run: 2026-11-05T20:42:20.249Z

## Cells

Parcel x layer cells: newly broken 11, still broken 2, recovered 3, newly unavailable 3.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 015270010070 | Zoning | ok | mismatch | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 48N03W312100 | Zoning | ok | error | timeout after 30s |
| 0K245001002B | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 49N03W324950 | Parcel | ok | error | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 007740020050 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0K2660010030 | Terrain | ok | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 0K2660010030 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0153400A001A | Terrain | ok | error | USGS elevation was unavailable for 5 of 9 terrain points. |
| 47N02W040800 | Terrain | ok | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 47N02W040800 | Zoning | ok | error | timeout after 30s |
| C72150040140 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 47N02W035500 | Terrain | error | error | USGS elevation was unavailable for 7 of 9 terrain points. |
| 47N02W040800 | Power | error | error | timeout after 30s |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Slope grid | error | ok | Elevation samples were returned, but not enough adjacent samples were available to calculate slope cells. |
| 48N03W312100 | Terrain | error | ok | USGS elevation was unavailable for 5 of 9 terrain points. |
| 007740020050 | Terrain | error | ok | USGS elevation was unavailable for 5 of 9 terrain points. |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 015270010070 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |
| 48N03W312100 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |
| 47N02W040800 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |

