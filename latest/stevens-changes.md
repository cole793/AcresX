# Changes since the previous run: Stevens, WA

- Run: 2026-11-19T21:46:09.144Z

## Cells

Parcel x layer cells: newly broken 0, still broken 0, recovered 11, newly unavailable 0.

### Recovered

| Parcel | Layer | Was | Now | Detail |
|---|---|---|---|---|
| 8974701 | Public water/sewer | mismatch | ok | publicUtilities.water: expected "not\_found", got "unavailable"; publicUtilities.sewer: expected "not\_found", got "unavailable" |
| 8974701 | Zoning | mismatch | ok | zoning.code: expected "RA-5", got null |
| 8974701 | Zoning rules | mismatch | ok | zoningRules.code: expected "RA-5", got null |
| 8974701 | Assessment | mismatch | ok | assessment.propertyClass: expected "99", got null |
| 0763202 | Zoning | mismatch | ok | zoning.code: expected "R-1", got null |
| 0763202 | Zoning rules | mismatch | ok | zoningRules.code: expected "R-1", got null |
| 0763202 | Assessment | error | ok | Stevens County Assessor timed out |
| 0231200 | Zoning | mismatch | ok | zoning.code: expected "R1", got null |
| 0231200 | Assessment | mismatch | ok | assessment.propertyClass: expected "11", got null |
| 0000500 | Public water/sewer | mismatch | ok | publicUtilities.water: expected "served", got "likely"; publicUtilities.sewer: expected "likely", got "unavailable" |
| 0000500 | Zoning | mismatch | ok | zoning.code: expected "C-2", got null |

