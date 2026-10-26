# County validation: Kootenai, ID

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-10-26T20:14:45.501Z (discovered sample)
- Parcels: 12, with an error or mismatch: 10
- Layer results: ok 110, unavailable 41, error 17, mismatch 0, skipped 0

## Discovery diagnostics

Requests: 17, failed: 0. Features is the feature count, or the row count for count queries. Full URLs are in the discovered JSON.

- Layer probe: HTTP 200, content-type application/json;charset=UTF-8, fields checked: PIN, Acres, Loc_City, Loc_Addr, missing: none
- Layer fields (45): OBJECTID, Serial, LRSN, PID, PIN, Name, Acres, Legal, Loc_Addr, Loc_City, Ex_Value, Net_Val, Gross_Val, SA_SW, temp, CityCD, Incorp, STCA, URD_TCA, KTCA_LABEL, KTCA, URD_NAME, CITY_1, SCHOOL, HWY, FIRE, WATER, SEWER, FLOOD, WATERSHED, COUNTY, COLLEGE, HOSPITAL, AMBULANCE, LIBRARY, CFL_BOND, SYMBOL, NON_LEVIED, TIF_SD, ID, ... (+5 more, full list in the discovered JSON)

| Step | HTTP | Features | ms | Error |
|---|---|---|---|---|
| probe layer metadata | 200 | - | 281 |  |
| under 1 ac \| city-named locality (count) | 200 | 59495 | 141 |  |
| under 1 ac \| city-named locality (sample, offset 53084) | 200 | 50 | 164 |  |
| under 1 ac \| other/blank locality (count) | 200 | 7216 | 141 |  |
| under 1 ac \| other/blank locality (sample, offset 4365) | 200 | 50 | 125 |  |
| 1-5 ac \| city-named locality (count) | 200 | 8314 | 114 |  |
| 1-5 ac \| city-named locality (sample, offset 3351) | 200 | 50 | 130 |  |
| 1-5 ac \| other/blank locality (count) | 200 | 2662 | 114 |  |
| 1-5 ac \| other/blank locality (sample, offset 1284) | 200 | 50 | 114 |  |
| 5-40 ac \| city-named locality (count) | 200 | 8483 | 110 |  |
| 5-40 ac \| city-named locality (sample, offset 6660) | 200 | 50 | 128 |  |
| 5-40 ac \| other/blank locality (count) | 200 | 5820 | 116 |  |
| 5-40 ac \| other/blank locality (sample, offset 931) | 200 | 50 | 160 |  |
| 40+ ac \| city-named locality (count) | 200 | 491 | 110 |  |
| 40+ ac \| city-named locality (sample, offset 199) | 200 | 50 | 118 |  |
| 40+ ac \| other/blank locality (count) | 200 | 2452 | 269 |  |
| 40+ ac \| other/blank locality (sample, offset 282) | 200 | 50 | 127 |  |

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 52N04W293100 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| BK179000C100 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| 49N03W173800 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | unavailable | unavailable | unavailable |
| 0L0200010030 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| 49N01W250700 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| 47N03W231600 | ok | ok | unavailable | ok | ok | error | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 0M0120010020 | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| R0800026007A | ok | ok | unavailable | ok | ok | error | error | ok | ok | ok | unavailable | unavailable | unavailable | unavailable |
| 49N04W061000 | ok | ok | unavailable | ok | ok | ok | error | ok | ok | ok | ok | ok | unavailable | unavailable |
| 0K4820010010 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 52N04W295000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| R0800032001A | ok | ok | unavailable | ok | ok | ok | error | ok | ok | ok | unavailable | unavailable | unavailable | unavailable |

## Parcel details

### 52N04W293100 (RATHDRUM, 5.11 ac)

