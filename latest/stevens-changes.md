# Changes since the previous run: Stevens, WA

- Run: 2026-11-08T18:30:59.914Z

## Cells

Parcel x layer cells: newly broken 1, still broken 0, recovered 4, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0000500 | Terrain | ok | error | USGS elevation was unavailable for 6 of 9 terrain points. |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8673053 | Parcel | error | ok | HTTP 502: services.arcgis.com timed out after 25s |
| 8673053 | Flood | mismatch | ok | flood.high: expected true, got null |
| 5320900 | Terrain | error | ok | USGS elevation was unavailable for 1 of 9 terrain points. |
| 5320900 | Slope grid | error | ok | Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly. |

