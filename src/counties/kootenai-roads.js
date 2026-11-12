// Public road centerlines for Kootenai County, ID (driveway length, src/services/road-access.js).
// Checked live with read-only `?f=json` queries on 2026-11-12.
//
// Kootenai County NewServices/Data_Layers layer 10 "Roads" (map.kcgov.us). Fields used:
// ST_NAME, PRE_DIR, ST_TYPE, STATUS ('PUBLIC' | 'PRIVATE' | 'MIXED') and CARTO_TYPE ('LOCAL ROAD',
// 'SEASONAL ROAD', 'STATE HIGHWAY', 'U.S. HIGHWAY', 'INTERSTATE', 'BIKE TRAIL', 'WATER').
// Only STATUS 'PUBLIC' counts ('MIXED' is partly private, so it is left out), and only road
// types a home can take access from (no interstate, bike trail or ferry/water segments).
// Seasonal public roads are kept; the answer names the road type so the report can say so.

export const KOOTENAI_ROADS_LAYER = 'https://map.kcgov.us/arcgis/rest/services/NewServices/Data_Layers/MapServer/10';

const text = v => (v == null ? '' : String(v).trim());

export const KOOTENAI_ROADS = {
  state: 'ID', county: 'Kootenai',
  source: { name: 'Kootenai County GIS Roads (public road centerlines)', url: KOOTENAI_ROADS_LAYER },
  layers: [
    {
      id: 'kootenai-roads', url: KOOTENAI_ROADS_LAYER,
      where: "STATUS = 'PUBLIC' AND CARTO_TYPE IN ('LOCAL ROAD','SEASONAL ROAD','STATE HIGHWAY','U.S. HIGHWAY')",
      outFields: 'PRE_DIR,ST_NAME,ST_TYPE,CARTO_TYPE',
      describe: a => ({ name: [text(a.PRE_DIR), text(a.ST_NAME), text(a.ST_TYPE)].filter(Boolean).join(' '), kind: text(a.CARTO_TYPE).toLowerCase() })
    }
  ]
};
