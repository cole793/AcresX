# County validation: Yellowstone, MT

- Base URL: https://acresx.cole-groshens.workers.dev
- Run: 2026-11-13T20:44:47.349Z
- Parcels: 12, with an error or mismatch: 0
- Layer results: ok 152, unavailable 28, error 0, mismatch 0, skipped 0

| Parcel | Parcel | Wells | Existing well | Soil | Terrain | Slope grid | Flood | Wetlands | Utility | Power | Public water/sewer | Zoning | Zoning rules | Assessment | Listing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 03113520290010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 03072530104010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 03103333215010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03103233201230000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03113517000000000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 03072527101010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03103333303010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03103233202530000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03113519316050000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable | ok | unavailable |
| 03072528309010000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03103333414250000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |
| 03103233202670000 | ok | ok | unavailable | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | unavailable |

## Parcel details

### 03113520290010000 (no locality, 12.47 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Rural vacant land with no polygon in any Yellowstone zoning layer; the unzoned case (was "No mapped zoning district found"). Expected values checked by hand on 2026-11-02 (read-only): no feature in layers 7, 4, 8, 0, 2 or 1 at an interior point, e.g. https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/2/query?geometry=-108.271860%2C45.912034&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned X. Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): no MSDI, county (layer 27) or Lockwood (18-20) district and no zoning jurisdiction at the point.

- **Parcel**: ok. parcel 03113520290010000, 12.48 ac (mapped) [parcelId=03113520290010000, acres=12.48, lat=45.911619, lon=-108.271699, acresSource=mapped outline]
- **Wells**: ok. 382 well record(s), 5 of nearest 5 report depth [wellCount=382, nearestDepthsCount=5, nearestMi=0.19, medianDepthFt=21]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Vananda silty clay, 0 to 1 percent slopes) [feasibility=limited, mapUnit=Vananda silty clay, 0 to 1 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0.2%, max 0.4% [gradePct=0.2, maxGradePct=0.4, reliefFt=5, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.2% [cellCount=16, avgSlopePct=0.2, maxSlopePct=0.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Yellowstone County) [code=UNZONED, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=unzoned, permitHistoryStatus=unavailable, source=primary]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $753, no tax amount [assessedValue=753, landValue=753, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03072530104010000 (no locality, 120.24 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large rural vacant parcel outside every zoning layer; unzoned case (was "No mapped zoning district found").

- **Parcel**: ok. parcel 03072530104010000, 120.3 ac (mapped) [parcelId=03072530104010000, acres=120.3, lat=45.549337, lon=-108.678552, acresSource=mapped outline]
- **Wells**: ok. 32 well record(s), 5 of nearest 5 report depth [wellCount=32, nearestDepthsCount=5, nearestMi=0.79, medianDepthFt=37]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. moderate (Grail soils, 2 to 15 percent slopes) [feasibility=moderate, mapUnit=Grail soils, 2 to 15 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=9]
- **Terrain**: ok. avg grade 6.8%, max 18.2% [gradePct=6.8, maxGradePct=18.2, reliefFt=324, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 14.8% [cellCount=16, avgSlopePct=14.8, maxSlopePct=27.3, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 5 NWI feature(s) [intersects=true, count=5, coveragePct=2.3]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Yellowstone County) [code=UNZONED, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=unzoned, permitHistoryStatus=unavailable, source=primary]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $7,592, no tax amount [assessedValue=7592, landValue=7592, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103333215010000 (BILLINGS, 2.9 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Billings, inside the Billings zoning jurisdiction (layer 7 entity BILLINGS); the parcel that showed jurisdiction "2". Its outline is curved, so the vertex average falls outside it on a neighbouring NX3 polygon (the old answer); the outline itself is P1 with an edge touching NX2. Expected values checked by hand on 2026-11-02 (read-only): layer 7 at an interior point returns ZoningJurisdictions_Entity BILLINGS: https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/7/query?geometry=-108.506970%2C45.796300&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; Billings zoning layer 4 at the same interior point returns ZONE_CODE P1: https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/4/query?geometry=-108.506970%2C45.796300&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; layer 4 queried with the parcel outline returns P1 and NX2; sampled over about 1,300 points P1 covers 99.7% of the parcel and NX2 only touches its edge; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned X (area of minimal flood hazard).

- **Parcel**: ok. parcel 03103333215010000, 2.91 ac (mapped) [parcelId=03103333215010000, acres=2.91, address=1105 N 21ST ST, lat=45.79691, lon=-108.50538, acresSource=mapped outline]
- **Wells**: ok. 1486 well record(s), 5 of nearest 5 report depth [wellCount=1486, nearestDepthsCount=5, nearestMi=0.34, medianDepthFt=22.5]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McRae loam, 4 to 7 percent slopes) [feasibility=favorable, mapUnit=McRae loam, 4 to 7 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=6]
- **Terrain**: ok. avg grade 7.1%, max 20.4% [gradePct=7.1, maxGradePct=20.4, reliefFt=68, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 15.5% [cellCount=16, avgSlopePct=15.5, maxSlopePct=23.2, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. P1 (City of Billings) · overlays: none mapped [code=P1, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. P1: Public / Institutional (6 uses) [code=P1, family=Public / Institutional, useCount=6]
- **Assessment**: ok. assessed $324,700, no tax amount [assessedValue=324700, landValue=129397, improvementValue=195303, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103233201230000 (BILLINGS, 0.41 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small Billings residential lot (west end). Expected values checked by hand on 2026-11-02 (read-only): Billings zoning layer 4 returns ZONE_CODE N3: https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/4/query?geometry=-108.630387%2C45.791953&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; layer 7 returns BILLINGS: https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/7/query?geometry=-108.630387%2C45.791953&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned X (area of minimal flood hazard). Public water/sewer hand-checked 2026-11-09 (read-only queries of the layers themselves, not through AcresX): Zoning/MapServer/7 ZoningJurisdictions_Entity 'BILLINGS'; no MSDI or county water/sewer district polygon; no reachable Billings utility map.

- **Parcel**: ok. parcel 03103233201230000, 0.41 ac (mapped) [parcelId=03103233201230000, acres=0.41, address=4541 EDGEWATER CIR, lat=45.79188, lon=-108.630517, acresSource=mapped outline]
- **Wells**: ok. 686 well record(s), 5 of nearest 5 report depth [wellCount=686, nearestDepthsCount=5, nearestMi=0.1, medianDepthFt=83]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McRae loam, 1 to 4 percent slopes) [feasibility=favorable, mapUnit=McRae loam, 1 to 4 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=3]
- **Terrain**: ok. avg grade 1.5%, max 2.2% [gradePct=1.5, maxGradePct=2.2, reliefFt=5, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 2.2% [cellCount=16, avgSlopePct=2.2, maxSlopePct=2.5, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. N3 (City of Billings) · overlays: none mapped [code=N3, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. N3: Neighborhood Residential (6 uses) [code=N3, family=Neighborhood Residential, useCount=6]
- **Assessment**: ok. assessed $857,700, no tax amount [assessedValue=857700, landValue=149932, improvementValue=707768, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03113517000000000 (no locality, 20.97 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Rural parcel with no situs address, multipart outline (4 rings) and no zoning polygon; unzoned case and multipart geometry.

- **Parcel**: ok. parcel 03113517000000000, 20.99 ac (mapped) [parcelId=03113517000000000, acres=20.99, lat=45.9168, lon=-108.264805, acresSource=mapped outline]
- **Wells**: ok. 293 well record(s), 5 of nearest 5 report depth [wellCount=293, nearestDepthsCount=5, nearestMi=0.12, medianDepthFt=29]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Vananda silty clay, 0 to 1 percent slopes) [feasibility=limited, mapUnit=Vananda silty clay, 0 to 1 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0.2%, max 0.7% [gradePct=0.2, maxGradePct=0.7, reliefFt=17, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.4% [cellCount=16, avgSlopePct=0.4, maxSlopePct=1, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Yellowstone County) [code=UNZONED, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=unzoned, permitHistoryStatus=unavailable, source=primary]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed n/a, no tax amount [taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03072527101010000 (no locality, 281.17 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large rural parcel inside Special Zoning District 16 (county layer 2), outside the Billings jurisdiction. Expected values checked by hand on 2026-11-02 (read-only): county Zoning Districts layer 2 returns CODE D16: https://gis.yellowstonecountymt.gov/arcgis/rest/services/Zoning/MapServer/2/query?geometry=-108.623451%2C45.545177&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ZONE_CODE%2CZONE_NAME%2CCODE%2CZoningJurisdictions_Entity&returnGeometry=false&f=json; layer 7 returns no jurisdiction polygon for the parcel outline; FEMA NFHL https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query (POST, parcel outline, outFields FLD_ZONE,ZONE_SUBTY) returned D (undetermined).

- **Parcel**: ok. parcel 03072527101010000, 281.28 ac (mapped) [parcelId=03072527101010000, acres=281.28, lat=45.545434, lon=-108.624805, acresSource=mapped outline]
- **Wells**: ok. 29 well record(s), 5 of nearest 5 report depth [wellCount=29, nearestDepthsCount=5, nearestMi=1.97, medianDepthFt=43]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Maginnis channery clay loam, 15 to 35 percent slopes) [feasibility=limited, mapUnit=Maginnis channery clay loam, 15 to 35 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=25]
- **Terrain**: ok. avg grade 1.9%, max 4.4% [gradePct=1.9, maxGradePct=4.4, reliefFt=162, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 8.3% [cellCount=16, avgSlopePct=8.3, maxSlopePct=15.6, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 6 NWI feature(s) [intersects=true, count=6, coveragePct=2.3]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. D16 (Yellowstone County) · overlays: none mapped [code=D16, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. D16: Special / Other (1 uses) [code=D16, family=Special / Other, useCount=1]
- **Assessment**: ok. assessed $16,479, no tax amount [assessedValue=16479, landValue=16479, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103333303010000 (BILLINGS, 1 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Downtown Billings exempt property (CBD zoning).

- **Parcel**: ok. parcel 03103333303010000, 1 ac (mapped) [parcelId=03103333303010000, acres=1, address=220 N 25TH ST, lat=45.784964, lon=-108.503716, acresSource=mapped outline]
- **Wells**: ok. 1572 well record(s), 5 of nearest 5 report depth [wellCount=1572, nearestDepthsCount=5, nearestMi=0.03, medianDepthFt=25]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Lohmiller silty clay, 0 to 1 percent slopes) [feasibility=favorable, mapUnit=Lohmiller silty clay, 0 to 1 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0.2%, max 0.3% [gradePct=0.2, maxGradePct=0.3, reliefFt=1, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 1.4% [cellCount=16, avgSlopePct=1.4, maxSlopePct=5.2, partial=false]
- **Flood**: ok. no high/moderate-risk zone mapped (via Esri USA Flood Hazard Areas, high/moderate-risk zones only) [high=false, intersects=false, zones=(none), category=limited, provider=Esri USA Flood Hazard Areas, coverage=high-and-moderate-risk-only, emptyResult=true]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. CBD (City of Billings) · overlays: none mapped [code=CBD, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. CBD: Commercial (4 uses) [code=CBD, family=Commercial, useCount=4]
- **Assessment**: ok. assessed $6,981,390, no tax amount [assessedValue=6981390, landValue=1719500, improvementValue=5261890, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103233202530000 (BILLINGS, 0.34 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small Billings residential lot (west end, N3).

- **Parcel**: ok. parcel 03103233202530000, 0.34 ac (mapped) [parcelId=03103233202530000, acres=0.34, address=2280 RIDGEWOOD LN S, lat=45.793066, lon=-108.628665, acresSource=mapped outline]
- **Wells**: ok. 686 well record(s), 5 of nearest 5 report depth [wellCount=686, nearestDepthsCount=5, nearestMi=0.03, medianDepthFt=79]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Glenberg fine sandy loam, 1 to 4 percent slopes) [feasibility=favorable, mapUnit=Glenberg fine sandy loam, 1 to 4 percent slopes, hydrologicGroup=A, drainage=Well drained, soilSlopePct=3]
- **Terrain**: ok. avg grade 2.4%, max 4.1% [gradePct=2.4, maxGradePct=4.1, reliefFt=7, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 4.2% [cellCount=16, avgSlopePct=4.2, maxSlopePct=9.8, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. N3 (City of Billings) · overlays: none mapped [code=N3, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. N3: Neighborhood Residential (6 uses) [code=N3, family=Neighborhood Residential, useCount=6]
- **Assessment**: ok. assessed $701,200, no tax amount [assessedValue=701200, landValue=135215, improvementValue=565985, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03113519316050000 (no locality, 5.19 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 5-40 ac). Rural vacant parcel with no zoning polygon; unzoned case (was "No mapped zoning district found").

- **Parcel**: ok. parcel 03113519316050000, 5.19 ac (mapped) [parcelId=03113519316050000, acres=5.19, lat=45.906252, lon=-108.291924, acresSource=mapped outline]
- **Wells**: ok. 336 well record(s), 5 of nearest 5 report depth [wellCount=336, nearestDepthsCount=5, nearestMi=0.07, medianDepthFt=26]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Haverson loam, 0 to 1 percent slopes) [feasibility=favorable, mapUnit=Haverson loam, 0 to 1 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0%, max 0.3% [gradePct=0, maxGradePct=0.3, reliefFt=1, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 1.3% [cellCount=16, avgSlopePct=1.3, maxSlopePct=3.1, partial=false]
- **Flood**: ok. high-risk zone (AE) (via FEMA NFHL) [high=true, intersects=true, zones=AE, category=high, provider=FEMA NFHL]
- **Wetlands**: ok. 1 NWI feature(s) [intersects=true, count=1, coveragePct=5.5]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. UNZONED (Yellowstone County) [code=UNZONED, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=unzoned, permitHistoryStatus=unavailable, source=primary]
- **Zoning rules**: unavailable. zone_not_mapped [status=zone_not_mapped]
- **Assessment**: ok. assessed $7,658, no tax amount [assessedValue=7658, landValue=7658, improvementValue=0, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03072528309010000 (no locality, 224.37 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 40+ ac). Large improved rural parcel inside Special Zoning District 16.

- **Parcel**: ok. parcel 03072528309010000, 224.47 ac (mapped) [parcelId=03072528309010000, acres=224.47, lat=45.544265, lon=-108.643746, acresSource=mapped outline]
- **Wells**: ok. 28 well record(s), 5 of nearest 5 report depth [wellCount=28, nearestDepthsCount=5, nearestMi=1.05, medianDepthFt=43]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. limited (Absarokee clay loam, 4 to 7 percent slopes) [feasibility=limited, mapUnit=Absarokee clay loam, 4 to 7 percent slopes, hydrologicGroup=D, drainage=Well drained, soilSlopePct=6]
- **Terrain**: ok. avg grade 3.4%, max 5.2% [gradePct=3.4, maxGradePct=5.2, reliefFt=224, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 6% [cellCount=16, avgSlopePct=6, maxSlopePct=12.4, partial=false]
- **Flood**: ok. zones D (via FEMA NFHL) [high=false, intersects=true, zones=D, category=undetermined, provider=FEMA NFHL]
- **Wetlands**: ok. 3 NWI feature(s) [intersects=true, count=3, coveragePct=1.1]
- **Utility**: ok. YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. YELLOWSTONE VALLEY ELEC CO-OP [provider=YELLOWSTONE VALLEY ELEC CO-OP, confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water not_found; sewer not_found [water=not_found, sewer=not_found, waterProviders=(none), sewerProviders=(none), waterPublic=false, sewerPublic=false, failedLayers=(none)]
- **Zoning**: ok. D16 (Yellowstone County) · overlays: none mapped [code=D16, jurisdiction=Yellowstone County, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. D16: Special / Other (1 uses) [code=D16, family=Special / Other, useCount=1]
- **Assessment**: ok. assessed $44,238, no tax amount [assessedValue=44238, landValue=17308, improvementValue=26930, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103333414250000 (BILLINGS, 1.32 ac)

Why: Picked by the 2026-11-02 discovery run (acre band 1-5 ac). Billings East Billings Urban Renewal District zone (EB_CW).

- **Parcel**: ok. parcel 03103333414250000, 1.32 ac (mapped) [parcelId=03103333414250000, acres=1.32, address=111 N 17TH ST, lat=45.78924, lon=-108.491937, acresSource=mapped outline]
- **Wells**: ok. 1520 well record(s), 5 of nearest 5 report depth [wellCount=1520, nearestDepthsCount=5, nearestMi=0.04, medianDepthFt=20]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (Lohmiller silty clay, 0 to 1 percent slopes) [feasibility=favorable, mapUnit=Lohmiller silty clay, 0 to 1 percent slopes, hydrologicGroup=C, drainage=Well drained, soilSlopePct=1]
- **Terrain**: ok. avg grade 0.2%, max 0.5% [gradePct=0.2, maxGradePct=0.5, reliefFt=1, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 0.7% [cellCount=16, avgSlopePct=0.7, maxSlopePct=1.9, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. EB_CW (City of Billings) · overlays: none mapped [code=EB_CW, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. EB_CW: Special / Other (1 uses) [code=EB_CW, family=Special / Other, useCount=1]
- **Assessment**: ok. assessed $711,050, no tax amount [assessedValue=711050, landValue=590730, improvementValue=120320, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

### 03103233202670000 (BILLINGS, 0.37 ac)

Why: Picked by the 2026-11-02 discovery run (acre band under 1 ac). Small Billings residential lot (west end, N3).

- **Parcel**: ok. parcel 03103233202670000, 0.37 ac (mapped) [parcelId=03103233202670000, acres=0.37, address=2285 PARK RIDGE LN S, lat=45.793052, lon=-108.629537, acresSource=mapped outline]
- **Wells**: ok. 681 well record(s), 5 of nearest 5 report depth [wellCount=681, nearestDepthsCount=5, nearestMi=0.01, medianDepthFt=79]
- **Existing well**: unavailable. Existing-well matching is not configured for this county yet. [status=not_supported]
- **Soil**: ok. favorable (McRae loam, 1 to 4 percent slopes) [feasibility=favorable, mapUnit=McRae loam, 1 to 4 percent slopes, hydrologicGroup=B, drainage=Well drained, soilSlopePct=3]
- **Terrain**: ok. avg grade 2.2%, max 4.1% [gradePct=2.2, maxGradePct=4.1, reliefFt=6, sampleCount=9]
- **Slope grid**: ok. 16 cells, avg 3.9% [cellCount=16, avgSlopePct=3.9, maxSlopePct=4.3, partial=false]
- **Flood**: ok. zones X (via FEMA NFHL) [high=false, intersects=true, zones=X, category=minimal, provider=FEMA NFHL]
- **Wetlands**: ok. no NWI wetlands [intersects=false, count=0, coveragePct=0]
- **Utility**: ok. NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION [providers=NORTHWESTERN ENERGY LLC - (MT); YELLOWSTONE VALLEY ELEC CO-OP; WAPA-- WESTERN AREA POWER ADMINISTRATION]
- **Power**: ok. NORTHWESTERN ENERGY LLC - (MT) [provider=NORTHWESTERN ENERGY LLC - (MT), confidence=low, distributionStatus=no_verified_distance]
- **Public water/sewer**: ok. water likely (City of Billings); sewer likely (City of Billings) [water=likely, sewer=likely, waterProvider=City of Billings, sewerProvider=City of Billings, waterProviders=City of Billings, sewerProviders=City of Billings, waterPublic=true, sewerPublic=true, failedLayers=(none)]
- **Zoning**: ok. N3 (City of Billings) · overlays: none mapped [code=N3, jurisdiction=City of Billings, countyStatus=yellowstone-v2, zoningStatus=gis_match, permitHistoryStatus=unavailable, source=primary, overlays=(none), overlayTypes=(none)]
- **Zoning rules**: ok. N3: Neighborhood Residential (6 uses) [code=N3, family=Neighborhood Residential, useCount=6]
- **Assessment**: ok. assessed $737,500, no tax amount [assessedValue=737500, landValue=140610, improvementValue=596890, taxPresent=false, source=Montana Cadastral / ORION integration]
- **Listing**: unavailable. no listing match in connected dataset (not evidence the parcel is unlisted) [matchCount=500, confidence=insufficient]

Statuses: ok = usable data; unavailable = the API answered cleanly that the data is not available (or the browser would not request it); error = HTTP error, timeout, invalid JSON or an error field; mismatch = differs from `expected`; skipped = not run because the parcel lookup failed.
