# County validation: Kootenai, ID

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-10-26T19:45:10.804Z (discovered sample)
- Parcels: 0, with an error or mismatch: 0
- Layer results: ok 0, unavailable 0, error 0, mismatch 0, skipped 0

## Discovery diagnostics

Requests: 26, failed: 18. Features is the feature count, or the row count for count queries. Full URLs are in the discovered JSON.

- Layer probe: HTTP 200, content-type application/json;charset=UTF-8, fields checked: PIN, Acres, ZONING, Loc_City, Loc_Addr, missing: ZONING

| Step | HTTP | Features | ms | Error |
|---|---|---|---|---|
| probe layer metadata | 200 | - | 353 | missing fields: ZONING |
| under 1 ac \| city-named locality (count) | 200 | 59495 | 127 |  |
| under 1 ac \| city-named locality (sample, offset 21273) | 200 | - | 65 | ArcGIS error 400: Failed to execute query. |
| under 1 ac \| city-named locality (sample, retry without offset) | 200 | - | 65 | ArcGIS error 400: Failed to execute query. |
| under 1 ac \| other/blank locality (count) | 200 | 7216 | 133 |  |
| under 1 ac \| other/blank locality (sample, offset 5814) | 200 | - | 119 | ArcGIS error 400: Failed to execute query. |
| under 1 ac \| other/blank locality (sample, retry without offset) | 200 | - | 76 | ArcGIS error 400: Failed to execute query. |
| 1-5 ac \| city-named locality (count) | 200 | 8314 | 133 |  |
| 1-5 ac \| city-named locality (sample, offset 7051) | 200 | - | 68 | ArcGIS error 400: Failed to execute query. |
| 1-5 ac \| city-named locality (sample, retry without offset) | 200 | - | 69 | ArcGIS error 400: Failed to execute query. |
| 1-5 ac \| other/blank locality (count) | 200 | 2662 | 99 |  |
| 1-5 ac \| other/blank locality (sample, offset 1327) | 200 | - | 66 | ArcGIS error 400: Failed to execute query. |
| 1-5 ac \| other/blank locality (sample, retry without offset) | 200 | - | 65 | ArcGIS error 400: Failed to execute query. |
| 5-40 ac \| city-named locality (count) | 200 | 8483 | 109 |  |
| 5-40 ac \| city-named locality (sample, offset 6652) | 200 | - | 69 | ArcGIS error 400: Failed to execute query. |
| 5-40 ac \| city-named locality (sample, retry without offset) | 200 | - | 73 | ArcGIS error 400: Failed to execute query. |
| 5-40 ac \| other/blank locality (count) | 200 | 5820 | 101 |  |
| 5-40 ac \| other/blank locality (sample, offset 2018) | 200 | - | 68 | ArcGIS error 400: Failed to execute query. |
| 5-40 ac \| other/blank locality (sample, retry without offset) | 200 | - | 65 | ArcGIS error 400: Failed to execute query. |
| 40+ ac \| city-named locality (count) | 200 | 491 | 122 |  |
| 40+ ac \| city-named locality (sample, offset 356) | 200 | - | 202 | ArcGIS error 400: Failed to execute query. |
| 40+ ac \| city-named locality (sample, retry without offset) | 200 | - | 66 | ArcGIS error 400: Failed to execute query. |
| 40+ ac \| other/blank locality (count) | 200 | 2452 | 106 |  |
| 40+ ac \| other/blank locality (sample, offset 54) | 200 | - | 68 | ArcGIS error 400: Failed to execute query. |
| 40+ ac \| other/blank locality (sample, retry without offset) | 200 | - | 64 | ArcGIS error 400: Failed to execute query. |
| distinct-zoning | 200 | - | 63 | ArcGIS error 400: Failed to execute query. |

No parcels to validate. Add parcels to the county file or run with `--discover`.
