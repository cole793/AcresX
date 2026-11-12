# County validation: Spokane, WA

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-12T20:58:23.771Z
- Parcels: 12, with an error or mismatch: 1
- Layer results: ok 164, unavailable 15, error 0, mismatch 1, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Public water/sewer | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35204.2729 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 35234.0602 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | mismatch | unavailable | ok | unavailable |
| 13013.2211 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 57344.0125 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 43341.0110 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 47071.9003 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 46301.9025 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 57302.9016 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 37094.9101 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 48121.9001 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 48136.9052 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 32322.9002 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |

## Parcel details

### 35204.2729 (City of Spokane, 0.14 ac)

Why: Small lot inside the City of Spokane (picked by discovery 2026-11-02, seed 42, stratum "under 1 ac | city-named locality"). Spokane County's zoning layer has no polygon here (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.390737,47.644811&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false returns no features); the City of Spokane's own zoning layer says R1 Residential 1 (https://services.arcgis.com/3PDwyTturHqnGCu0/arcgis/rest/services/Zoning/FeatureServer/5/query?f=json&geometry=-117.390737,47.644811&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZoneLabel,ZoneCode,ZoneDesc,ZoneGen&returnGeometry=false, checked 2026-11-02; this is the layer src/counties/spokane-cities.js reads, code from ZoneLabel). The jurisdiction comes from the City of Spokane zoning added in PR #32. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): WA DOH service area 'SPOKANE CITY OF' (Group A, Comm, Active); City of Spokane Water_Main/2 distribution main 6.6 m and Sewer_Gravity_Main/1 main 9.1 m from the outline. Assessor property class 77 Churches hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=35204.2729, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2735204.2729%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 35204.2729, 0.14 ac [parcelId=35204.2729, acres=0.14, address=1317 E 12TH AVE, SPOKANE, lat=47.644811, lon=-117.390737]
- **Wells**: ok. 1879 well record(s), 5 of nearest 5 report depth [wellCount=1879, nearestDepthsCount=5, nearestMi=0.28, medianDepthFt=30]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Urban land-Lakespring, disturbed complex, 3 to 8 percent slopes) [feasibility=moderate, mapUnit=Urban land-Lakespring, disturbed complex, 3 to 8 percent slopes, soilSlopePct=3]
- **Terrain**: ok. avg grade 2%, max 4.1% [gradePct=2, maxGradePct=4.1, reliefFt=4, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.6% [cellCount=16, avgSlopePct=3.6, maxSlopePct=5.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP; MODERN ELECTRIC WATER COMPANY [providers=AVISTA CORP; MODERN ELECTRIC WATER COMPANY]
- **Power**: ok. AVISTA CORP, ~1 ft to mapped power [provider=AVISTA CORP, distanceFt=1, confidence=moderate, distributionStatus=utility_published_proximity]
- **Public water/sewer**: ok. water served (City of Spokane) 7 m; sewer served (City of Spokane) 9 m [water=served, sewer=served, waterProvider=City of Spokane, sewerProvider=City of Spokane, waterProviders=City of Spokane, sewerProviders=City of Spokane, waterPublic=true, sewerPublic=true, waterDistanceM=7, sewerDistanceM=9, failedLayers=(none)]
- **Zoning**: ok. R1 (City of Spokane) · overlays: Critical aquifer recharge area: high susceptibility [code=R1, jurisdiction=City of Spokane, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: high susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $72,900, class 77 Churches, no tax amount [assessedValue=72900, landValue=72900, improvementValue=0, taxPresent=false, netValue=0, taxYear=2027, propertyClass=77, propertyClassDescription=Churches, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 35234.0602 (City of Spokane Valley, 0.42 ac)

Why: Small lot inside the City of Spokane Valley (5407 E 16th Ave). No county zoning polygon at the centroid (-117.331914,47.642933); the city's layer used by src/counties/spokane-cities.js says R-3, Single-Family Residential (R-3) (https://arcgis.spokanevalley.org/arcgis/rest/services/ViewerV3/LandUse/MapServer/1/query?f=json&geometry=-117.331914,47.642933&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Zoning,Zoning_Desg&returnGeometry=false, checked 2026-11-02). Assessor property class 11 Single Unit hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=35234.0602, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2735234.0602%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 35234.0602, 0.42 ac [parcelId=35234.0602, acres=0.42, address=5407 E 16TH AVE, SPOKANE VALLEY, 99212, lat=47.642933, lon=-117.331913]
- **Wells**: ok. 1892 well record(s), 5 of nearest 5 report depth [wellCount=1892, nearestDepthsCount=5, nearestMi=0.2, medianDepthFt=25]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Urban land-Lenz, disturbed complex, 3 to 15 percent slopes) [feasibility=moderate, mapUnit=Urban land-Lenz, disturbed complex, 3 to 15 percent slopes, soilSlopePct=5]
- **Terrain**: ok. avg grade 4.9%, max 8.7% [gradePct=4.9, maxGradePct=8.7, reliefFt=9, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 7.3% [cellCount=16, avgSlopePct=7.3, maxSlopePct=14.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. AVISTA CORP, ~2 ft to mapped power [provider=AVISTA CORP, distanceFt=2, confidence=moderate, distributionStatus=utility_published_proximity]
- **Public water/sewer**: ok. water served (Spokane County Water District #3 System #1); sewer likely (Spokane County Utilities) 5 m [water=served, sewer=likely, waterProvider=Spokane County Water District #3 System #1, sewerProvider=Spokane County Utilities, waterProviders=Spokane County Water District #3 System #1; City of Spokane Valley, sewerProviders=Spokane County Utilities; City of Spokane Valley, waterPublic=true, sewerPublic=true, sewerDistanceM=5, failedLayers=(none)]
- **Zoning**: mismatch. City of Spokane Valley zoning lookup unavailable · overlays: Critical aquifer recharge area: high susceptibility [jurisdiction=City of Spokane Valley, countyStatus=official_adapter, zoningStatus=unavailable, permitHistoryStatus=none, overlays=Critical aquifer recharge area: high susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
  - mismatch `zoning.code`: expected R-3, got null
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: ok. assessed $589,000, class 11 Single Unit, no tax amount [assessedValue=589000, landValue=110000, improvementValue=479000, taxPresent=false, netValue=76466, taxYear=2027, propertyClass=11, propertyClassDescription=Single Unit, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 13013.2211 (City of Cheney, 0.16 ac)

Why: Small lot inside the City of Cheney (3175 Pheasant St). No county zoning polygon at the centroid (-117.575987,47.510249), so city zoning applies. The City of Cheney layer used by src/counties/spokane-cities.js says R-1, Single Family Residential (https://services.arcgis.com/yP5WvH3YqutU0LDh/arcgis/rest/services/Cheney__WA___Zoning_Map___2025_WFL1/FeatureServer/4/query?f=json&geometry=-117.575987,47.510249&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZoneCODE,ZONE&returnGeometry=false, checked 2026-11-10; layer 3 until the city renumbered the service around 2026-11-10, when layer 3 became the PUD Overlay). Assessor property class 11 Single Unit hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=13013.2211, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2713013.2211%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 13013.2211, 0.16 ac [parcelId=13013.2211, acres=0.16, address=3175 PHEASANT ST, CHENEY, lat=47.510249, lon=-117.575987]
- **Wells**: ok. 353 well record(s), 5 of nearest 5 report depth [wellCount=353, nearestDepthsCount=5, nearestMi=0.13, medianDepthFt=20]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. favorable (Cheney ashy silt loam, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Cheney ashy silt loam, 0 to 8 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=3]
- **Terrain**: ok. avg grade 3.3%, max 5.9% [gradePct=3.3, maxGradePct=5.9, reliefFt=5, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.7% [cellCount=16, avgSlopePct=6.7, maxSlopePct=13.1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. CITY OF CHENEY - (WA) [providers=CITY OF CHENEY - (WA)]
- **Power**: ok. CITY OF CHENEY - (WA) [provider=CITY OF CHENEY - (WA), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water served (City of Cheney) 6 m; sewer served (City of Cheney) 9 m [water=served, sewer=served, waterProvider=City of Cheney, sewerProvider=City of Cheney, waterProviders=City of Cheney, sewerProviders=City of Cheney, waterPublic=true, sewerPublic=true, waterDistanceM=6, sewerDistanceM=9, failedLayers=(none)]
- **Zoning**: ok. R-1 (City of Cheney) · overlays: Critical aquifer recharge area: moderate susceptibility; Planned Unit Development overlay: PUD (R-1) [code=R-1, jurisdiction=City of Cheney, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: moderate susceptibility; Planned Unit Development overlay: PUD (R-1), overlayTypes=aquifer_recharge; planned_unit_development, overlaysUnavailable=(none)]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $401,500, class 11 Single Unit, no tax amount [assessedValue=401500, landValue=100000, improvementValue=301500, taxPresent=false, netValue=401500, taxYear=2027, propertyClass=11, propertyClassDescription=Single Unit, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 57344.0125 (Newman Lake, 0.45 ac, flood AE, wetlands)

Why: Small unincorporated lot with a FEMA high-risk zone and mapped NWI wetlands (picked by discovery 2026-11-02, seed 42). Zoning RCV Rural Conservation from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.095636,47.787979&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). Flood AE (SFHA) and X on the parcel outline from FEMA NFHL (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, geometryType=esriGeometryPolygon with the statewide parcel outline, outFields=FLD_ZONE,SFHA_TF; DFIRM 53063C). Checked 2026-11-02. Assessor property class 91 Vacant Land hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=57344.0125, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2757344.0125%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 57344.0125, 0.35 ac [parcelId=57344.0125, acres=0.35, address=14324 N MEADOW LN, NEWMAN LAKE, lat=47.787979, lon=-117.095636]
- **Wells**: ok. 193 well record(s), 5 of nearest 5 report depth [wellCount=193, nearestDepthsCount=5, nearestMi=0.14, medianDepthFt=360]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. favorable (Bouldercreek ashy silt loam, moist, 3 to 15 percent slopes) [feasibility=favorable, mapUnit=Bouldercreek ashy silt loam, moist, 3 to 15 percent slopes, hydrologicGroup=A, drainage=Well drained, soilSlopePct=8]
- **Terrain**: ok. avg grade 14.3%, max 28.2% [gradePct=14.3, maxGradePct=28.2, reliefFt=57, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 24.1% [cellCount=16, avgSlopePct=24.1, maxSlopePct=58, partial=false]
- **Flood**: ok. high-risk zone (AE, X) (via FEMA NFHL) [high=true, intersects=true, zones=AE; X, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=14]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (Moab Irrigation Dist #20); sewer not_found [water=likely, sewer=not_found, waterProvider=Moab Irrigation Dist #20, waterProviders=Moab Irrigation Dist #20, sewerProviders=(none), waterPublic=true, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RCV (Spokane County) · overlays: Shoreline designation: Rural Conservancy; Critical aquifer recharge area: low susceptibility; Mapped wetland buffer: 190 foot buffer; Mapped wetland buffer: 250 foot buffer [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Shoreline designation: Rural Conservancy; Critical aquifer recharge area: low susceptibility; Mapped wetland buffer: 190 foot buffer; Mapped wetland buffer: 250 foot buffer, overlayTypes=shoreline; aquifer_recharge; wetland_buffer, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed $387,870, class 91 Vacant Land, no tax amount [assessedValue=387870, landValue=387870, improvementValue=0, taxPresent=false, netValue=387870, taxYear=2027, propertyClass=91, propertyClassDescription=Vacant Land, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 43341.0110 (unincorporated, 1.5 ac, LTA, wetlands)

Why: Unincorporated 1-5 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning LTA Large Tract Agricultural from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.217847,47.448652&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02. Only flood.high is expected: when NFHL doesn't answer, the Esri fallback holds high/moderate-risk zones only and returns no X. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): no DOH service area or Spokane County water district at the point, no city or county sewer main within 300 m, unincorporated. Assessor property class 11 Single Unit hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=43341.0110, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2743341.0110%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 43341.0110, 1.5 ac [parcelId=43341.0110, acres=1.5, address=22522 S DARKNELL RD, SPOKANE, lat=47.448652, lon=-117.217847]
- **Wells**: ok. 39 well record(s), 5 of nearest 5 report depth [wellCount=39, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=160]
- **Existing well**: ok. Possible well association [status=possible_match, confidence=Low, score=45]
- **Soil**: ok. moderate (Glenrose ashy silt loam, 8 to 25 percent slopes) [feasibility=moderate, mapUnit=Glenrose ashy silt loam, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=15]
- **Terrain**: ok. avg grade 2.6%, max 4.5% [gradePct=2.6, maxGradePct=4.5, reliefFt=14, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.6% [cellCount=16, avgSlopePct=5.6, maxSlopePct=11.1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=7]
- **Utility**: ok. AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. AVISTA CORP, ~48 ft to mapped power [provider=AVISTA CORP, distanceFt=48, confidence=moderate, distributionStatus=utility_published_proximity]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. LTA (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=LTA, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. LTA: Resource Lands (8 uses) [code=LTA, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed $382,790, class 11 Single Unit, no tax amount [assessedValue=382790, landValue=99990, improvementValue=282800, taxPresent=false, netValue=382790, taxYear=2027, propertyClass=11, propertyClassDescription=Single Unit, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47071.9003 (Chattaroy, 2.32 ac, RT)

Why: Unincorporated 1-5 ac parcel (picked by discovery 2026-11-02, seed 42; its lookup timed out in that run). County zoning RT Rural Traditional at the centroid (-117.293144,47.859658). Public water/sewer hand-checked 2026-11-10 (read-only queries of the layers themselves): WA DOH service area WHITWORTH WATER DISTRICT 2 (Group A, Comm, Active) and Spokane County DistrictLookup/MapServer/6 Whitworth Water District #2 at the point, unincorporated (PermittingLookup/0 Spokane County), no city or county sewer main within 300 m. A district polygon outside city limits is likely, not served. Assessor property class 18 Other Residential hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=47071.9003, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2747071.9003%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 47071.9003, 2.27 ac [parcelId=47071.9003, acres=2.27, address=8316 E BIG MEADOWS RD, CHATTAROY, 99003, lat=47.859658, lon=-117.293143]
- **Wells**: ok. 232 well record(s), 5 of nearest 5 report depth [wellCount=232, nearestDepthsCount=5, nearestMi=0.18, medianDepthFt=448]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=25]
- **Soil**: ok. moderate (Lenz-Spokane complex, 3 to 15 percent slopes) [feasibility=moderate, mapUnit=Lenz-Spokane complex, 3 to 15 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=9]
- **Terrain**: ok. avg grade 11.2%, max 16.3% [gradePct=11.2, maxGradePct=16.3, reliefFt=37, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 15.8% [cellCount=16, avgSlopePct=15.8, maxSlopePct=26.2, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (Whitworth Water District #2); sewer not_found [water=likely, sewer=not_found, waterProvider=Whitworth Water District #2, waterProviders=Whitworth Water District #2; Whitworth Water District 2, sewerProviders=(none), waterPublic=true, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RT (Spokane County) · overlays: Critical aquifer recharge area: moderate susceptibility [code=RT, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: moderate susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RT: Rural (10 uses) [code=RT, family=Rural, useCount=10]
- **Assessment**: ok. assessed $247,350, class 18 Other Residential, no tax amount [assessedValue=247350, landValue=114050, improvementValue=133300, taxPresent=false, netValue=247350, taxYear=2027, propertyClass=18, propertyClassDescription=Other Residential, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 46301.9025 (no situs city, 4.62 ac, RCV)

Why: Unincorporated 1-5 ac parcel with a blank situs city (picked by discovery 2026-11-02, seed 42). Assessor property class 85 Mining hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=46301.9025, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2746301.9025%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 46301.9025, 4.58 ac [parcelId=46301.9025, acres=4.58, lat=47.728449, lon=-117.288869]
- **Wells**: ok. 310 well record(s), 5 of nearest 5 report depth [wellCount=310, nearestDepthsCount=5, nearestMi=0.19, medianDepthFt=265]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=12]
- **Soil**: ok. favorable (Scrabblers ashy fine sandy loam, 3 to 8 percent slopes) [feasibility=favorable, mapUnit=Scrabblers ashy fine sandy loam, 3 to 8 percent slopes, hydrologicGroup=A, drainage=Well drained, soilSlopePct=5]
- **Terrain**: ok. avg grade 3.9%, max 11.3% [gradePct=3.9, maxGradePct=11.3, reliefFt=55, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.9% [cellCount=16, avgSlopePct=6.9, maxSlopePct=17.7, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (Pasadena Park Irr Dist 17); sewer not_found [water=likely, sewer=not_found, waterProvider=Pasadena Park Irr Dist 17, waterProviders=Pasadena Park Irr Dist 17, sewerProviders=(none), waterPublic=true, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RCV (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed $199,510, class 85 Mining, no tax amount [assessedValue=199510, landValue=199510, improvementValue=0, taxPresent=false, netValue=0, taxYear=2027, propertyClass=85, propertyClassDescription=Mining, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 57302.9016 (Mead, 9.78 ac, RCV, wetlands)

Why: Unincorporated 5-40 ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning RCV from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.173978,47.813929&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02. Only flood.high is expected: on 2026-11-02 NFHL didn't answer for this parcel and the Esri fallback (high/moderate-risk zones only) returned no zones. Assessor property class 18 Other Residential hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=57302.9016, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2757302.9016%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 57302.9016, 9.77 ac [parcelId=57302.9016, acres=9.77, address=17238 N MOUNTAIN TOP LN, MEAD, lat=47.813929, lon=-117.173978]
- **Wells**: ok. 181 well record(s), 5 of nearest 5 report depth [wellCount=181, nearestDepthsCount=5, nearestMi=0.21, medianDepthFt=345]
- **Existing well**: ok. Likely existing well [status=strong_match, confidence=High, score=100]
- **Soil**: ok. limited (Quinnamose-Micapeak complex, 30 to 55 percent slopes) [feasibility=limited, mapUnit=Quinnamose-Micapeak complex, 30 to 55 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=42]
- **Terrain**: ok. avg grade 10.4%, max 25.6% [gradePct=10.4, maxGradePct=25.6, reliefFt=136, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 22% [cellCount=16, avgSlopePct=22, maxSlopePct=32.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=2.8]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RCV (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed $469,010, class 18 Other Residential, no tax amount [assessedValue=469010, landValue=125010, improvementValue=344000, taxPresent=false, netValue=469010, taxYear=2027, propertyClass=18, propertyClassDescription=Other Residential, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 37094.9101 (Spokane situs, 5 ac, RCV)

Why: 5-40 ac parcel with a SPOKANE situs city that is outside city limits (county zoning RCV), picked by discovery 2026-11-02, seed 42. Shows the situs city is not the jurisdiction. Assessor property class 11 Single Unit hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=37094.9101, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2737094.9101%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 37094.9101, 5 ac [parcelId=37094.9101, acres=5, address=2211 E WHISPERING SPRING LN, SPOKANE, lat=47.849368, lon=-117.37833]
- **Wells**: ok. 285 well record(s), 5 of nearest 5 report depth [wellCount=285, nearestDepthsCount=5, nearestMi=0.16, medianDepthFt=178]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. favorable (Wapal gravelly ashy coarse sandy loam, 0 to 8 percent slopes) [feasibility=favorable, mapUnit=Wapal gravelly ashy coarse sandy loam, 0 to 8 percent slopes, hydrologicGroup=A, drainage=Somewhat excessively drained, soilSlopePct=4]
- **Terrain**: ok. avg grade 0.8%, max 4.5% [gradePct=0.8, maxGradePct=4.5, reliefFt=22, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 1.6% [cellCount=16, avgSlopePct=1.6, maxSlopePct=8.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=AVISTA CORP; INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. AVISTA CORP, ~3 ft to mapped power [provider=AVISTA CORP, distanceFt=3, confidence=moderate, distributionStatus=utility_published_proximity]
- **Public water/sewer**: ok. water likely (Whitworth Water District #2); sewer not_found [water=likely, sewer=not_found, waterProvider=Whitworth Water District #2, waterProviders=Whitworth Water District #2; Whitworth Water District 2, sewerProviders=(none), waterPublic=true, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RCV (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed $862,700, class 11 Single Unit, no tax amount [assessedValue=862700, landValue=245000, improvementValue=617700, taxPresent=false, netValue=862700, taxYear=2027, propertyClass=11, propertyClassDescription=Single Unit, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48121.9001 (Elk, 154 ac, FZ, wetlands)

Why: Unincorporated 40+ ac forest parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Zoning FZ Forest Land from Spokane County (https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/ZoningLookup/MapServer/3/query?f=json&geometry=-117.177199,47.944269&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONECLASS,ZONEDESC&returnGeometry=false). FEMA NFHL MapServer/28 on the parcel outline: zone X only. Checked 2026-11-02. Assessor property class 88 Designated Forest Lnd hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=48121.9001, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2748121.9001%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 48121.9001, 158.65 ac [parcelId=48121.9001, acres=158.65, address=ELK, 99009, lat=47.94369, lon=-117.177667]
- **Wells**: ok. 49 well record(s), 5 of nearest 5 report depth [wellCount=49, nearestDepthsCount=5, nearestMi=0.49, medianDepthFt=400]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. limited (Keeler-Kruse complex, 15 to 30 percent slopes) [feasibility=limited, mapUnit=Keeler-Kruse complex, 15 to 30 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=23]
- **Terrain**: ok. avg grade 11.7%, max 27.2% [gradePct=11.7, maxGradePct=27.2, reliefFt=588, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 19.4% [cellCount=16, avgSlopePct=19.4, maxSlopePct=41.4, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 3 NWI feature(s) [intersects=true, count=3, coveragePct=0.6]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. FZ (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=FZ, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. FZ: Resource Lands (8 uses) [code=FZ, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed $10,280, class 88 Designated Forest Lnd, no tax amount [assessedValue=10280, taxPresent=false, netValue=10280, taxYear=2027, propertyClass=88, propertyClassDescription=Designated Forest Lnd, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48136.9052 (Colbert, 51.9 ac, RCV, wetlands)

Why: Unincorporated 40+ ac parcel with mapped wetlands (picked by discovery 2026-11-02, seed 42). Assessor property class 88 Designated Forest Lnd hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=48136.9052, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2748136.9052%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 48136.9052, 50.23 ac [parcelId=48136.9052, acres=50.23, address=15510 E DEER CREEK RD, COLBERT, lat=47.928279, lon=-117.194683]
- **Wells**: ok. 68 well record(s), 5 of nearest 5 report depth [wellCount=68, nearestDepthsCount=5, nearestMi=0.25, medianDepthFt=300]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=12]
- **Soil**: ok. limited (Blackprince-Ardtoo complex, 15 to 30 percent slopes) [feasibility=limited, mapUnit=Blackprince-Ardtoo complex, 15 to 30 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=22]
- **Terrain**: ok. avg grade 7%, max 15.8% [gradePct=7, maxGradePct=15.8, reliefFt=147, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 11.5% [cellCount=16, avgSlopePct=11.5, maxSlopePct=18.2, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=3.7]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RCV (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility; County-mapped wetland: permanent lake; Mapped wetland buffer: 190 foot buffer; Mapped wetland buffer: 250 foot buffer [code=RCV, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=none, overlays=Critical aquifer recharge area: low susceptibility; County-mapped wetland: permanent lake; Mapped wetland buffer: 190 foot buffer; Mapped wetland buffer: 250 foot buffer, overlayTypes=aquifer_recharge; wetland; wetland_buffer, overlaysUnavailable=(none)]
- **Zoning rules**: ok. RCV: Rural (10 uses) [code=RCV, family=Rural, useCount=10]
- **Assessment**: ok. assessed $99,910, class 88 Designated Forest Lnd, no tax amount [assessedValue=99910, taxPresent=false, netValue=99910, taxYear=2027, propertyClass=88, propertyClassDescription=Designated Forest Lnd, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 32322.9002 (Spangle, 157.8 ac, LTA)

Why: Unincorporated 40+ ac farm parcel (picked by discovery 2026-11-02, seed 42; its lookup timed out in that run). County zoning LTA at the centroid (-117.408960,47.357265). Assessor property class 83 Cur - Use - Ag hand-checked 2026-11-10 on the county's SCOUT page (https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID=32322.9002, Parcel Class) and the assessor parcel table (https://gismo.spokanecounty.org/arcgis/rest/services/ISDSDE/LandCapacityAnalysis/MapServer/0/query?f=json&where=PID_NUM%3D%2732322.9002%27&outFields=PID_NUM,prop_use_code,prop_use_desc&returnGeometry=false); a tax category, not zoning.

- **Parcel**: ok. parcel 32322.9002, 156.55 ac [parcelId=32322.9002, acres=156.55, address=SPANGLE, 99031, lat=47.357266, lon=-117.40896]
- **Wells**: ok. 26 well record(s), 5 of nearest 5 report depth [wellCount=26, nearestDepthsCount=5, nearestMi=1.13, medianDepthFt=200]
- **Existing well**: ok. No existing well match found [status=no_match, confidence=Low, score=0]
- **Soil**: ok. moderate (Naff-Thatuna complex, 8 to 25 percent slopes) [feasibility=moderate, mapUnit=Naff-Thatuna complex, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=15]
- **Terrain**: ok. avg grade 1%, max 1.8% [gradePct=1, maxGradePct=1.8, reliefFt=30, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.3% [cellCount=16, avgSlopePct=3.3, maxSlopePct=5.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=1.2]
- **Utility**: ok. INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION [providers=INLAND POWER & LIGHT COMPANY; AVISTA CORP; BONNEVILLE POWER ADMINISTRATION]
- **Power**: ok. INLAND POWER & LIGHT COMPANY [provider=INLAND POWER & LIGHT COMPANY, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. LTA (Spokane County) · overlays: Critical aquifer recharge area: low susceptibility [code=LTA, jurisdiction=Spokane County, countyStatus=official_adapter, zoningStatus=gis_match, permitHistoryStatus=unavailable, overlays=Critical aquifer recharge area: low susceptibility, overlayTypes=aquifer_recharge, overlaysUnavailable=(none)]
- **Zoning rules**: ok. LTA: Resource Lands (8 uses) [code=LTA, family=Resource Lands, useCount=8]
- **Assessment**: ok. assessed $62,690, class 83 Cur - Use - Ag, no tax amount [assessedValue=62690, taxPresent=false, netValue=62690, taxYear=2027, propertyClass=83, propertyClassDescription=Cur - Use - Ag, source=Spokane County Assessor (assessor parcel table, Spokane County GIS)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
