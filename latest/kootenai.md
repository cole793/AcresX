# County validation: Kootenai, ID

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-16T22:55:27.899Z
- Parcels: 12, with an error or mismatch: 12
- Layer results: ok 58, unavailable 14, error 14, mismatch 8, skipped 98

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Public water/sewer | Zoning | Zoning rules | Assessment | Property tax | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0L8210010030 | error | skipped | skipped | skipped | skipped | skipped | mismatch | skipped | skipped | skipped | mismatch | mismatch | skipped | mismatch | skipped | skipped |
| 015270010070 | error | skipped | skipped | skipped | skipped | skipped | mismatch | skipped | skipped | skipped | skipped | mismatch | skipped | mismatch | skipped | skipped |
| C72150030040 | ok | ok | unavailable | error | ok | ok | ok | ok | ok | ok | ok | mismatch | unavailable | ok | ok | unavailable |
| 47N02W035500 | ok | ok | unavailable | error | ok | ok | ok | ok | ok | error | ok | ok | ok | ok | ok | unavailable |
| 48N03W312100 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 0K245001002B | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 49N03W324950 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 007740020050 | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 0K2660010030 | ok | ok | unavailable | error | ok | ok | ok | ok | ok | ok | unavailable | error | unavailable | ok | ok | unavailable |
| 0153400A001A | error | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped | skipped |
| 47N02W040800 | ok | ok | unavailable | error | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| C72150040140 | ok | ok | unavailable | error | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | ok | unavailable |

## Parcel details

### 0L8210010030 (no locality, 4.79 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | other/blank locality"; first in locality (blank). Locality is the parcel's situs city field, not proof it is inside city limits. Hand check: outside city limits (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query: blank CITY); county zoning ZONE_NAME RUR (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query with the parcel outline from https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query?f=json&where=PIN%3D%270L8210010030%27&outFields=PIN&returnGeometry=true&outSR=4326 sent as geometryType=esriGeometryPolygon, spatialRel=esriSpatialRelIntersects, outFields=ZONE_NAME), which AcresX shows as RURAL; assessor class 515 Rural residential sub (https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/5/query?f=json&where=PIN%3D%270L8210010030%27&outFields=PIN,property_class,Property_ClassDescr&returnGeometry=false); FEMA zone X only (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, same outline). Checked by hand 2026-11-02. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): no CdA/Post Falls water area or main within 300 m, tax district layer 25 WATER/SEWER blank, outside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: mismatch. parcel lookup failed
  - mismatch `flood.high`: expected false, got null
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: mismatch. parcel lookup failed
  - mismatch `publicUtilities.water`: expected not_found, got null
  - mismatch `publicUtilities.sewer`: expected not_found, got null
