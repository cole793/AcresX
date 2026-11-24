# Changes since the previous run: Stevens, WA

- Run: 2026-11-24T23:08:33.521Z

## Cells

Parcel x layer cells: newly broken 1, still broken 0, recovered 2, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 5320900 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 521; retry returned 521 |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Zoning | mismatch | ok | zoning.code: expected "RA-5", got null |
| 8974701 | Zoning rules | mismatch | ok | zoningRules.code: expected "RA-5", got null |

