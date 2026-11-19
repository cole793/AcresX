# Changes since the previous run: Spokane, WA

- Run: 2026-11-19T21:44:40.724Z

## Cells

Parcel x layer cells: newly broken 1, still broken 0, recovered 12, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 32322.9002 | Flood | ok | error | HTTP 502: Flood data unavailable: FEMA NFHL timeout after 8s; retry timeout after 6s; Esri USA Flood Hazard Areas returned 404 |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 48121.9001 | Soil | error | ok | HTTP 503 |
| 48121.9001 | Terrain | error | ok | HTTP 503 |
| 48121.9001 | Property tax | error | ok | HTTP 503 |
| 48121.9001 | Listing | error | unavailable | HTTP 503 |
| 32322.9002 | Existing well | error | ok | HTTP 503 |
| 32322.9002 | Soil | error | ok | HTTP 503 |
| 32322.9002 | Terrain | error | ok | HTTP 503 |
| 32322.9002 | Slope grid | error | ok | HTTP 503 |
| 32322.9002 | Public water/sewer | error | ok | HTTP 503 |
| 32322.9002 | Zoning | error | ok | HTTP 503 |
| 32322.9002 | Assessment | mismatch | ok | assessment.propertyClass: expected "83", got null |
| 32322.9002 | Listing | error | unavailable | HTTP 503 |

