# Changes since the previous run: Kootenai, ID

- Run: 2026-11-06T19:58:56.211Z

## Cells

Parcel x layer cells: newly broken 6, still broken 2, recovered 11, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| C72150030040 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 47N02W035500 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 48N03W312100 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 49N03W324950 | Slope grid | skipped | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 007740020050 | Terrain | ok | error | USGS elevation was unavailable for 5 of 9 terrain points. |
| 0153400A001A | Slope grid | ok | error | Elevation samples were returned, but not enough adjacent samples were available to calculate slope cells. |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 47N02W035500 | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 0K2660010030 | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 015270010070 | Zoning | mismatch | ok | zoning.code: expected "RURAL", got null; zoning.jurisdiction: expected "Kootenai County", got null |
| 48N03W312100 | Zoning | error | ok | timeout after 30s |
| 0K245001002B | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 49N03W324950 | Parcel | error | ok | HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled |
| 007740020050 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0K2660010030 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0153400A001A | Terrain | error | ok | USGS elevation was unavailable for 5 of 9 terrain points. |
| 47N02W040800 | Terrain | error | ok | USGS elevation was unavailable for 9 of 9 terrain points. |
| 47N02W040800 | Power | error | ok | timeout after 30s |
| 47N02W040800 | Zoning | error | ok | timeout after 30s |
| C72150040140 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