Why: Discovered sample: covers stratum "5-40 ac | city-named locality"; first in locality RATHDRUM. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 52N04W293100 [parcelId=52N04W293100, lat=47.831355, lon=-116.868039]
- **Wells**: ok. 114 well record(s), 5 of nearest 5 report depth [wellCount=114, nearestDepthsCount=5, nearestMi=0.17, medianDepthFt=289]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Avonville fine gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Avonville fine gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 0.8%, max 1.5% [gradePct=0.8, maxGradePct=1.5, reliefFt=6, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### BK179000C100 (no locality, 0.02 ac)

Why: Discovered sample: covers stratum "under 1 ac | other/blank locality"; first in locality (blank). Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel BK179000C100 [parcelId=BK179000C100, lat=47.974747, lon=-116.545789]
- **Wells**: ok. 17 well record(s), 5 of nearest 5 report depth [wellCount=17, nearestDepthsCount=5, nearestMi=0.7, medianDepthFt=320]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Kootenai gravelly silt loam, 20 to 45 percent slopes) [feasibility=limited, mapUnit=Kootenai gravelly silt loam, 20 to 45 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=33]
- **Terrain**: ok. avg grade 14.1%, max 22.4% [gradePct=14.1, maxGradePct=22.4, reliefFt=208, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE [providers=KOOTENAI ELECTRIC COOPERATIVE]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. COMMERCIAL (Kootenai County) [code=COMMERCIAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. C: Commercial (7 uses) [code=C, family=Commercial, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 49N03W173800 (HARRISON, 40 ac)

Why: Discovered sample: covers stratum "40+ ac | city-named locality"; first in locality HARRISON. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 49N03W173800 [parcelId=49N03W173800, lat=47.591832, lon=-116.763921]
- **Wells**: ok. 147 well record(s), 5 of nearest 5 report depth [wellCount=147, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=600]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Blinn loam, 5 to 35 percent slopes, very stony) [feasibility=limited, mapUnit=Blinn loam, 5 to 35 percent slopes, very stony, hydrologicGroup=C, drainage=Well drained, soilSlopePct=20]
- **Terrain**: ok. avg grade 8.8%, max 23.3% [gradePct=8.8, maxGradePct=23.3, reliefFt=245, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. HTTP 502: Upstream service returned 525
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RESTRICTED RESIDENTIAL (Kootenai County) [code=RESTRICTED RESIDENTIAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0L0200010030 (WORLEY, 4.79 ac)

Why: Discovered sample: covers stratum "1-5 ac | city-named locality"; first in locality WORLEY. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0L0200010030 [parcelId=0L0200010030, lat=47.497139, lon=-116.921261]
- **Wells**: ok. 166 well record(s), 5 of nearest 5 report depth [wellCount=166, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=420]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Taney silt loam, 3 to 7 percent slopes) [feasibility=favorable, mapUnit=Taney silt loam, 3 to 7 percent slopes, hydrologicGroup=C, drainage=Moderately well drained, soilSlopePct=5]
- **Terrain**: ok. avg grade 2.7%, max 6.5% [gradePct=2.7, maxGradePct=6.5, reliefFt=26, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. HTTP 502: Upstream service returned 525
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 49N01W250700 (CATALDO, 4.12 ac)

Why: Discovered sample: covers stratum "1-5 ac | other/blank locality"; first in locality CATALDO. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 49N01W250700 [parcelId=49N01W250700, lat=47.572435, lon=-116.404417]
- **Wells**: ok. 62 well record(s), 5 of nearest 5 report depth [wellCount=62, nearestDepthsCount=5, nearestMi=0.01, medianDepthFt=195]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Rubson-Mokins complex, 0 to 20 percent slopes) [feasibility=moderate, mapUnit=Rubson-Mokins complex, 0 to 20 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=10]
- **Terrain**: ok. avg grade 6.9%, max 14.8% [gradePct=6.9, maxGradePct=14.8, reliefFt=78, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47N03W231600 (ST MARIES, 338.72 ac)

Why: Discovered sample: covers stratum "40+ ac | other/blank locality"; first in locality ST MARIES. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 47N03W231600 [parcelId=47N03W231600, lat=47.408912, lon=-116.681115]
- **Wells**: ok. 79 well record(s), 5 of nearest 5 report depth [wellCount=79, nearestDepthsCount=5, nearestMi=0.29, medianDepthFt=364]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Santa ashy silt loam, 8 to 15 percent slopes) [feasibility=limited, mapUnit=Santa ashy silt loam, 8 to 15 percent slopes, hydrologicGroup=C/D, drainage=Moderately well drained, soilSlopePct=10]
- **Terrain**: ok. avg grade 1.2%, max 2.4% [gradePct=1.2, maxGradePct=2.4, reliefFt=112, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: ok. zones D [high=false, intersects=true, zones=D]
- **Wetlands**: ok. 19 NWI feature(s) [intersects=true, count=19, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0M0120010020 (no locality, 5.01 ac)

Why: Discovered sample: covers stratum "5-40 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0M0120010020 [parcelId=0M0120010020, lat=47.430546, lon=-116.846144]
- **Wells**: ok. 39 well record(s), 5 of nearest 5 report depth [wellCount=39, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=360]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Santa ashy silt loam, 15 to 35 percent slopes) [feasibility=limited, mapUnit=Santa ashy silt loam, 15 to 35 percent slopes, hydrologicGroup=C/D, drainage=Moderately well drained, soilSlopePct=16]
- **Terrain**: ok. avg grade 12.5%, max 18.2% [gradePct=12.5, maxGradePct=18.2, reliefFt=107, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### R0800026007A (RATHDRUM, 0.87 ac)

Why: Discovered sample: covers stratum "under 1 ac | city-named locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel R0800026007A [parcelId=R0800026007A, lat=47.809394, lon=-116.889531]
- **Wells**: ok. 88 well record(s), 5 of nearest 5 report depth [wellCount=88, nearestDepthsCount=5, nearestMi=0.66, medianDepthFt=340]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 1.5%, max 2.2% [gradePct=1.5, maxGradePct=2.2, reliefFt=3, sampleCount=9]
- **Slope grid**: error. timeout after 30s
- **Flood**: error. HTTP 502: Upstream service returned 525
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: unavailable. No mapped zoning result found [jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 49N04W061000 (COEUR D ALENE, 60.94 ac)

Why: Discovered sample: first in locality COEUR D ALENE. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 49N04W061000 [parcelId=49N04W061000, lat=47.627119, lon=-116.898178]
- **Wells**: ok. 131 well record(s), 5 of nearest 5 report depth [wellCount=131, nearestDepthsCount=5, nearestMi=0.25, medianDepthFt=400]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Schumacher silt loam, 7 to 20 percent slopes) [feasibility=moderate, mapUnit=Schumacher silt loam, 7 to 20 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=14]
- **Terrain**: ok. avg grade 14.3%, max 32.5% [gradePct=14.3, maxGradePct=32.5, reliefFt=470, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 24.1% [cellCount=16, avgSlopePct=24.1, maxSlopePct=37.4, partial=false]
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0K4820010010 (POST FALLS, 4.21 ac)

Why: Discovered sample: first in locality POST FALLS. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0K4820010010 [parcelId=0K4820010010, lat=47.68968, lon=-117.031848]
- **Wells**: ok. 132 well record(s), 5 of nearest 5 report depth [wellCount=132, nearestDepthsCount=5, nearestMi=0.04, medianDepthFt=178]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Opportunity very gravelly ashy loam, 0 to 3 percent slopes) [feasibility=favorable, mapUnit=Opportunity very gravelly ashy loam, 0 to 3 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 1.1%, max 2% [gradePct=1.1, maxGradePct=2, reliefFt=15, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2.3% [cellCount=16, avgSlopePct=2.3, maxSlopePct=4.4, partial=false]
- **Flood**: ok. zones X [high=false, intersects=true, zones=X]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. AG-SUBURBAN (Kootenai County) [code=AG-SUBURBAN, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. AS: Rural Residential (7 uses) [code=AS, family=Rural Residential, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 52N04W295000 (RATHDRUM, 5.4 ac)

Why: Discovered sample: fills remaining sample slots. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 52N04W295000 [parcelId=52N04W295000, lat=47.823562, lon=-116.864941]
- **Wells**: ok. 117 well record(s), 5 of nearest 5 report depth [wellCount=117, nearestDepthsCount=5, nearestMi=0.17, medianDepthFt=283]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Avonville fine gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Avonville fine gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 1.5%, max 3.1% [gradePct=1.5, maxGradePct=3.1, reliefFt=16, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2.5% [cellCount=16, avgSlopePct=2.5, maxSlopePct=4.6, partial=false]
- **Flood**: ok. zones X [high=false, intersects=true, zones=X]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### R0800032001A (RATHDRUM, 0.14 ac)

Why: Discovered sample: fills remaining sample slots. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel R0800032001A [parcelId=R0800032001A, lat=47.808775, lon=-116.89059]
- **Wells**: ok. 87 well record(s), 5 of nearest 5 report depth [wellCount=87, nearestDepthsCount=5, nearestMi=0.69, medianDepthFt=340]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 2%, max 3.2% [gradePct=2, maxGradePct=3.2, reliefFt=1, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2% [cellCount=16, avgSlopePct=2, maxSlopePct=5.3, partial=false]
- **Flood**: error. timeout after 30s
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: unavailable. No mapped zoning result found [jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: unavailable. no assessment record found
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