- **Zoning**: mismatch. parcel lookup failed
  - mismatch `zoning.code`: expected RURAL, got null
  - mismatch `zoning.jurisdiction`: expected Kootenai County, got null
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: mismatch. parcel lookup failed
  - mismatch `assessment.propertyClass`: expected 515, got null
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 015270010070 (WORLEY, 10.01 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | city-named locality"; first in locality WORLEY. Locality is the parcel's situs city field, not proof it is inside city limits. Hand check: outside city limits (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query: blank CITY); county zoning ZONE_NAME RUR (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query with the parcel outline from https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query?f=json&where=PIN%3D%27015270010070%27&outFields=PIN&returnGeometry=true&outSR=4326 sent as geometryType=esriGeometryPolygon, spatialRel=esriSpatialRelIntersects), shown as RURAL; assessor class 537 Imp res rural sub (https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/9/query?f=json&where=PIN%3D%27015270010070%27&outFields=PIN,property_class,Property_ClassDescr&returnGeometry=false); FEMA zone D only (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, same outline). Checked by hand 2026-11-02.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: mismatch. parcel lookup failed
  - mismatch `flood.high`: expected false, got null
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: mismatch. parcel lookup failed
  - mismatch `zoning.code`: expected RURAL, got null
  - mismatch `zoning.jurisdiction`: expected Kootenai County, got null
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: mismatch. parcel lookup failed
  - mismatch `assessment.propertyClass`: expected 537, got null
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### C72150030040 (COEUR D ALENE, 0.27 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | city-named locality"; first in locality COEUR D ALENE. Locality is the parcel's situs city field, not proof it is inside city limits. Hand check: inside Coeur d'Alene city limits (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query with the parcel outline from https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query?f=json&where=PIN%3D%27C72150030040%27&outFields=PIN&returnGeometry=true&outSR=4326 sent as geometryType=esriGeometryPolygon, spatialRel=esriSpatialRelIntersects: CITY Coeur d Alene); no county zoning polygon (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query, outFields=ZONE_NAME: none); city zoning R-12 (https://gis.cdaid.org/server/rest/services/Share/Planning/MapServer/8/query, same outline: ZONING R-12); assessor class 541 Imp res lot/tract in city (https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/8/query?f=json&where=PIN%3D%27C72150030040%27&outFields=PIN,property_class,Property_ClassDescr&returnGeometry=false); FEMA zone X only (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, same outline, outFields=FLD_ZONE,SFHA_TF). Checked by hand 2026-11-02. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): gis.cdaid.org Water_Distribution_System/MapServer/11 returns Water_Dist 'CDA Water' at the parcel point; CityUtilities/Public_Wastewater/MapServer/3 has an 8-inch gravity main 6.9 m from the outline.

- **Parcel**: ok. parcel C72150030040, 0.26 ac (mapped) [parcelId=C72150030040, acres=0.26, lat=47.724453, lon=-116.803995, acresSource=mapped outline]
- **Wells**: ok. 53 well record(s), 5 of nearest 5 report depth [wellCount=53, nearestDepthsCount=5, nearestMi=0.74, medianDepthFt=330]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: error. USDA soil service returned 502 with an invalid response.
- **Terrain**: ok. avg grade 4%, max 7.6% [gradePct=4, maxGradePct=7.6, reliefFt=7, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.5% [cellCount=16, avgSlopePct=5.5, maxSlopePct=12.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water served (City of Coeur d'Alene (CDA Water)) 13 m; sewer served (City of Coeur d'Alene) 7 m [water=served, sewer=served, waterProvider=City of Coeur d'Alene (CDA Water), sewerProvider=City of Coeur d'Alene, waterProviders=City of Coeur d'Alene (CDA Water); CDA Water, sewerProviders=City of Coeur d'Alene, waterPublic=true, sewerPublic=true, waterDistanceM=13, sewerDistanceM=7, failedLayers=(none)]
- **Zoning**: mismatch. timeout after 30s
  - mismatch `zoning.code`: expected R-12, got null
  - mismatch `zoning.jurisdiction`: expected City of Coeur d'Alene, got null
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: ok. assessed $496,440, class 541 Imp res lot/tract in city, no tax amount [assessedValue=496440, landValue=195000, improvementValue=301440, taxPresent=false, netValue=371440, homeownerExemption=125000, taxYear=2026, propertyClass=541, propertyClassDescription=Imp res lot/tract in city, source=Kootenai County Assessor (Assessor_Layers)]
- **Property tax**: ok. estimated 2026 tax $2,025.31 [taxTotal=2025.31, taxYear=2026, taxBasis=estimate, taxSource=Kootenai County, Rates for the Year 2026 (levy rate by tax area group)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 47N02W035500 (MEDIMONT, 51.64 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | other/blank locality"; first in locality MEDIMONT. Locality is the parcel's situs city field, not proof it is inside city limits. Hand check: outside city limits (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/18/query: blank CITY); county zoning ZONE_NAME AG (https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/21/query with the parcel outline from https://map.kcgov.us/arcgis/rest/services/NewServices/Ownership_Display/MapServer/0/query?f=json&where=PIN%3D%2747N02W035500%27&outFields=PIN&returnGeometry=true&outSR=4326 sent as geometryType=esriGeometryPolygon, spatialRel=esriSpatialRelIntersects), shown as AGRICULTURE; assessor class 534 Imp res rural tract (https://map.kcgov.us/arcgis/rest/services/Assessor_Layers/MapServer/10/query?f=json&where=PIN%3D%2747N02W035500%27&outFields=PIN,property_class,Property_ClassDescr&returnGeometry=false); FEMA zones AE and A (SFHA) plus X (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query, same outline). Checked by hand 2026-11-02.

- **Parcel**: ok. parcel 47N02W035500, 51.64 ac [parcelId=47N02W035500, acres=51.64, address=15047 E CAMERON RD, MEDIMONT, lat=47.453302, lon=-116.577746]
- **Wells**: ok. 40 well record(s), 5 of nearest 5 report depth [wellCount=40, nearestDepthsCount=5, nearestMi=0.06, medianDepthFt=262]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: error. USDA soil service returned 502 with an invalid response.
- **Terrain**: ok. avg grade 3.6%, max 10.1% [gradePct=3.6, maxGradePct=10.1, reliefFt=128, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.3% [cellCount=16, avgSlopePct=6.3, maxSlopePct=21.9, partial=false]
- **Flood**: ok. high-risk zone (A, X, AE) (via FEMA NFHL) [high=true, intersects=true, zones=A; X; AE, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 16 NWI feature(s) [intersects=true, count=16, coveragePct=70.5]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: error. request failed: fetch failed
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. AGRICULTURE (Kootenai County) · overlays: none mapped [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $449,687, class 534 Imp res rural tract, no tax amount [assessedValue=449687, landValue=328727, improvementValue=120960, taxPresent=false, netValue=367907, homeownerExemption=81780, taxYear=2026, propertyClass=534, propertyClassDescription=Imp res rural tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Property tax**: ok. estimated 2026 tax $1,407.78 [taxTotal=1407.78, taxYear=2026, taxBasis=estimate, taxSource=Kootenai County, Rates for the Year 2026 (levy rate by tax area group)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 48N03W312100 (HARRISON, 65.33 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "40+ ac | city-named locality"; first in locality HARRISON. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 0K245001002B (RATHDRUM, 1.62 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "1-5 ac | city-named locality"; first in locality RATHDRUM. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 49N03W324950 (no locality, 10 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "5-40 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 007740020050 (no locality, 0.58 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): covers stratum "under 1 ac | other/blank locality". Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 0K2660010030 (ATHOL, 4.95 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ATHOL. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 0K2660010030, 4.94 ac (mapped) [parcelId=0K2660010030, acres=4.94, lat=47.905682, lon=-116.770423, acresSource=mapped outline]
- **Wells**: ok. 86 well record(s), 5 of nearest 5 report depth [wellCount=86, nearestDepthsCount=5, nearestMi=0.02, medianDepthFt=460]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: error. USDA soil service returned 502 with an invalid response.
- **Terrain**: ok. avg grade 1%, max 3.5% [gradePct=1, maxGradePct=3.5, reliefFt=7, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2.1% [cellCount=16, avgSlopePct=2.1, maxSlopePct=2.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: unavailable. water unavailable; sewer unavailable [water=unavailable, sewer=unavailable, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=kootenai-tax-districts]
- **Zoning**: error. timeout after 30s
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: ok. assessed $635,039, class 537 Imp res rural sub, no tax amount [assessedValue=635039, landValue=343729, improvementValue=291310, taxPresent=false, netValue=510039, homeownerExemption=125000, taxYear=2026, propertyClass=537, propertyClassDescription=Imp res rural sub, source=Kootenai County Assessor (Assessor_Layers)]
- **Property tax**: ok. estimated 2026 tax $1,664.58 [taxTotal=1664.58, taxYear=2026, taxBasis=estimate, taxSource=Kootenai County, Rates for the Year 2026 (levy rate by tax area group)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 0153400A001A (POST FALLS, 9.52 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality POST FALLS. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: error. HTTP 502: Idaho parcel sources failed for Kootenai: Kootenai County parcel layer timed out after 8s; Idaho parcel service request cancelled
- **Wells**: skipped. parcel lookup failed
- **Existing well**: skipped. parcel lookup failed
- **Soil**: skipped. parcel lookup failed
- **Terrain**: skipped. parcel lookup failed
- **Slope grid**: skipped. parcel lookup failed
- **Flood**: skipped. parcel lookup failed
- **Wetlands**: skipped. parcel lookup failed
- **Utility**: skipped. parcel lookup failed
- **Power**: skipped. parcel lookup failed
- **Public water/sewer**: skipped. parcel lookup failed
- **Zoning**: skipped. parcel lookup failed
- **Zoning rules**: skipped. parcel lookup failed
- **Assessment**: skipped. parcel lookup failed
- **Property tax**: skipped. parcel lookup failed
- **Listing**: skipped. parcel lookup failed

### 47N02W040800 (ST MARIES, 99.74 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): first in locality ST MARIES. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel 47N02W040800, 99.74 ac [parcelId=47N02W040800, acres=99.74, address=31645 S HIGHWAY 3, ST MARIES, lat=47.458258, lon=-116.597619]
- **Wells**: ok. 60 well record(s), 5 of nearest 5 report depth [wellCount=60, nearestDepthsCount=5, nearestMi=0.15, medianDepthFt=205]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: error. USDA soil service returned 502 with an invalid response.
- **Terrain**: ok. avg grade 3.6%, max 8% [gradePct=3.6, maxGradePct=8, reliefFt=136, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.5% [cellCount=16, avgSlopePct=6.5, maxSlopePct=17.5, partial=false]
- **Flood**: ok. high-risk zone (X, AE) (via FEMA NFHL) [high=true, intersects=true, zones=X; AE, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 7 NWI feature(s) [intersects=true, count=7, coveragePct=3.4]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. AGRICULTURE (Kootenai County) · overlays: none mapped [code=AGRICULTURE, jurisdiction=Kootenai County, countyStatus=kootenai-data-layers-v3, zoningStatus=gis_match, allowedBuildings=mapped_from_county_code, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. A: Resource Lands (7 uses) [code=A, family=Resource Lands, useCount=7]
- **Assessment**: ok. assessed $549,398, class 534 Imp res rural tract, no tax amount [assessedValue=549398, landValue=472598, improvementValue=76800, taxPresent=false, netValue=442326, homeownerExemption=107072, taxYear=2026, propertyClass=534, propertyClassDescription=Imp res rural tract, source=Kootenai County Assessor (Assessor_Layers)]
- **Property tax**: ok. estimated 2026 tax $1,692.54 [taxTotal=1692.54, taxYear=2026, taxBasis=estimate, taxSource=Kootenai County, Rates for the Year 2026 (levy rate by tax area group)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### C72150040140 (COEUR D ALENE, 0.23 ac)

Why: Picked by discovery run 40391761739 (2026-10-26): fills remaining sample slots. Locality is the parcel's situs city field, not proof it is inside city limits.

- **Parcel**: ok. parcel C72150040140, 0.23 ac [parcelId=C72150040140, acres=0.23, address=5726 N CHRISTOPHER DR, COEUR D ALENE, lat=47.723551, lon=-116.803077]
- **Wells**: ok. 55 well record(s), 5 of nearest 5 report depth [wellCount=55, nearestDepthsCount=5, nearestMi=0.77, medianDepthFt=300]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: error. USDA soil service returned 502 with an invalid response.
- **Terrain**: ok. avg grade 3.4%, max 13.6% [gradePct=3.4, maxGradePct=13.6, reliefFt=11, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6.6% [cellCount=16, avgSlopePct=6.6, maxSlopePct=22.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP [providers=KOOTENAI ELECTRIC COOPERATIVE; AVISTA CORP]
- **Power**: ok. KOOTENAI ELECTRIC COOPERATIVE [provider=KOOTENAI ELECTRIC COOPERATIVE, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water served (City of Coeur d'Alene (CDA Water)) 5 m; sewer served (City of Coeur d'Alene) 11 m [water=served, sewer=served, waterProvider=City of Coeur d'Alene (CDA Water), sewerProvider=City of Coeur d'Alene, waterProviders=City of Coeur d'Alene (CDA Water); CDA Water, sewerProviders=City of Coeur d'Alene, waterPublic=true, sewerPublic=true, waterDistanceM=5, sewerDistanceM=11, failedLayers=(none)]
- **Zoning**: ok. R-12 (City of Coeur d'Alene) · overlays: none mapped [code=R-12, jurisdiction=City of Coeur d'Alene, countyStatus=kootenai-city-zoning-v1, zoningStatus=gis_match, allowedBuildings=not_mapped, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $533,760, class 541 Imp res lot/tract in city, no tax amount [assessedValue=533760, landValue=195000, improvementValue=338760, taxPresent=false, netValue=408760, homeownerExemption=125000, taxYear=2026, propertyClass=541, propertyClassDescription=Imp res lot/tract in city, source=Kootenai County Assessor (Assessor_Layers)]
- **Property tax**: ok. estimated 2026 tax $2,228.81 [taxTotal=2228.81, taxYear=2026, taxBasis=estimate, taxSource=Kootenai County, Rates for the Year 2026 (levy rate by tax area group)]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
