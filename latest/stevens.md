# County validation: Stevens, WA

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-05T20:54:03.316Z
- Parcels: 12, with an error or mismatch: 7
- Layer results: ok 117, unavailable 42, error 9, mismatch 0, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8974701 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 0763202 | ok | ok | unavailable | ok | ok | ok | ok | ok | unavailable | unavailable | ok | unavailable | unavailable | unavailable |
| 0231200 | ok | ok | unavailable | ok | ok | error | ok | ok | ok | ok | unavailable | unavailable | unavailable | unavailable |
| 0000500 | ok | ok | unavailable | ok | error | error | ok | ok | ok | ok | ok | unavailable | unavailable | unavailable |
| 2371220 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 2378200 | ok | ok | unavailable | ok | error | error | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 2214900 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 2611300 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 8673053 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 2342700 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 5320900 | ok | ok | unavailable | ok | error | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |
| 5317201 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable |

## Parcel details

### 8974701 (unincorporated, 0.75 ac, RA-5)

Why: Small unincorporated lot with a blank situs city (picked by discovery 2026-11-02, seed 42). Stevens County zoning layer: zoning=5, zoningtext RA-5 (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/1/query?f=json&geometry=-118.105897,48.629028&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=zoning,zoningtext,name,type,zoning_nam&returnGeometry=false). The zoning-permits code is the layer's numeric renderer value (5); /api/zoning-rules maps it to RA-5. No Stevens panels in FEMA NFHL (no DFIRM 53065C features), so no high-risk zone. Checked 2026-11-02.

- **Parcel**: ok. parcel 8974701, 0.75 ac (mapped) [parcelId=8974701, acres=0.75, lat=48.629028, lon=-118.105897, acresSource=mapped outline]
- **Wells**: ok. 241 well record(s), 5 of nearest 5 report depth [wellCount=241, nearestDepthsCount=5, nearestMi=0.53, medianDepthFt=45]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Dart loamy coarse sand, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Dart loamy coarse sand, 0 to 8 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: error. USGS elevation was unavailable for 9 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 3.1% [cellCount=16, avgSlopePct=3.1, maxSlopePct=7.4, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 5 (Stevens County (unincorporated areas)) [code=5, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-5: Rural (6 uses) [code=RA-5, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0763202 (Nine Mile Falls, 0.92 ac, Lake Spokane LAMIRD)

Why: Small unincorporated lot in the Lake Spokane LAMIRD (picked by discovery 2026-11-02, seed 42). County layer: zoning=0, type R-1 Residential, zoning_nam Lake Spokane R-1 Residential at -117.644634,47.839242. AcresX returns code 0 and zoning rules zone_not_mapped (finding, not recorded as expected).

- **Parcel**: ok. parcel 0763202, 0.92 ac (mapped) [parcelId=0763202, acres=0.92, address=6474 SHENEEN CT, NINE MILE FALLS, 99026, lat=47.839242, lon=-117.644634, acresSource=mapped outline]
- **Wells**: ok. 141 well record(s), 5 of nearest 5 report depth [wellCount=141, nearestDepthsCount=5, nearestMi=0.12, medianDepthFt=143]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Dart loamy coarse sand, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Dart loamy coarse sand, 0 to 8 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 0.4%, max 0.7% [gradePct=0.4, maxGradePct=0.7, reliefFt=2, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.7% [cellCount=16, avgSlopePct=0.7, maxSlopePct=1.1, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: unavailable. No mapped retail electric service territory intersected the parcel center. [providers=(none)]
- **Power**: unavailable. not requested: no utility provider identified (the browser skips this call too)
- **Zoning**: ok. 0 (Stevens County (unincorporated areas)) [code=0, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0231200 (City of Chewelah, 0.12 ac)

Why: Small lot inside Chewelah city limits (picked by discovery 2026-11-02, seed 42). Stevens Cities layer at -117.72695,48.276834 returns Chewelah (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/0/query?f=json&geometry=-117.72695,48.276834&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=name&returnGeometry=false); the county zoning layer has no polygon there.

- **Parcel**: ok. parcel 0231200, 0.12 ac (mapped) [parcelId=0231200, acres=0.12, address=107 N BERNARD ST, CHEWELAH, 99109, lat=48.276834, lon=-117.72695, acresSource=mapped outline]
- **Wells**: ok. 178 well record(s), 5 of nearest 5 report depth [wellCount=178, nearestDepthsCount=5, nearestMi=0.43, medianDepthFt=39]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Chewelah fine sandy loam) [feasibility=limited, mapUnit=Chewelah fine sandy loam, hydrologicGroup=C, drainage=Somewhat poorly drained, soilSlopePct=2]
- **Terrain**: ok. avg grade 0.9%, max 2.8% [gradePct=0.9, maxGradePct=2.8, reliefFt=1, sampleCount=9]
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. CITY OF CHEWELAH [providers=CITY OF CHEWELAH]
- **Power**: ok. CITY OF CHEWELAH [provider=CITY OF CHEWELAH, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: unavailable. No mapped result [jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=no_match, permitHistoryStatus=not_configured]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0000500 (City of Colville, 0.16 ac)

Why: Small lot inside Colville city limits (315 N Main St). Stevens Cities layer at -117.9063,48.54675 returns Colville (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/0/query?f=json&geometry=-117.9063,48.54675&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=name&returnGeometry=false). Checked 2026-11-02.

- **Parcel**: ok. parcel 0000500, 0.16 ac (mapped) [parcelId=0000500, acres=0.16, address=315 N MAIN ST, COLVILLE, 99114, lat=48.546746, lon=-117.906299, acresSource=mapped outline]
- **Wells**: ok. 393 well record(s), 5 of nearest 5 report depth [wellCount=393, nearestDepthsCount=5, nearestMi=0.11, medianDepthFt=16]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Hodgson silt loam, 3 to 15 percent slopes) [feasibility=moderate, mapUnit=Hodgson silt loam, 3 to 15 percent slopes, hydrologicGroup=C, drainage=Moderately well drained, soilSlopePct=9]
- **Terrain**: error. USGS elevation was unavailable for 5 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. C-2 (Stevens County (unincorporated areas)) [code=C-2, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 2371220 (Northport situs, 4.44 ac, RA-10, wetlands)

Why: Unincorporated 1-5 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). County zoning layer: zoning=10, zoningtext RA-10 (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/1/query?f=json&geometry=-117.805819,48.913054&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=zoning,zoningtext,name,type,zoning_nam&returnGeometry=false). No Stevens panels in FEMA NFHL. Checked 2026-11-02.

- **Parcel**: ok. parcel 2371220, 4.43 ac (mapped) [parcelId=2371220, acres=4.43, address=4254 NORTHPORT FLAT CREEK RD, NORTHPORT, 99157, lat=48.913054, lon=-117.805819, acresSource=mapped outline]
- **Wells**: ok. 67 well record(s), 5 of nearest 5 report depth [wellCount=67, nearestDepthsCount=5, nearestMi=0.12, medianDepthFt=210]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Springdale sandy loam, 0 to 15 percent slopes) [feasibility=favorable, mapUnit=Springdale sandy loam, 0 to 15 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=8]
- **Terrain**: ok. avg grade 12.9%, max 24.1% [gradePct=12.9, maxGradePct=24.1, reliefFt=190, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 20.6% [cellCount=16, avgSlopePct=20.6, maxSlopePct=31.2, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 2 NWI feature(s) [intersects=true, count=2, coveragePct=7.8]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 10 (Stevens County (unincorporated areas)) [code=10, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-10: Rural (6 uses) [code=RA-10, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 2378200 (Kettle Falls situs, 2.28 ac, RA-20/RA-10 boundary, wetlands)

Why: Unincorporated 1-5 ac parcel with a city-named situs (picked by discovery 2026-11-02, seed 42). Its centroid sits on an RA-20/RA-10 district boundary: the county zoning layer answers RA-10 at -117.903489,48.873808 and RA-20 at -117.9034,48.8738 (MapServer/1, checked 2026-11-02); AcresX reported 20 (RA-20). No expected value because the answer depends on the exact point.

- **Parcel**: ok. parcel 2378200, 2.27 ac (mapped) [parcelId=2378200, acres=2.27, address=3600 NORTHPORT FLAT CREEK RD, KETTLE FALLS, 99141, lat=48.873808, lon=-117.903489, acresSource=mapped outline]
- **Wells**: ok. 75 well record(s), 5 of nearest 5 report depth [wellCount=75, nearestDepthsCount=5, nearestMi=0.02, medianDepthFt=280]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Stevens channery silt loam, 8 to 25 percent slopes) [feasibility=limited, mapUnit=Stevens channery silt loam, 8 to 25 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=17]
- **Terrain**: error. USGS elevation was unavailable for 8 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=1]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 10 (Stevens County (unincorporated areas)) [code=10, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-10: Rural (6 uses) [code=RA-10, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 2214900 (Addy, 1.01 ac, RA-5, wetlands)

Why: Unincorporated 1-5 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 2214900, 1.01 ac (mapped) [parcelId=2214900, acres=1.01, address=2154 SWISS VALLEY RD, ADDY, 99101, lat=48.402122, lon=-117.938815, acresSource=mapped outline]
- **Wells**: ok. 94 well record(s), 5 of nearest 5 report depth [wellCount=94, nearestDepthsCount=5, nearestMi=0.15, medianDepthFt=200]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Aits loam, 0 to 15 percent slopes) [feasibility=favorable, mapUnit=Aits loam, 0 to 15 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=8]
- **Terrain**: error. USGS elevation was unavailable for 7 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 8.9% [cellCount=16, avgSlopePct=8.9, maxSlopePct=21.4, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 2 NWI feature(s) [intersects=true, count=2, coveragePct=9]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 5 (Stevens County (unincorporated areas)) [code=5, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-5: Rural (6 uses) [code=RA-5, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 2611300 (Chewelah situs, 5.94 ac, RA-5, wetlands)

Why: Unincorporated 5-40 ac parcel with a city-named situs (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 2611300, 5.94 ac (mapped) [parcelId=2611300, acres=5.94, address=2760 CLARKE RD, CHEWELAH, 99109, lat=48.239095, lon=-117.765822, acresSource=mapped outline]
- **Wells**: ok. 114 well record(s), 5 of nearest 5 report depth [wellCount=114, nearestDepthsCount=5, nearestMi=0.05, medianDepthFt=142]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Martella ashy silt loam, 5 to 15 percent slopes) [feasibility=moderate, mapUnit=Martella ashy silt loam, 5 to 15 percent slopes, hydrologicGroup=C, drainage=Moderately well drained, soilSlopePct=10]
- **Terrain**: ok. avg grade 6.1%, max 11.4% [gradePct=6.1, maxGradePct=11.4, reliefFt=54, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 8.8% [cellCount=16, avgSlopePct=8.8, maxSlopePct=17.6, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=29]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 5 (Stevens County (unincorporated areas)) [code=5, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-5: Rural (6 uses) [code=RA-5, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 8673053 (unincorporated, 17 ac, RA-5, wetlands)

Why: Unincorporated 5-40 ac parcel with a blank situs city (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 8673053, 17.04 ac (mapped) [parcelId=8673053, acres=17.04, lat=48.316615, lon=-117.816856, acresSource=mapped outline]
- **Wells**: ok. 84 well record(s), 5 of nearest 5 report depth [wellCount=84, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=178]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Hodgson silt loam, 15 to 25 percent slopes) [feasibility=limited, mapUnit=Hodgson silt loam, 15 to 25 percent slopes, hydrologicGroup=C, drainage=Moderately well drained, soilSlopePct=20]
- **Terrain**: error. USGS elevation was unavailable for 9 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 8.5% [cellCount=16, avgSlopePct=8.5, maxSlopePct=26.7, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 11 NWI feature(s) [intersects=true, count=11, coveragePct=33.5]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 5 (Stevens County (unincorporated areas)) [code=5, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-5: Rural (6 uses) [code=RA-5, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 2342700 (Colville situs, 290 ac, AR-10, wetlands)

Why: Unincorporated 40+ ac parcel (picked by discovery 2026-11-02, seed 42). County zoning layer: zoning=103, zoningtext AR-10 (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/1/query?f=json&geometry=-117.907408,48.662211&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=zoning,zoningtext,name,type,zoning_nam&returnGeometry=false). Checked 2026-11-02.

- **Parcel**: ok. parcel 2342700, 290.23 ac (mapped) [parcelId=2342700, acres=290.23, address=987 C GILLETTE RD, COLVILLE, 99114, lat=48.662211, lon=-117.907408, acresSource=mapped outline]
- **Wells**: ok. 61 well record(s), 5 of nearest 5 report depth [wellCount=61, nearestDepthsCount=5, nearestMi=1.14, medianDepthFt=200]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Aits loam, 15 to 25 percent slopes) [feasibility=limited, mapUnit=Aits loam, 15 to 25 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=20]
- **Terrain**: ok. avg grade 5.6%, max 12.8% [gradePct=5.6, maxGradePct=12.8, reliefFt=243, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 13.4% [cellCount=16, avgSlopePct=13.4, maxSlopePct=30.4, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 4 NWI feature(s) [intersects=true, count=4, coveragePct=1.1]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 103 (Stevens County (unincorporated areas)) [code=103, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. AR-10: Resource (6 uses) [code=AR-10, family=Resource, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 5320900 (Loon Lake, 190 ac, RA-10, wetlands)

Why: Unincorporated 40+ ac parcel (picked by discovery 2026-11-02, seed 42). County zoning layer: zoning=10, zoningtext RA-10 (https://gis.stevenscountywa.gov/server/rest/services/Stevens_County_Zoning_Data/MapServer/1/query?f=json&geometry=-117.570428,48.174436&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=zoning,zoningtext,name,type,zoning_nam&returnGeometry=false). No Stevens panels in FEMA NFHL. Checked 2026-11-02.

- **Parcel**: ok. parcel 5320900, 189.94 ac (mapped) [parcelId=5320900, acres=189.94, address=4274 GROUSE CREEK RD, LOON LAKE, 99148, lat=48.174436, lon=-117.570428, acresSource=mapped outline]
- **Wells**: ok. 42 well record(s), 5 of nearest 5 report depth [wellCount=42, nearestDepthsCount=5, nearestMi=0.36, medianDepthFt=460]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Bridgeson silt loam, drained) [feasibility=limited, mapUnit=Bridgeson silt loam, drained, hydrologicGroup=C, drainage=Somewhat poorly drained, soilSlopePct=2]
- **Terrain**: error. USGS elevation was unavailable for 5 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 14.8% [cellCount=16, avgSlopePct=14.8, maxSlopePct=35.6, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 15 NWI feature(s) [intersects=true, count=15, coveragePct=24]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 10 (Stevens County (unincorporated areas)) [code=10, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-10: Rural (6 uses) [code=RA-10, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 5317201 (Valley, 54.9 ac, RA-5, wetlands)

Why: Unincorporated 40+ ac parcel (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 5317201, 54.8 ac (mapped) [parcelId=5317201, acres=54.8, address=3308 B SKOK RD, VALLEY, 99181, lat=48.174322, lon=-117.661892, acresSource=mapped outline]
- **Wells**: ok. 77 well record(s), 5 of nearest 5 report depth [wellCount=77, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=140]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Aits stony loam, 40 to 65 percent slopes) [feasibility=limited, mapUnit=Aits stony loam, 40 to 65 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=53]
- **Terrain**: ok. avg grade 6.5%, max 14.7% [gradePct=6.5, maxGradePct=14.7, reliefFt=315, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 21.8% [cellCount=16, avgSlopePct=21.8, maxSlopePct=53, partial=false]
- **Flood**: ok. no mapped FEMA zone (via FEMA NFHL) [high=false, intersects=false, zones=(none), category=not_mapped, provider=FEMA NFHL]
- **Wetlands**: ok. 2 NWI feature(s) [intersects=true, count=2, coveragePct=1.5]
- **Utility**: ok. AVISTA CORP [providers=AVISTA CORP]
- **Power**: ok. AVISTA CORP [provider=AVISTA CORP, confidence=low, distributionStatus=not_publicly_mapped]
- **Zoning**: ok. 5 (Stevens County (unincorporated areas)) [code=5, jurisdiction=Stevens County (unincorporated areas), countyStatus=configured, zoningStatus=gis_match, permitHistoryStatus=not_configured]
- **Zoning rules**: ok. RA-5: Rural (6 uses) [code=RA-5, family=Rural, useCount=6]
- **Assessment**: unavailable. no assessment source for this county (Property assessment endpoint currently supports Spokane County WA, Montana, and Idaho.)
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
