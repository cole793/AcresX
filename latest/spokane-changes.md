# Changes since the previous run: Spokane, WA

- Run: 2026-11-18T21:34:35.282Z

## Cells

Parcel x layer cells: newly broken 12, still broken 0, recovered 0, newly unavailable 1.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 48121.9001 | Soil | ok | error | HTTP 503 |
| 48121.9001 | Terrain | ok | error | HTTP 503 |
| 48121.9001 | Property tax | ok | error | HTTP 503 |
| 48121.9001 | Listing | unavailable | error | HTTP 503 |
| 32322.9002 | Existing well | ok | error | HTTP 503 |
| 32322.9002 | Soil | ok | error | HTTP 503 |
| 32322.9002 | Terrain | ok | error | HTTP 503 |
| 32322.9002 | Slope grid | ok | error | HTTP 503 |
| 32322.9002 | Public water/sewer | ok | error | HTTP 503 |
| 32322.9002 | Zoning | ok | error | HTTP 503 |
| 32322.9002 | Assessment | ok | mismatch | assessment.propertyClass: expected "83", got null |
| 32322.9002 | Listing | unavailable | error | HTTP 503 |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 32322.9002 | Zoning rules | ok | unavailable | not requested: no zoning code returned \(the browser skips this call too\) |

