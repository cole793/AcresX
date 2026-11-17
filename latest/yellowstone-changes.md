# Changes since the previous run: Yellowstone, MT

- Run: 2026-11-17T22:03:24.388Z

## Cells

Parcel x layer cells: newly broken 2, still broken 0, recovered 36, newly unavailable 0.

### Newly broken

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Zoning | ok | mismatch | zoning: expected "ok", got "error"; zoning.code: expected "UNZONED", got null; zoning.jurisdiction: expected "Yellowstone County", got null |
| 03103233202530000 | Wetlands | ok | error | HTTP 502: Wetland data unavailable: USFWS NWI returned 503; retry returned 503 |

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 03113520290010000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03072530104010000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03103333215010000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03103233201230000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03113517000000000 | Soil | error | ok | HTTP 503 |
| 03113517000000000 | Terrain | error | ok | HTTP 503 |
| 03113517000000000 | Slope grid | error | ok | HTTP 503 |
| 03113517000000000 | Listing | error | unavailable | HTTP 503 |
| 03072527101010000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03103333303010000 | Wells | error | ok | HTTP 503 |
| 03103333303010000 | Soil | error | ok | HTTP 503 |
| 03103333303010000 | Terrain | error | ok | HTTP 503 |
| 03103333303010000 | Power | error | ok | HTTP 503 |
| 03103333303010000 | Zoning | error | ok | HTTP 503 |
| 03103333303010000 | Listing | error | unavailable | HTTP 503 |
| 03103233202530000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03113519316050000 | Wells | error | ok | HTTP 503 |
| 03113519316050000 | Soil | error | ok | HTTP 503 |
| 03113519316050000 | Terrain | error | ok | HTTP 503 |
| 03113519316050000 | Slope grid | error | ok | HTTP 503 |
| 03113519316050000 | Flood | error | ok | HTTP 503 |
| 03113519316050000 | Power | error | ok | HTTP 503 |
| 03113519316050000 | Public water/sewer | error | ok | HTTP 503 |
| 03113519316050000 | Zoning | error | ok | HTTP 503 |
| 03113519316050000 | Assessment | error | ok | HTTP 503 |
| 03113519316050000 | Property tax | error | ok | HTTP 503 |
| 03113519316050000 | Listing | error | unavailable | HTTP 503 |
| 03072528309010000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |
| 03103333414250000 | Wells | error | ok | HTTP 503 |
| 03103333414250000 | Soil | error | ok | HTTP 503 |
| 03103333414250000 | Terrain | error | ok | HTTP 503 |
| 03103333414250000 | Slope grid | error | ok | HTTP 503 |
| 03103333414250000 | Power | error | ok | HTTP 503 |
| 03103333414250000 | Zoning | error | ok | HTTP 503 |
| 03103333414250000 | Listing | error | unavailable | HTTP 503 |
| 03103233202670000 | Soil | error | ok | USDA soil service returned 502 with an invalid response. |

