# Changes since the previous run: Spokane, WA

- Run: 2026-11-07T18:08:37.571Z

## Cells

Parcel x layer cells: newly broken 3, still broken 2, recovered 3, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 35234.0602 | Parcel | ok | error | HTTP 502: services.arcgis.com timed out after 25s |
| 35234.0602 | Zoning | ok | mismatch | zoning.code: expected "R-3", got null; zoning.jurisdiction: expected "City of Spokane Valley", got null |
| 48136.9052 | Terrain | ok | error | USGS elevation was unavailable for 9 of 9 terrain points. |

### Still broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 57344.0125 | Terrain | error | error | USGS elevation was unavailable for 8 of 9 terrain points. |
| 43341.0110 | Terrain | error | error | USGS elevation was unavailable for 4 of 9 terrain points. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 47071.9003 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 57302.9016 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 48121.9001 | Power | error | ok | timeout after 30s |

