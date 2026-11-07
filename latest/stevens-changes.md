# Changes since the previous run: Stevens, WA

- Run: 2026-11-07T18:12:50.434Z

## Cells

Parcel x layer cells: newly broken 4, still broken 0, recovered 6, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8673053 | Parcel | ok | error | HTTP 502: services.arcgis.com timed out after 25s |
| 8673053 | Flood | ok | mismatch | flood.high: expected true, got null |
| 5320900 | Terrain | ok | error | USGS elevation was unavailable for 1 of 9 terrain points. |
| 5320900 | Slope grid | ok | error | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Terrain | error | ok | USGS elevation was unavailable for 9 of 9 terrain points. |
| 8974701 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |
| 0231200 | Terrain | error | ok | USGS elevation was unavailable for 5 of 9 terrain points. |
| 2371220 | Terrain | error | ok | USGS elevation was unavailable for 7 of 9 terrain points. |
| 2371220 | Flood | mismatch | ok | flood.high: expected false, got true |
| 5320900 | Flood | mismatch | ok | flood.high: expected false, got true |

