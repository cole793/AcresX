# Changes since the previous run: Yellowstone, MT

- Run: 2026-11-19T21:51:47.083Z

## Cells

Parcel x layer cells: newly broken 2, still broken 0, recovered 1, newly unavailable 1.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Public water/sewer | ok | mismatch | publicUtilities.water: expected "not\_found", got "unavailable"; publicUtilities.sewer: expected "not\_found", got "unavailable" |
| 03113520290010000 | Zoning | ok | mismatch | zoning: expected "ok", got "unavailable"; zoning.code: expected "UNZONED", got null |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Wells | error | ok | HTTP 502: GWIC Boreholes service timed out after 8s |

### Newly unavailable

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03072530104010000 | Zoning | ok | unavailable | No mapped zoning district found |

