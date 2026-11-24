# Changes since the previous run: Stevens, WA

- Run: 2026-11-24T01:05:42.486Z

## Cells

Parcel x layer cells: newly broken 2, still broken 0, recovered 3, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Zoning | ok | mismatch | zoning.code: expected "RA-5", got null |
| 8974701 | Zoning rules | ok | mismatch | zoningRules.code: expected "RA-5", got null |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 0763202 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |
| 0231200 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI timeout after 8s; retry returned 503 |
| 0000500 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |

