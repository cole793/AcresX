# County validation: Spokane, WA

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-04T20:37:06.681Z
- Parcels: 12, with an error or mismatch: 7
- Layer results: ok 141, unavailable 15, error 12, mismatch 0, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35204.2729 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 35234.0602 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 13013.2211 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 57344.0125 | ok | ok | ok | ok | error | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 43341.0110 | ok | ok | ok | ok | error | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 47071.9003 | ok | ok | ok | ok | error | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 46301.9025 | ok | ok | ok | ok | error | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 57302.9016 | ok | ok | ok | ok | error | error | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 37094.9101 | ok | ok | ok | ok | error | ok | ok | ok | ok | error | ok | ok | ok | unavailable |
| 48121.9001 | ok | ok | ok | ok | error | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 48136.9052 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 32322.9002 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |

## Parcel details

### 35204.2729 (City of Spokane, 0.14 ac)

Why: Small lot inside the City of Spokane (picked by discovery 2026-11-02, seed 42, stratum "under 1 ac | city-named locality"). Spokane County's zoning layer has no polygon here (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.390737,47.644811&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false returns no features); the City of Spokane's own zoning layer says R1 Residential 1 (https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5/query?f=json&geometry=-117.390737,47.644811&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZoneLabel,ZoneCode,ZoneDesc,ZoneGen&returnGeometry=false, checked 2026-11-02; this is the layer src/counties/spokane-cities.js reads, code from ZoneLabel). The jurisdiction comes from the City of Spokane zoning added in PR #32.

- **Parcel**: ok. parcel 35204.2729, 0.14 ac (mapped) [parcelId=35204.2729, acres=0.14, address=1317 E 12TH AVE, SPOKANE, lat=47.644811, lon=-117.390737, acresSource=mapped outline]
- **Wells**: ok. 1877 well record(s), 5 of nearest 5 report depth [wellCount=1877, nearestDepthsCount=5, nearestMi=0.28, medianDepthFt=30]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Urban land-Lakespring, disturbed complex, 3 to 8 percent slopes) [feasibility=moderate, mapUnit=Urban land-Lakespring, disturbed complex, 3 to 8 percent slopes, soilSlopePct=3]
- **Terrain**: ok. avg grade 2%, max 4.1% [gradePct=2, maxGradePct=4.1, reliefFt=4, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.5% [cellCount=16, avgSlopePct=3.5, maxSlopePct=5.4, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. MODERN ELECTRIC WATER COMPANY [providers=MODERN ELECTRIC WATER COMPANY]
- **Power**: ok. MODERN ELECTRIC WATER COMPANY [provider=MODERN ELECTRIC WATER COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. R1 (City of Spokane) [code=R1, jurisdiction=City of Spokane, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=72900, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 35234.0602 (City of Spokane Valley, 0.42 ac)

Why: Small lot inside the City of Spokane Valley (5407 E 16th Ave). No county zoning polygon at the centroid (-117.331914,47.642933); the city's layer used by src/counties/spokane-cities.js says R-3, Single-Family Residential (R-3) (https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1/query?f=json&geometry=-117.331914,47.642933&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Zoning,Zoning_Desg&returnGeometry=false, checked 2026-11-02).

- **Parcel**: ok. parcel 35234.0602, 0.42 ac (mapped) [parcelId=35234.0602, acres=0.42, address=5407 E 16TH AVE, SPOKANE VALLEY, 99212, lat=47.642933, lon=-117.331914, acresSource=mapped outline]
- **Wells**: ok. 1891 well record(s), 5 of nearest 5 report depth [wellCount=1891, nearestDepthsCount=5, nearestMi=0.2, medianDepthFt=25]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Urban land-Lenz, disturbed complex, 3 to 15 percent slopes) [feasibility=moderate, mapUnit=Urban land-Lenz, disturbed complex, 3 to 15 percent slopes, soilSlopePct=5]
- **Terrain**: ok. avg grade 4.9%, max 8.7% [gradePct=4.9, maxGradePct=8.7, reliefFt=9, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 7.3% [cellCount=16, avgSlopePct=7.3, maxSlopePct=14.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. R-3 (City of Spokane Valley) [code=R-3, jurisdiction=City of Spokane Valley, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=110000, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 13013.2211 (City of Cheney, 0.16 ac)

Why: Small lot inside the City of Cheney (3175 Pheasant St). No county zoning polygon at the centroid (-117.575987,47.510249), so city zoning applies. The City of Cheney layer used by src/counties/spokane-cities.js says R-1, Single Family Residential (https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/3/query?f=json&geometry=-117.575987,47.510249&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZoneCODE,ZONE&returnGeometry=false, checked 2026-11-02).

- **Parcel**: ok. parcel 13013.2211, 0.16 ac (mapped) [parcelId=13013.2211, acres=0.16, address=3175 PHEASANT ST, CHENEY, lat=47.510249, lon=-117.575987, acresSource=mapped outline]
- **Wells**: ok. 353 well record(s), 5 of nearest 5 report depth [wellCount=353, nearestDepthsCount=5, nearestMi=0.13, medianDepthFt=145]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. favorable (Cheney ashy silt loam, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Cheney ashy silt loam, 0 to 8 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=3]
- **Terrain**: ok. avg grade 3.3%, max 5.9% [gradePct=3.3, maxGradePct=5.9, reliefFt=5, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.7% [cellCount=16, avgSlopePct=6.7, maxSlopePct=13.1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. CITY OF CHENEY - (WA) [providers=CITY OF CHENEY - (WA)]
- **Power**: ok. CITY OF CHENEY - (WA) [provider=CITY OF CHENEY - (WA), confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. R-1 (City of Cheney) [code=R-1, jurisdiction=City of Cheney, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=100000, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 57344.0125 (Newman Lake, 0.45 ac, flood AE, wetlands)

Why: Small unincorporated lot with a FEMA high-risk zone and mapped NWI wetlands (picked by discovery 2026-11-02, seed 42). Zoning RCV Rural Conservation from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.095636,47.787979&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). Flood AE (SFHA) and X on the parcel outline from FEMA NFHL (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, geometryType=esriGeometryPolygon with the statewide parcel outline, outFields=FLD_ZONE,SFHA_TF; DFIRM 53063C). Checked 2026-11-02.

- **Parcel**: ok. parcel 57344.0125, 0.45 ac (mapped) [parcelId=57344.0125, acres=0.45, address=14324 N MEADOW LN, NEWMAN LAKE, lat=47.787979, lon=-117.095636, acresSource=mapped outline]
- **Wells**: ok. 193 well record(s), 5 of nearest 5 report depth [wellCount=193, nearestDepthsCount=5, nearestMi=0.14, medianDepthFt=360]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. favorable (Bouldercreek ashy silt loam, moist, 3 to 15 percent slopes) [feasibility=favorable, mapUnit=Bouldercreek ashy silt loam, moist, 3 to 15 percent slopes, hydrologicGroup=A, drainage=Well drained, soilSlopePct=8]
- **Terrain**: error. USGS elevation was unavailable for 9 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. high-risk zone (AE, X) (via FEMA NFHL) [high=true, intersects=true, zones=AE; X, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=14]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RCV (Spokane County) [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=387870, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 43341.0110 (unincorporated, 1.5 ac, LTA, wetlands)

Why: Unincorporated 1-5 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning LTA Large Tract Agricultural from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.217847,47.448652&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02. Only flood.high is expected: when NFHL doesn't answer, the Esri fallback holds high/moderate-risk zones only and returns no X.

- **Parcel**: ok. parcel 43341.0110, 1.5 ac (mapped) [parcelId=43341.0110, acres=1.5, address=22522 S DARKNELL RD, SPOKANE, lat=47.448652, lon=-117.217847, acresSource=mapped outline]
- **Wells**: ok. 39 well record(s), 5 of nearest 5 report depth [wellCount=39, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=160]
- **Existing well**: ok. Possible well association [status=possible_match, confidence=Low, score=45]
- **Soil**: ok. moderate (Glenrose ashy silt loam, 8 to 25 percent slopes) [feasibility=moderate, mapUnit=Glenrose ashy silt loam, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=15]
- **Terrain**: error. USGS elevation was unavailable for 7 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 5.6% [cellCount=16, avgSlopePct=5.6, maxSlopePct=11.1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=7]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. LTA (Spokane County) [code=LTA, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. LTA: Resource Lands (8 uses) [code=LTA, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=99990, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47071.9003 (Chattaroy, 2.32 ac, RT)

Why: Unincorporated 1-5 ac parcel (picked by discovery 2026-11-02, seed 42; its lookup timed out in that run). County zoning RT Rural Traditional at the centroid (-117.293144,47.859658).

- **Parcel**: ok. parcel 47071.9003, 2.32 ac (mapped) [parcelId=47071.9003, acres=2.32, address=8316 E BIG MEADOWS RD, CHATTAROY, 99003, lat=47.859658, lon=-117.293144, acresSource=mapped outline]
- **Wells**: ok. 232 well record(s), 5 of nearest 5 report depth [wellCount=232, nearestDepthsCount=5, nearestMi=0.18, medianDepthFt=448]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Lenz-Spokane complex, 3 to 15 percent slopes) [feasibility=moderate, mapUnit=Lenz-Spokane complex, 3 to 15 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=9]
- **Terrain**: error. USGS elevation was unavailable for 8 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RT (Spokane County) [code=RT, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RT: Rural (10 uses) [code=RT, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=114050, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 46301.9025 (no situs city, 4.62 ac, RCV)

Why: Unincorporated 1-5 ac parcel with a blank situs city (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 46301.9025, 4.61 ac (mapped) [parcelId=46301.9025, acres=4.61, lat=47.728449, lon=-117.28887, acresSource=mapped outline]
- **Wells**: ok. 310 well record(s), 5 of nearest 5 report depth [wellCount=310, nearestDepthsCount=5, nearestMi=0.19, medianDepthFt=265]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=12]
- **Soil**: ok. favorable (Scrabblers ashy fine sandy loam, 3 to 8 percent slopes) [feasibility=favorable, mapUnit=Scrabblers ashy fine sandy loam, 3 to 8 percent slopes, hydrologicGroup=A, drainage=Well drained, soilSlopePct=5]
- **Terrain**: error. USGS elevation was unavailable for 8 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RCV (Spokane County) [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=199510, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 57302.9016 (Mead, 9.78 ac, RCV, wetlands)

Why: Unincorporated 5-40 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning RCV from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.173978,47.813929&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02. Only flood.high is expected: on 2026-11-02 NFHL didn't answer for this parcel and the Esri fallback (high/moderate-risk zones only) returned no zones.

- **Parcel**: ok. parcel 57302.9016, 9.77 ac (mapped) [parcelId=57302.9016, acres=9.77, address=17238 N MOUNTAIN TOP LN, MEAD, lat=47.813929, lon=-117.173978, acresSource=mapped outline]
- **Wells**: ok. 181 well record(s), 5 of nearest 5 report depth [wellCount=181, nearestDepthsCount=5, nearestMi=0.21, medianDepthFt=345]
- **Existing well**: ok. Likely existing well [status=strong_match, confidence=High, score=100]
- **Soil**: ok. limited (Quinnamose-Micapeak complex, 30 to 55 percent slopes) [feasibility=limited, mapUnit=Quinnamose-Micapeak complex, 30 to 55 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=42]
- **Terrain**: error. USGS elevation was unavailable for 7 of 9 terrain points.
- **Slope grid**: error. Not enough elevation samples were returned to build a reliable slope heat map. Try again shortly.
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=2.8]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RCV (Spokane County) [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=125010, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 37094.9101 (Spokane situs, 5 ac, RCV)

Why: 5-40 ac parcel with a SPOKANE situs city that is outside city limits (county zoning RCV), picked by discovery 2026-11-02, seed 42. Shows the situs city is not the jurisdiction.

- **Parcel**: ok. parcel 37094.9101, 5 ac (mapped) [parcelId=37094.9101, acres=5, address=2211 E WHISPERING SPRING LN, SPOKANE, 00000, lat=47.849368, lon=-117.37833, acresSource=mapped outline]
- **Wells**: ok. 285 well record(s), 5 of nearest 5 report depth [wellCount=285, nearestDepthsCount=5, nearestMi=0.16, medianDepthFt=178]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. favorable (Wapal gravelly ashy coarse sandy loam, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Wapal gravelly ashy coarse sandy loam, 0 to 8 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: error. USGS elevation was unavailable for 9 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 1.6% [cellCount=16, avgSlopePct=1.6, maxSlopePct=8.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: error. timeout after 30s
- **Zoning**: ok. RCV (Spokane County) [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=245000, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48121.9001 (Elk, 154 ac, FZ, wetlands)

Why: Unincorporated 40+ ac forest parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning FZ Forest Land from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.177199,47.944269&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02.

- **Parcel**: ok. parcel 48121.9001, 153.95 ac (mapped) [parcelId=48121.9001, acres=153.95, address=ELK, 99009, lat=47.943689, lon=-117.177668, acresSource=mapped outline]
- **Wells**: ok. 49 well record(s), 5 of nearest 5 report depth [wellCount=49, nearestDepthsCount=5, nearestMi=0.49, medianDepthFt=400]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. limited (Keeler-Kruse complex, 15 to 30 percent slopes) [feasibility=limited, mapUnit=Keeler-Kruse complex, 15 to 30 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=23]
- **Terrain**: error. USGS elevation was unavailable for 5 of 9 terrain points.
- **Slope grid**: ok. 16 cells, avg 19.4% [cellCount=16, avgSlopePct=19.4, maxSlopePct=41.4, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 3 NWI feature(s) [intersects=true, count=3, coveragePct=0.6]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. FZ (Spokane County) [code=FZ, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. FZ: Resource Lands (8 uses) [code=FZ, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=591360, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48136.9052 (Colbert, 51.9 ac, RCV, wetlands)

Why: Unincorporated 40+ ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42).

- **Parcel**: ok. parcel 48136.9052, 51.87 ac (mapped) [parcelId=48136.9052, acres=51.87, address=15510 E DEER CREEK RD, COLBERT, lat=47.928279, lon=-117.194683, acresSource=mapped outline]
- **Wells**: ok. 68 well record(s), 5 of nearest 5 report depth [wellCount=68, nearestDepthsCount=5, nearestMi=0.25, medianDepthFt=300]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=12]
- **Soil**: ok. limited (Blackprince-Ardtoo complex, 15 to 30 percent slopes) [feasibility=limited, mapUnit=Blackprince-Ardtoo complex, 15 to 30 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=22]
- **Terrain**: ok. avg grade 7%, max 15.8% [gradePct=7, maxGradePct=15.8, reliefFt=147, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 12.3% [cellCount=16, avgSlopePct=12.3, maxSlopePct=22.2, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=3.7]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. RCV (Spokane County) [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=283740, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 32322.9002 (Spangle, 157.8 ac, LTA)

Why: Unincorporated 40+ ac farm parcel (picked by discovery 2026-11-02, seed 42; its lookup timed out in that run). County zoning LTA at the centroid (-117.408960,47.357265).

- **Parcel**: ok. parcel 32322.9002, 157.71 ac (mapped) [parcelId=32322.9002, acres=157.71, address=SPANGLE, 99031, lat=47.357265, lon=-117.40896, acresSource=mapped outline]
- **Wells**: ok. 26 well record(s), 5 of nearest 5 report depth [wellCount=26, nearestDepthsCount=5, nearestMi=1.13, medianDepthFt=200]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. moderate (Naff-Thatuna complex, 8 to 25 percent slopes) [feasibility=moderate, mapUnit=Naff-Thatuna complex, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=15]
- **Terrain**: ok. avg grade 1%, max 1.8% [gradePct=1, maxGradePct=1.8, reliefFt=30, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.3% [cellCount=16, avgSlopePct=3.3, maxSlopePct=5.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=1.2]
- **Utility**: ok. BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY [providers=BONNEVILLE POWER ADMINISTRATION; AVISTA CORP; INLAND POWER & LIGHT COMPANY]
- **Power**: ok. BONNEVILLE POWER ADMINISTRATION [provider=BONNEVILLE POWER ADMINISTRATION, confidence=low, distributionStatus=no_verified_distance]
- **Zoning**: ok. LTA (Spokane County) [code=LTA, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: ok. LTA: Resource Lands (8 uses) [code=LTA, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed n/a, no tax amount [landValue=503410, taxPresent=false, source=Spokane County Assessor SCOUTSimple]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
