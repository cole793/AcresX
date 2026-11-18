# Changes since the previous run: Yellowstone, MT

- Run: 2026-11-18T21:40:30.308Z

## Cells

Parcel x layer cells: newly broken 1, still broken 0, recovered 2, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Wells | ok | error | HTTP 502: GWIC Boreholes service timed out after 8s |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Zoning | mismatch | ok | zoning: expected "ok", got "error"; zoning.code: expected "UNZONED", got null; zoning.jurisdiction: expected "Yellowstone County", got null |
| 03103233202530000 | Wetlands | error | ok | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |

