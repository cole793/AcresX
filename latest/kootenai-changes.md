# Changes since the previous run: Kootenai, ID

- Run: 2026-11-02T22:22:07.828Z

## Cells

Parcel x layer cells: newly broken 9, still broken 4, recovered 2, newly unavailable 3.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Zoning | ok | error | timeout after 30s |
| 47N02W035500 | Zoning | ok | error | timeout after 30s |
| 0K245001002B | Zoning | ok | error | timeout after 30s |
| 49N03W324950 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 49N03W324950 | Zoning | ok | error | timeout after 30s |
| 49N03W324950 | Assessment | ok | error | Kootenai County Assessor timed out \(7 of 7 layers failed\) |
| 0K2660010030 | Zoning | ok | error | timeout after 30s |
| 0K2660010030 | Assessment | ok | error | Kootenai County Assessor timed out \(7 of 7 layers failed\) |
| C72150040140 | Zoning | ok | error | timeout after 30s |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 47N02W035500 | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 0K2660010030 | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 0153400A001A | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 0153400A001A | Slope grid | error | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0K245001002B | Terrain | error | ok | USGS elevation was unavailable for 5 of 9 terrain points. |
| 007740020050 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 47N02W035500 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |
| 49N03W324950 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |
| 0K2660010030 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |

