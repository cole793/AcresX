import { upstreamJson } from '../../shared/upstream.js';

// Washington Ecology well reports (WR/FeatureServer/9), the layer the browser's findWells reads
// through /api/arcgis (public/index.html). Used by the terrain-aware depth estimate
// (src/services/well-depth-terrain.js). Ecology records carry no land-surface elevation, and
// CompletedDepth / StaticWaterLvl are text fields ("120", "45.5", "").
// OwnerName and WellAddress are not requested (owner decision, 2026-10-29). ProjectName (free
// text, often the owner's surname) is requested only for the nonresidential check in
// src/services/well-depth-terrain.js candidateOf(); the route never returns record properties.
export const ECOLOGY_WELLS = 'https://services.arcgis.com/6lCKYNJLvwTXqrmp/ArcGIS/rest/services/WR/FeatureServer/9/query';

const number = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Every Ecology well report with a completed depth within `miles` (a square envelope) of the point.
export async function findWashingtonWellCandidates({ lat, lon, miles, timeoutMs = 12000, retryTimeoutMs = 8000 }) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Washington well search requires parcel coordinates.');
  const latPad = miles / 69;
  const lonPad = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const url = new URL(ECOLOGY_WELLS);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', "WellProjectType <> 'Decommission'");
  url.searchParams.set('geometry', JSON.stringify({ xmin: lon - lonPad, ymin: lat - latPad, xmax: lon + lonPad, ymax: lat + latPad, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outFields', 'ID,WellTagNr,ProjectName,FileName,CompletedDepth,WorkCompletionDate,WellProjectType,WellSubType,StaticWaterLvl,FlowRateGPM');
  url.searchParams.set('resultRecordCount', '2000');
  const data = await upstreamJson(url, {
    timeoutMs, retryTimeoutMs, arcgis: true,
    label: 'wa-ecology-wells', agency: 'Washington Ecology well service', arcgisMessage: 'Washington Ecology well lookup failed'
  });
  return (data.features || [])
    .filter(f => f?.geometry?.type === 'Point' && Number.isFinite(Number(f.geometry.coordinates?.[0])) && Number.isFinite(Number(f.geometry.coordinates?.[1])))
    .map(f => {
      const p = f.properties || {};
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])] },
        properties: {
          ID: p.ID ?? '', WellTagNr: p.WellTagNr || '', ProjectName: p.ProjectName || '', FileName: p.FileName || '',
          CompletedDepth: number(p.CompletedDepth), StaticWaterLvl: number(p.StaticWaterLvl), FlowRateGPM: p.FlowRateGPM ?? null,
          WorkCompletionDate: p.WorkCompletionDate ?? null, WellProjectType: p.WellProjectType || '', WellSubType: p.WellSubType || '',
          _source: 'Washington State Department of Ecology well reports'
        }
      };
    })
    .filter(f => f.properties.CompletedDepth > 0);
}
