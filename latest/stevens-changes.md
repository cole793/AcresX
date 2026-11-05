# Changes since the previous run: Stevens, WA

- Run: 2026-11-05T20:54:03.316Z

## Cells

Parcel x layer cells: newly broken 4, still broken 5, recovered 4, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Terrain | ok | error | USGS elevation was unavailable for 9 of 9 terrain points. |
| 2378200 | Terrain | ok | error | USGS elevation was unavailable for 8 of 9 terrain points. |
| 2378200 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 5320900 | Terrain | ok | error | USGS elevation was unavailable for 5 of 9 terrain points. |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0231200 | Slope grid | error | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0000500 | Terrain | error | error | USGS elevation was unavailable for 5 of 9 terrain points. |
| 0000500 | Slope grid | error | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 2214900 | Terrain | error | error | USGS elevation was unavailable for 7 of 9 terrain points. |
| 8673053 | Terrain | error | error | USGS elevation was unavailable for 9 of 9 terrain points. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Zoning | mismatch | ok | zoning.code: expected "5", got null |
| 8974701 | Zoning rules | mismatch | ok | zoningRules.code: expected "RA-5", got null |
| 0231200 | Terrain | error | ok | USGS elevation was unavailable for 9 of 9 terrain points. |
| 2342700 | Terrain | error | ok | USGS elevation was unavailable for 4 of 9 terrain points. |

