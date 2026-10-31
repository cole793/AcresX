# County validation: Kootenai, ID

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-10-31T17:49:05.777Z
- Parcels: 12, with an error or mismatch: 4
- Layer results: ok 136, unavailable 27, error 5, mismatch 0, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0L8210010030 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 015270010070 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| C72150030040 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 47N02W035500 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 48N03W312100 | ok | ok | unavailable | ok | ok | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 0K245001002B | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 49N03W324950 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 007740020050 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 0K2660010030 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 0153400A001A | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 47N02W040800 | ok | ok | unavailable | ok | error | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| C72150040140 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |

## Parcel details

### 0L8210010030 (no locality, 4.79 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | other/blank locality"; first in locality (blank). Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0L8210010030, 4.79 ac [parcelId=0L8210010030, acres=4.79, lat=47.865654, lon=-116.819488]
- **Wells**: ok. 137 well record(s), 5 of nearest 5 report depth [wellCount=137, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=360]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: error. USGS elevation was unavailable for 7 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 0.8% [cellCount=16, avgSlopePct=0.8, maxSlopePct=1.9, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: ok. assessed $372,460, class 515 Rural residential sub, no tax amount [assessedValue=372460, landValue=372460, improvementValue=0, taxPresent=false, netValue=93115, homeownerExemption=0, taxYear=2026, propertyClass=515, propertyClassDescription=Rural residential sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 015270010070 (WORLEY, 10.01 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | city-named locality"; first in locality WORLEY. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 015270010070, 10.01 ac [parcelId=015270010070, acres=10.01, address=26402 S FARUP RD, WORLEY, lat=47.430694, lon=-116.844376]
- **Wells**: ok. 39 well record(s), 5 of nearest 5 report depth [wellCount=39, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=360]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Santa ashy silt loam, 15 to 35 percent slopes) [feasibility=limited, mapUnit=Santa ashy silt loam, 15 to 35 percent slopes, hydrologicGroup=C/D, drainage=Moderately well drained, soilSlopePct=16]
- **Terrain**: ok. avg grade 13.1%, max 28.1% [gradePct=13.1, maxGradePct=28.1, reliefFt=95, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 22.9% [cellCount=16, avgSlopePct=22.9, maxSlopePct=37.5, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=4.7]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: ok. assessed $217,018, class 537 Imp res rural sub, no tax amount [assessedValue=217018, landValue=179478, improvementValue=37540, taxPresent=false, netValue=217018, homeownerExemption=0, taxYear=2026, propertyClass=537, propertyClassDescription=Imp res rural sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### C72150030040 (COEUR D ALENE, 0.27 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | city-named locality"; first in locality COEUR D ALENE. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel C72150030040, 0.27 ac [parcelId=C72150030040, acres=0.27, address=5811 N CHRISTOPHER DR, COEUR D ALENE, lat=47.724453, lon=-116.803995]
- **Wells**: ok. 53 well record(s), 5 of nearest 5 report depth [wellCount=53, nearestDepthsCount=5, nearestMi=0.74, medianDepthFt=330]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McGuire-Marble association, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=McGuire-Marble association, 0 to 7 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 4%, max 7.6% [gradePct=4, maxGradePct=7.6, reliefFt=7, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.5% [cellCount=16, avgSlopePct=5.5, maxSlopePct=12.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. R-12 (City of Coeur d'Alene) [code=R-12, jurisdiction=City of Coeur d'Alene, countyStatus=kootenai-city-zoning-v1, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $496,440, class 541 Imp res lot/tract in city, no tax amount [assessedValue=496440, landValue=195000, improvementValue=301440, taxPresent=false, netValue=371440, homeownerExemption=125000, taxYear=2026, propertyClass=541, propertyClassDescription=Imp res lot/tract in city, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47N02W035500 (MEDIMONT, 51.64 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | other/blank locality"; first in locality MEDIMONT. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 47N02W035500, 51.64 ac [parcelId=47N02W035500, acres=51.64, address=15047 E CAMERON RD, MEDIMONT, lat=47.453302, lon=-116.577746]
- **Wells**: ok. 40 well record(s), 5 of nearest 5 report depth [wellCount=40, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=262]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Cougarbay silt loam) [feasibility=limited, mapUnit=Cougarbay silt loam, hydrologicGroup=D, drainage=Very poorly drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 3.6%, max 10.1% [gradePct=3.6, maxGradePct=10.1, reliefFt=128, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.3% [cellCount=16, avgSlopePct=6.3, maxSlopePct=21.9, partial=false]
- **Flood**: ok. high-risk zone (A, X, AE) (via FEMA NFHL) [high=true, intersects=true, zones=A; X; AE, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 16 NWI feature(s) [intersects=true, count=16, coveragePct=70.5]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $449,687, class 534 Imp res rural tract, no tax amount [assessedValue=449687, landValue=328727, improvementValue=120960, taxPresent=false, netValue=367907, homeownerExemption=81780, taxYear=2026, propertyClass=534, propertyClassDescription=Imp res rural tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48N03W312100 (HARRISON, 65.33 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | city-named locality"; first in locality HARRISON. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 48N03W312100, 65.33 ac [parcelId=48N03W312100, acres=65.33, address=1561 E BELL CANYON RD, HARRISON, lat=47.462958, lon=-116.763586]
- **Wells**: ok. 40 well record(s), 5 of nearest 5 report depth [wellCount=40, nearestDepthsCount=5, nearestMi=0.33, medianDepthFt=280]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Aeric Fluvaquents-Typic Fluvaquents-Typic Haplosaprist association, 0 to 1 percent slopes) [feasibility=limited, mapUnit=Aeric Fluvaquents-Typic Fluvaquents-Typic Haplosaprist association, 0 to 1 percent slopes, hydrologicGroup=B/D, drainage=Very poorly drained, soilSlopePct=0]
- **Terrain**: ok. avg grade 2.2%, max 12.6% [gradePct=2.2, maxGradePct=12.6, reliefFt=161, sampleCount=9]
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. high-risk zone (AE, X) (via FEMA NFHL) [high=true, intersects=true, zones=AE; X, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=64.5]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $677,433, class 534 Imp res rural tract, no tax amount [assessedValue=677433, landValue=388853, improvementValue=288580, taxPresent=false, netValue=585993, homeownerExemption=0, taxYear=2026, propertyClass=534, propertyClassDescription=Imp res rural tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0K245001002B (RATHDRUM, 1.62 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | city-named locality"; first in locality RATHDRUM. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0K245001002B, 1.62 ac [parcelId=0K245001002B, acres=1.62, address=22311 N BIRDSONG LN, RATHDRUM, lat=47.874046, lon=-116.855048]
- **Wells**: ok. 81 well record(s), 5 of nearest 5 report depth [wellCount=81, nearestDepthsCount=5, nearestMi=0.24, medianDepthFt=540]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 2.3%, max 4.1% [gradePct=2.3, maxGradePct=4.1, reliefFt=20, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.8% [cellCount=16, avgSlopePct=3.8, maxSlopePct=8.2, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RESTRICTED RESIDENTIAL (Kootenai County) [code=RESTRICTED RESIDENTIAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $266,147, class 537 Imp res rural sub, no tax amount [assessedValue=266147, landValue=205887, improvementValue=60260, taxPresent=false, netValue=266147, homeownerExemption=0, taxYear=2026, propertyClass=537, propertyClassDescription=Imp res rural sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 49N03W324950 (no locality, 10 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 49N03W324950, 10 ac [parcelId=49N03W324950, acres=10, address=178640 UNKNOWN, lat=47.545631, lon=-116.757814]
- **Wells**: ok. 105 well record(s), 5 of nearest 5 report depth [wellCount=105, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=405]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Blinn loam, 35 to 65 percent slopes, very stony) [feasibility=limited, mapUnit=Blinn loam, 35 to 65 percent slopes, very stony, hydrologicGroup=C, drainage=Well drained, soilSlopePct=50]
- **Terrain**: ok. avg grade 13.9%, max 30.7% [gradePct=13.9, maxGradePct=30.7, reliefFt=246, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 25.5% [cellCount=16, avgSlopePct=25.5, maxSlopePct=34.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=2.3]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: ok. assessed $154,534, class 512 Rural residential tract, no tax amount [assessedValue=154534, landValue=154534, improvementValue=0, taxPresent=false, netValue=5660, homeownerExemption=0, taxYear=2026, propertyClass=512, propertyClassDescription=Rural residential tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 007740020050 (no locality, 0.58 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 007740020050, 0.58 ac [parcelId=007740020050, acres=0.58, lat=47.518447, lon=-116.870854]
- **Wells**: ok. 154 well record(s), 5 of nearest 5 report depth [wellCount=154, nearestDepthsCount=5, nearestMi=0.42, medianDepthFt=563]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Taney silt loam, 7 to 25 percent slopes) [feasibility=limited, mapUnit=Taney silt loam, 7 to 25 percent slopes, hydrologicGroup=C, drainage=Moderately well drained, soilSlopePct=16]
- **Terrain**: ok. avg grade 4%, max 6.8% [gradePct=4, maxGradePct=6.8, reliefFt=16, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 7% [cellCount=16, avgSlopePct=7, maxSlopePct=11.6, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: ok. assessed $95,000, class 515 Rural residential sub, no tax amount [assessedValue=95000, landValue=95000, improvementValue=0, taxPresent=false, netValue=95000, homeownerExemption=0, taxYear=2026, propertyClass=515, propertyClassDescription=Rural residential sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0K2660010030 (ATHOL, 4.95 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ATHOL. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0K2660010030, 4.95 ac [parcelId=0K2660010030, acres=4.95, address=25754 N CLASSIC DR, ATHOL, lat=47.905682, lon=-116.770423]
- **Wells**: ok. 86 well record(s), 5 of nearest 5 report depth [wellCount=86, nearestDepthsCount=5, nearestMi=0.02, medianDepthFt=460]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Kootenai gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Kootenai gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: error. USGS elevation was unavailable for 5 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 1.7% [cellCount=16, avgSlopePct=1.7, maxSlopePct=4.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RURAL (Kootenai County) [code=RURAL, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. R: Rural Lands (7 uses) [code=R, family=Rural Lands, useCount=7]
- **Assessment**: ok. assessed $635,039, class 537 Imp res rural sub, no tax amount [assessedValue=635039, landValue=343729, improvementValue=291310, taxPresent=false, netValue=510039, homeownerExemption=125000, taxYear=2026, propertyClass=537, propertyClassDescription=Imp res rural sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0153400A001A (POST FALLS, 9.52 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality POST FALLS. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0153400A001A, 9.52 ac [parcelId=0153400A001A, acres=9.52, address=8109 N DAISY LN, POST FALLS, lat=47.745887, lon=-116.866026]
- **Wells**: ok. 73 well record(s), 5 of nearest 5 report depth [wellCount=73, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=304]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Avonville fine gravelly silt loam, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=Avonville fine gravelly silt loam, 0 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 0.7%, max 1% [gradePct=0.7, maxGradePct=1, reliefFt=9, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 1.8% [cellCount=16, avgSlopePct=1.8, maxSlopePct=3.9, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $5,825,620, class 438 Com Imp rural subdiv, no tax amount [assessedValue=5825620, landValue=1919779, improvementValue=3905841, taxPresent=false, netValue=5825620, homeownerExemption=0, taxYear=2026, propertyClass=438, propertyClassDescription=Com Imp rural subdiv, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47N02W040800 (ST MARIES, 99.74 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ST MARIES. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 47N02W040800, 99.74 ac [parcelId=47N02W040800, acres=99.74, address=31645 S HIGHWAY 3, ST MARIES, lat=47.458258, lon=-116.597619]
- **Wells**: ok. 60 well record(s), 5 of nearest 5 report depth [wellCount=60, nearestDepthsCount=5, nearestMi=0.15, medianDepthFt=205]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Lacy-Bobbitt association, 5 to 35 percent slopes, very stony) [feasibility=limited, mapUnit=Lacy-Bobbitt association, 5 to 35 percent slopes, very stony, hydrologicGroup=D, drainage=Well drained, soilSlopePct=20]
- **Terrain**: error. USGS elevation was unavailable for 9 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. high-risk zone (X, AE) (via FEMA NFHL) [high=true, intersects=true, zones=X; AE, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=3.4]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. AGRICULTURE (Kootenai County) [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $549,398, class 534 Imp res rural tract, no tax amount [assessedValue=549398, landValue=472598, improvementValue=76800, taxPresent=false, netValue=442326, homeownerExemption=107072, taxYear=2026, propertyClass=534, propertyClassDescription=Imp res rural tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### C72150040140 (COEUR D ALENE, 0.23 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): fills remaining sample slots. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel C72150040140, 0.23 ac [parcelId=C72150040140, acres=0.23, address=5726 N CHRISTOPHER DR, COEUR D ALENE, lat=47.723551, lon=-116.803077]
- **Wells**: ok. 55 well record(s), 5 of nearest 5 report depth [wellCount=55, nearestDepthsCount=5, nearestMi=0.77, medianDepthFt=300]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McGuire-Marble association, 0 to 7 percent slopes) [feasibility=favorable, mapUnit=McGuire-Marble association, 0 to 7 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 3.4%, max 13.6% [gradePct=3.4, maxGradePct=13.6, reliefFt=11, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.6% [cellCount=16, avgSlopePct=6.6, maxSlopePct=22.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. R-12 (City of Coeur d'Alene) [code=R-12, jurisdiction=City of Coeur d'Alene, countyStatus=kootenai-city-zoning-v1, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $533,760, class 541 Imp res lot/tract in city, no tax amount [assessedValue=533760, landValue=195000, improvementValue=338760, taxPresent=false, netValue=408760, homeownerExemption=125000, taxYear=2026, propertyClass=541, propertyClassDescription=Imp res lot/tract in city, source=Kootenai County Assessor (Assessor_Layers)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
