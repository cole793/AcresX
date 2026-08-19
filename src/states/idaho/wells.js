import { fetchWithTimeout } from '../../shared/http.js';

const IDAHO_WELLS = 'https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0';

export async function findIdahoWells({ lat, lon }) {
  const y = Number(lat), x = Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x)) throw new Error('Idaho well search requires parcel coordinates.');

  const radii = [2, 5, 10, 20, 40];
  let features = [];
  for (const miles of radii) {
    const url = new URL(`${IDAHO_WELLS}/query`);
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('where', 'TotalDepth > 0');
    url.searchParams.set('geometry', `${x},${y}`);
    url.searchParams.set('geometryType', 'esriGeometryPoint');
    url.searchParams.set('inSR', '4326');
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    url.searchParams.set('distance', String(miles));
    url.searchParams.set('units', 'esriSRUnit_StatuteMile');
    url.searchParams.set('outFields', 'WellID,PermitID,MetalTagNumber,ConstructionDate,Owner,WellUse,CountyName,WellAddress,ProductionRate,StaticWaterLevel,CasingDepth,TotalDepth,WellDocs,Latitude,Longitude');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('resultRecordCount', '200');
    const response = await fetchWithTimeout(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 20000);
    if (!response.ok) throw new Error(`Idaho well service returned ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Idaho well search failed');
    features = (data.features || []).filter(f => Number(f?.properties?.TotalDepth) > 0);
    if (features.length >= 5) break;
  }

  const wells = features.map(feature => {
    const p = feature.properties || {};
    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ...p,
        ID: p.WellID,
        WellTagNr: p.MetalTagNumber || p.PermitID || p.WellID,
        ProjectName: p.Owner || p.WellUse || 'Idaho well record',
        CompletedDepth: p.TotalDepth,
        StaticWaterLvl: p.StaticWaterLevel,
        FlowRateGPM: p.ProductionRate,
        WorkCompletionDate: p.ConstructionDate,
        FileName: p.WellDocs,
        _source: 'Idaho Department of Water Resources'
      }
    };
  });

  return {
    available: true,
    state: 'ID',
    source: 'Idaho Department of Water Resources Well Database',
    wells
  };
}
