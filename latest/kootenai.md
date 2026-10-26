# County validation: Kootenai, ID

- Base URL: https://pr-13-acresx.cole-groshens.workers.dev
- Run: 2026-10-26T21:02:44.992Z
- Parcels: 12, with an error or mismatch: 9
- Layer results: ok 58, unavailable 23, error 9, mismatch 0, skipped 78

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0L8210010030 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 015270010070 | ok | error | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| C72150030040 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable | unavailable | unavailable |
| 47N02W035500 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 48N03W312100 | ok | ok | unavailable | ok | ok | error | ok | ok | ok | ok | unavailable | unavailable | unavailable | unavailable |
| 0K245001002B | ok | ok | unavailable | ok | ok | error | ok | ok | ok | ok | ok | unavailable | unavailable | unavailable |
| 49N03W324950 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 007740020050 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 0K2660010030 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 0153400A001A | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 47N02W040800 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| C72150040140 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |

## Parcel details

### 0L8210010030 (no locality, 4.79 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | other/blank locality"; first in locality (blank). Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0L8210010030 [parcelId=0L8210010030, lat=47.865654, lon=-116.819488]
- **Wells**: ok. 137 well record(s), 5 of nearest 5 report depth [wellCount=137, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=360]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 0.3%, max 1% [gradePct=0.3, maxGradePct=1, reliefFt=4, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.8% [cellCount=16, avgSlopePct=0.8, maxSlopePct=1.9, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 015270010070 (WORLEY, 10.01 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | city-named locality"; first in locality WORLEY. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 015270010070 [parcelId=015270010070, lat=47.430694, lon=-116.844376]
- **Wells**: error. HTTP 502: Idaho well service returned 522
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Santa ashy silt loam, 15 to 35 percent slopes) [feasibility=limited, mapUnit=Santa ashy silt loam, 15 to 35 percent slopes, hydrologicGroup=C/D, drainage=Moderately well drained, soilSlopePct=16]
- **Terrain**: ok. avg grade 13.1%, max 28.1% [gradePct=13.1, maxGradePct=28.1, reliefFt=95, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 22.9% [cellCount=16, avgSlopePct=22.9, maxSlopePct=37.5, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### C72150030040 (COEUR D ALENE, 0.27 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | city-named locality"; first in locality COEUR D ALENE. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel C72150030040 [parcelId=C72150030040, lat=47.724453, lon=-116.803995]
- **Wells**: ok. 53 well record(s), 5 of nearest 5 report depth [wellCount=53, nearestDepthsCount=5, nearestMi=0.74, medianDepthFt=330]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McGuire-Marble association, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=McGuire-Marble association, 0 to 7 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 3.8%, max 7.9% [gradePct=3.8, maxGradePct=7.9, reliefFt=7, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.5% [cellCount=16, avgSlopePct=5.5, maxSlopePct=14.6, partial=false]
- **Flood**: ok. no high/moderate-risk zone mapped (via Esri USA Flood Hazard Areas, high/moderate-risk zones only) [high=false, intersects=false, zones=(none), provider=Esri USA Flood Hazard Areas, coverage=high-and-moderate-risk-only, emptyResult=true]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: unavailable. No mapped zoning result found [jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47N02W035500 (MEDIMONT, 51.64 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | other/blank locality"; first in locality MEDIMONT. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 47N02W035500 [parcelId=47N02W035500, lat=47.453302, lon=-116.577746]
- **Wells**: ok. 40 well record(s), 5 of nearest 5 report depth [wellCount=40, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=262]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Cougarbay silt loam) [feasibility=limited, mapUnit=Cougarbay silt loam, hydrologicGroup=D, drainage=Very poorly drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 3.6%, max 10.1% [gradePct=3.6, maxGradePct=10.1, reliefFt=128, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.3% [cellCount=16, avgSlopePct=6.3, maxSlopePct=21.9, partial=false]
- **Flood**: ok. high-risk zone (A, X, AE) (via FEMA NFHL) [high=true, intersects=true, zones=A; X; AE, provider=FEMA NFHL]
- **Wetlands**: ok. 16 NWI feature(s) [intersects=true, count=16, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48N03W312100 (HARRISON, 65.33 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | city-named locality"; first in locality HARRISON. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 48N03W312100 [parcelId=48N03W312100, lat=47.462958, lon=-116.763586]
- **Wells**: ok. 40 well record(s), 5 of nearest 5 report depth [wellCount=40, nearestDepthsCount=5, nearestMi=0.33, medianDepthFt=280]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Aeric Fluvaquents-Typic Fluvaquents-Typic Haplosaprist association, 0 to 1 percent slopes) [feasibility=limited, mapUnit=Aeric Fluvaquents-Typic Fluvaquents-Typic Haplosaprist association, 0 to 1 percent slopes, hydrologicGroup=B/D, drainage=Very poorly drained, soilSlopePct=0]
- **Terrain**: ok. avg grade 2.2%, max 12.6% [gradePct=2.2, maxGradePct=12.6, reliefFt=161, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: ok. high-risk zone (AE, X) (via FEMA NFHL) [high=true, intersects=true, zones=AE; X, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: unavailable. No mapped zoning result found [jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0K245001002B (RATHDRUM, 1.62 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | city-named locality"; first in locality RATHDRUM. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0K245001002B [parcelId=0K245001002B, lat=47.874046, lon=-116.855048]
- **Wells**: ok. 81 well record(s), 5 of nearest 5 report depth [wellCount=81, nearestDepthsCount=5, nearestMi=0.24, medianDepthFt=540]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 2.3%, max 4.1% [gradePct=2.3, maxGradePct=4.1, reliefFt=20, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RESTRICTED RESIDENTIAL (Kootenai County) [code=RESTRICTED RESIDENTIAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 49N03W324950 (no locality, 10 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 007740020050 (no locality, 0.58 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 0K2660010030 (ATHOL, 4.95 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ATHOL. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 0153400A001A (POST FALLS, 9.52 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality POST FALLS. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 47N02W040800 (ST MARIES, 99.74 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ST MARIES. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### C72150040140 (COEUR D ALENE, 0.23 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): fills remaining sample slots. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Unable to perform query. Too many requests.
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
