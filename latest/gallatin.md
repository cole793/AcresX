# County validation: Gallatin, MT

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-10T20:29:25.122Z
- Parcels: 12, with an error or mismatch: 0
- Layer results: ok 142, unavailable 38, error 0, mismatch 0, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Public water/sewer | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 06079621201790000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06079611101010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06069818101020000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06079801358210000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06069905302080000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06069624301010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06033804413010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06033908402700000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06110827101470000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable | ok | unavailable |
| 06101033302010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | unavailable | ok | unavailable |
| 06042734301530000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 06079812230210000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |

## Parcel details

### 06079621201790000 (no locality, 19.33 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Rural vacant land in the county unzoned area. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): no MSDI water/sewer district, GDA planning area or city polygon at the point; no Bozeman main within 300 m.

- **Parcel**: ok. parcel 06079621201790000, 19.34 ac (mapped) [parcelId=06079621201790000, acres=19.34, lat=45.649725, lon=-111.360764, acresSource=mapped outline]
- **Wells**: ok. 109 well record(s), 5 of nearest 5 report depth [wellCount=109, nearestDepthsCount=5, nearestMi=0.04, medianDepthFt=540]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Amsterdam-Quagle silt loams, 4 to 8 percent slopes) [feasibility=favorable, mapUnit=Amsterdam-Quagle silt loams, 4 to 8 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=6]
- **Terrain**: ok. avg grade 2.1%, max 4.7% [gradePct=2.1, maxGradePct=4.7, reliefFt=39, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.2% [cellCount=16, avgSlopePct=5.2, maxSlopePct=7.8, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Gallatin County) [code=UNZONED, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=unzoned, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $1,221, no tax amount [assessedValue=1221, landValue=1221, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06079611101010000 (MANHATTAN, 316.8 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large improved parcel near Manhattan, outside town limits, in the county unzoned area.

- **Parcel**: ok. parcel 06079611101010000, 316.97 ac (mapped) [parcelId=06079611101010000, acres=316.97, address=11070 LITTLE HOLLAND RD, MANHATTAN, MT 59741, lat=45.679787, lon=-111.315607, acresSource=mapped outline]
- **Wells**: ok. 113 well record(s), 5 of nearest 5 report depth [wellCount=113, nearestDepthsCount=5, nearestMi=0.37, medianDepthFt=163]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Cabbart-Amesha-Trimad complex, 15 to 45 percent slopes) [feasibility=limited, mapUnit=Cabbart-Amesha-Trimad complex, 15 to 45 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=30]
- **Terrain**: ok. avg grade 3%, max 6.2% [gradePct=3, maxGradePct=6.2, reliefFt=199, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.7% [cellCount=16, avgSlopePct=5.7, maxSlopePct=13.2, partial=false]
- **Flood**: ok. zones X, D (via FEMA NFHL) [high=false, intersects=true, zones=X; D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 4 NWI feature(s) [intersects=true, count=4, coveragePct=1]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Gallatin County) [code=UNZONED, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=unzoned, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $530,345, no tax amount [assessedValue=530345, landValue=221765, improvementValue=308580, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06069818101020000 (BOZEMAN, 2.97 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Improved parcel with a Bozeman mailing locality, outside city limits, in the county unzoned area.

- **Parcel**: ok. parcel 06069818101020000, 2.97 ac (mapped) [parcelId=06069818101020000, acres=2.97, address=15230 COTTONWOOD RD, BOZEMAN, MT 59715, lat=45.583371, lon=-111.153633, acresSource=mapped outline]
- **Wells**: ok. 425 well record(s), 5 of nearest 5 report depth [wellCount=425, nearestDepthsCount=5, nearestMi=0.11, medianDepthFt=40]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Hyalite-Beaverton complex, 0 to 4 percent slopes) [feasibility=favorable, mapUnit=Hyalite-Beaverton complex, 0 to 4 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=2]
- **Terrain**: ok. avg grade 3.4%, max 8.6% [gradePct=3.4, maxGradePct=8.6, reliefFt=19, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 5.8% [cellCount=16, avgSlopePct=5.8, maxSlopePct=15.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=0.7]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Gallatin County) [code=UNZONED, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=unzoned, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $1,067,605, no tax amount [assessedValue=1067605, landValue=716325, improvementValue=351280, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06079801358210000 (no locality, 0.1 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small lot inside Bozeman city limits; was "No mapped zoning district", now City of Bozeman zoning. Expected values checked by hand on 2026-11-02 (read-only): Gallatin city limits layer 267 returns NAME Bozeman: https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/Gallatin_Incorporated_Cities_and_Towns/FeatureServer/267/query?geometry=-111.056899%2C45.687377&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NAME&returnGeometry=false&f=json; City of Bozeman Zoning returns ZONING R-3: https://gisweb.bozeman.net/arcgis/rest/services/Open_Data/Zoning/FeatureServer/0/query?geometry=-111.056899%2C45.687377&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONING&returnGeometry=false&f=json; county layer 42 returns no feature; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned X (area of minimal flood hazard).

- **Parcel**: ok. parcel 06079801358210000, 0.1 ac (mapped) [parcelId=06079801358210000, acres=0.1, address=759 N 15TH AVE, lat=45.687373, lon=-111.056939, acresSource=mapped outline]
- **Wells**: ok. 1505 well record(s), 5 of nearest 5 report depth [wellCount=1505, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=42]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Blossberg loam, 0 to 2 percent slopes) [feasibility=limited, mapUnit=Blossberg loam, 0 to 2 percent slopes, hydrologicGroup=B/D, drainage=Poorly drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 1.3%, max 3.1% [gradePct=1.3, maxGradePct=3.1, reliefFt=3, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2.8% [cellCount=16, avgSlopePct=2.8, maxSlopePct=10, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water served (City of Bozeman) 9 m; sewer served (City of Bozeman) 13 m [water=served, sewer=served, waterProvider=City of Bozeman, sewerProvider=City of Bozeman, waterProviders=City of Bozeman; Bozeman - Drinking Water & Wastewater Planning Area, sewerProviders=City of Bozeman; Bozeman - Drinking Water & Wastewater Planning Area, waterPublic=true, sewerPublic=true, waterDistanceM=9, sewerDistanceM=13, failedLayers=(none)]
- **Zoning**: ok. R-3 (City of Bozeman) [code=R-3, jurisdiction=City of Bozeman, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $662,000, no tax amount [assessedValue=662000, landValue=206513, improvementValue=455487, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06069905302080000 (BOZEMAN, 9.88 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Zoned county parcel south of Bozeman (Hyalite district); returned an empty zone code before the field-mapping fix. Expected values checked by hand on 2026-11-02 (read-only): county zoning layer 42 returns INNERZONE RR-10, DISTRICT_N HYALITE: https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/County_Zoning_Districts/FeatureServer/42/query?geometry=-111.016503%2C45.599720&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=INNERZONE%2CDISTRICT_N%2CZONED&returnGeometry=false&f=json; the outline intersects only RR-10; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned X (area of minimal flood hazard).

- **Parcel**: ok. parcel 06069905302080000, 9.88 ac (mapped) [parcelId=06069905302080000, acres=9.88, address=SKYRIDGE DR, BOZEMAN, MT 59715, lat=45.599921, lon=-111.016656, acresSource=mapped outline]
- **Wells**: ok. 555 well record(s), 5 of nearest 5 report depth [wellCount=555, nearestDepthsCount=5, nearestMi=0.09, medianDepthFt=228]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Bavdark loam, 8 to 25 percent slopes) [feasibility=limited, mapUnit=Bavdark loam, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=17]
- **Terrain**: ok. avg grade 10.6%, max 20% [gradePct=10.6, maxGradePct=20, reliefFt=171, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 15.1% [cellCount=16, avgSlopePct=15.1, maxSlopePct=23.1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); PARK ELECTRIC COOP INC [providers=NORTHWESTERN ENERGY LLC - (MT); PARK ELECTRIC COOP INC]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RR-10 (Gallatin County) [code=RR-10, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $1,228,455, no tax amount [assessedValue=1228455, landValue=1228455, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06069624301010000 (no locality, 158.98 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large rural vacant parcel in the county unzoned area (INNERZONE UNZ). Expected values checked by hand on 2026-11-02 (read-only): county zoning layer 42 returns INNERZONE UNZ, ZONED UNZONED: https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/County_Zoning_Districts/FeatureServer/42/query?geometry=-111.305586%2C45.558961&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=INNERZONE%2CDISTRICT_N%2CZONED&returnGeometry=false&f=json; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned D (undetermined).

- **Parcel**: ok. parcel 06069624301010000, 159.05 ac (mapped) [parcelId=06069624301010000, acres=159.05, lat=45.558556, lon=-111.305016, acresSource=mapped outline]
- **Wells**: ok. 11 well record(s), 5 of nearest 5 report depth [wellCount=11, nearestDepthsCount=5, nearestMi=1.59, medianDepthFt=524]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Bangtail-Adel loams, 4 to 25 percent slopes) [feasibility=moderate, mapUnit=Bangtail-Adel loams, 4 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=15]
- **Terrain**: ok. avg grade 13.2%, max 22.3% [gradePct=13.2, maxGradePct=22.3, reliefFt=654, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 22.4% [cellCount=16, avgSlopePct=22.4, maxSlopePct=30.6, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 2 NWI feature(s) [intersects=true, count=2, coveragePct=0.8]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Gallatin County) [code=UNZONED, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=unzoned, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $18,108, no tax amount [assessedValue=18108, landValue=18108, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06033804413010000 (BIG SKY, 3.32 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Big Sky vacant lot (Big Sky zoning district); returned an empty zone code before the field-mapping fix. Expected values checked by hand on 2026-11-02 (read-only): county zoning layer 42 returns INNERZONE RC-SF-10, DISTRICT_N BIG SKY: https://services3.arcgis.com/JuknJLoAEm9DTWXh/ArcGIS/rest/services/County_Zoning_Districts/FeatureServer/42/query?geometry=-111.360143%2C45.246635&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=INNERZONE%2CDISTRICT_N%2CZONED&returnGeometry=false&f=json; the outline intersects only RC-SF-10; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned D (undetermined).

- **Parcel**: ok. parcel 06033804413010000, 3.33 ac (mapped) [parcelId=06033804413010000, acres=3.33, address=WILDERNESS RIDGE TRL, BIG SKY, MT 59716, lat=45.246655, lon=-111.36022, acresSource=mapped outline]
- **Wells**: ok. 246 well record(s), 5 of nearest 5 report depth [wellCount=246, nearestDepthsCount=5, nearestMi=0.02, medianDepthFt=1058]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Yellowmule-Ouselfal complex, 8 to 25 percent slopes) [feasibility=limited, mapUnit=Yellowmule-Ouselfal complex, 8 to 25 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=17]
- **Terrain**: ok. avg grade 9.8%, max 19% [gradePct=9.8, maxGradePct=19, reliefFt=113, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 16.2% [cellCount=16, avgSlopePct=16.2, maxSlopePct=25.6, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RC-SF-10 (Gallatin County) [code=RC-SF-10, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $2,012,317, no tax amount [assessedValue=2012317, landValue=2012317, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06033908402700000 (GALLATIN GATEWAY, 0.42 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small improved lot near Big Sky / Gallatin Gateway (R-SF-11000); returned an empty zone code before the fix.

- **Parcel**: ok. parcel 06033908402700000, 0.42 ac (mapped) [parcelId=06033908402700000, acres=0.42, address=16 BEARTOOTH RD, GALLATIN GATEWAY, MT 59730, lat=45.238616, lon=-111.253517, acresSource=mapped outline]
- **Wells**: ok. 313 well record(s), 5 of nearest 5 report depth [wellCount=313, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=202]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Bridger loam, 2 to 8 percent slopes) [feasibility=favorable, mapUnit=Bridger loam, 2 to 8 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=5]
- **Terrain**: ok. avg grade 1.6%, max 2.9% [gradePct=1.6, maxGradePct=2.9, reliefFt=5, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.2% [cellCount=16, avgSlopePct=3.2, maxSlopePct=7.7, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. R-SF-11000 (Gallatin County) [code=R-SF-11000, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $1,479,400, no tax amount [assessedValue=1479400, landValue=327612, improvementValue=1151788, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06110827101470000 (MANHATTAN, 19.79 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Improved parcel near Manhattan in a gap of the county zoning map (no district and no unzoned polygon), outside mapped town limits.

- **Parcel**: ok. parcel 06110827101470000, 19.8 ac (mapped) [parcelId=06110827101470000, acres=19.8, address=170 HOSS RIDGE RD, MANHATTAN, MT 59741, lat=45.90107, lon=-111.335438, acresSource=mapped outline]
- **Wells**: ok. 149 well record(s), 5 of nearest 5 report depth [wellCount=149, nearestDepthsCount=5, nearestMi=0.1, medianDepthFt=500]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Amesha loam, 8 to 15 percent slopes) [feasibility=moderate, mapUnit=Amesha loam, 8 to 15 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=12]
- **Terrain**: ok. avg grade 6.2%, max 15% [gradePct=6.2, maxGradePct=15, reliefFt=118, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 14.2% [cellCount=16, avgSlopePct=14.2, maxSlopePct=35.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: unavailable. No mapped zoning district [jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: ok. assessed $1,554,437, no tax amount [assessedValue=1554437, landValue=213407, improvementValue=1341030, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06101033302010000 (no locality, 74.64 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large exempt parcel near Belgrade (River Rock area) in a gap of the county zoning map (no district and no unzoned polygon), outside mapped city limits.

- **Parcel**: ok. parcel 06101033302010000, 74.68 ac (mapped) [parcelId=06101033302010000, acres=74.68, lat=45.790464, lon=-111.239659, acresSource=mapped outline]
- **Wells**: ok. 1580 well record(s), 5 of nearest 5 report depth [wellCount=1580, nearestDepthsCount=5, nearestMi=0.17, medianDepthFt=73]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Beaverell loam, 0 to 2 percent slopes) [feasibility=favorable, mapUnit=Beaverell loam, 0 to 2 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0.5%, max 0.7% [gradePct=0.5, maxGradePct=0.7, reliefFt=20, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.7% [cellCount=16, avgSlopePct=0.7, maxSlopePct=1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: unavailable. No mapped zoning district [jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=no_mapped_result, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: no zoning code returned (the browser skips this call too)
- **Assessment**: ok. assessed $4,500, no tax amount [assessedValue=4500, landValue=4500, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06042734301530000 (no locality, 2.76 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Big Sky vacant lot (RC-SF-2.5); returned an empty zone code before the fix.

- **Parcel**: ok. parcel 06042734301530000, 2.76 ac (mapped) [parcelId=06042734301530000, acres=2.76, address=OUTLOOK TRL, lat=45.266901, lon=-111.344732, acresSource=mapped outline]
- **Wells**: ok. 315 well record(s), 5 of nearest 5 report depth [wellCount=315, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=140]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Lonniebee-Cowood complex, 35 to 60 percent slopes) [feasibility=limited, mapUnit=Lonniebee-Cowood complex, 35 to 60 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=48]
- **Terrain**: ok. avg grade 11.3%, max 20.8% [gradePct=11.3, maxGradePct=20.8, reliefFt=150, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 22% [cellCount=16, avgSlopePct=22, maxSlopePct=33, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=2.3]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. RC-SF-2.5 (Gallatin County) [code=RC-SF-2.5, jurisdiction=Gallatin County, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $869,596, no tax amount [assessedValue=869596, landValue=869596, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 06079812230210000 (no locality, 0.26 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small lot inside Bozeman city limits; was "No mapped zoning district", now City of Bozeman zoning (R-2). Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): Bozeman COB_Utilities Wastewater_Utility/MapServer/8 collector 3.3 m and Water_Utility/MapServer/6 distribution main 12.0 m from the outline; inside Bozeman city limits (layer 267).

- **Parcel**: ok. parcel 06079812230210000, 0.26 ac (mapped) [parcelId=06079812230210000, acres=0.26, address=518 N 17TH AVE, lat=45.685405, lon=-111.059186, acresSource=mapped outline]
- **Wells**: ok. 1476 well record(s), 5 of nearest 5 report depth [wellCount=1476, nearestDepthsCount=5, nearestMi=0.11, medianDepthFt=42]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Urban land) [feasibility=moderate, mapUnit=Urban land, soilSlopePct=0]
- **Terrain**: ok. avg grade 2.5%, max 3.8% [gradePct=2.5, maxGradePct=3.8, reliefFt=3, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 1.4% [cellCount=16, avgSlopePct=1.4, maxSlopePct=1.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT) [providers=NORTHWESTERN ENERGY LLC - (MT)]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water served (City of Bozeman) 12 m; sewer served (City of Bozeman) 3 m [water=served, sewer=served, waterProvider=City of Bozeman, sewerProvider=City of Bozeman, waterProviders=City of Bozeman; Bozeman - Drinking Water & Wastewater Planning Area, sewerProviders=City of Bozeman; Bozeman - Drinking Water & Wastewater Planning Area, waterPublic=true, sewerPublic=true, waterDistanceM=12, sewerDistanceM=3, failedLayers=(none)]
- **Zoning**: ok. R-2 (City of Bozeman) [code=R-2, jurisdiction=City of Bozeman, countyStatus=gallatin-v3, zoningStatus=gis_match, permitHistoryStatus=unavailable]
- **Zoning rules**: unavailable. not requested: the browser has no zoning rules for Gallatin
- **Assessment**: ok. assessed $742,800, no tax amount [assessedValue=742800, landValue=302880, improvementValue=439920, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
