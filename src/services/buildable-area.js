// Buildable-acres screening estimate for POST /api/buildable-area (new route; no existing /api
// shape changes). Information only: it never feeds the buildability score.
//
// Request: { geometry (parcel GeoJSON Polygon/MultiPolygon), state?, county?,
//            zoning?: { code?, setback? } }   setback: the zoning rules answer's setback text.
// Response:
//   { status: 'measured' | 'partial' | 'unavailable', parcelAcres, buildableAcres, buildablePct,
//     removedAcres, removedPct, overlapAcres,
//     removed: [{ key, reason, acres, pct, source }]   (only constraints that remove area)
//     mayAlsoRestrict: [{ key, reason, acres, pct, source, note }]  shown, not subtracted: mapped
//                wetland buffers; acres/pct are the part outside the removed area, so it sits
//                inside buildableAcres
//     bufferGeometry: GeoJSON MultiPolygon of that part (or null)
//     layers:  [{ key, label, status: 'counted' | 'shown' | 'none' | 'not_mapped' | 'unavailable',
//                acres?, note? }]   'shown': mapped and listed, not subtracted (buffers)     (every constraint, whether counted or not)
//     notes: [string], disclaimer, method,
//     geometry: GeoJSON MultiPolygon of the buildable part (or null),
//     removedGeometry: GeoJSON MultiPolygon of what was removed (or null),
//     slopeClasses: [{ key, label, pct, acres }] from the slope raster, or null (coarse grid) }
// 'partial': a constraint layer did not answer, so it was not subtracted (layers/notes say which).
// 'unavailable': no constraint could be checked (buildableAcres null) or the parcel outline was
// unusable (HTTP 400).
//
// What is removed (the union, so overlaps count once; per-reason acres are each constraint's own
// area inside the parcel, so they can add up to more than removedAcres, by overlapAcres):
//   flood    FEMA Special Flood Hazard Area polygons (A, AE, AH, AO, AR, A99, V, VE: SFHA_TF T or
//            an A/V zone code, see describeFloodRow in flood.js). The zone answer comes from
//            floodScreening() (edge-cached, so normally no new request); outlines are only
//            fetched when it measured an SFHA share > 0, from the same layer (FEMA NFHL or the
//            Esri backup), with flood-share.js's query; when the share was measured from the
//            Esri copy (FEMA outlines failed), or FEMA fails here, from the Esri copy. A
//            county-layer flood answer (Stevens) or an unmeasured share is reported as not
//            counted.
//   wetland  USFWS NWI polygons (wetlandsScreening() first, outlines only when it intersects),
//            plus the county wetland layer where one is configured (COUNTY_WETLAND_SOURCES).
//   (shown, not removed) county-mapped wetland buffers (Spokane County's 190 ft and 250 ft
//            layers): owner decision 2026-11-14, the buffer that applies depends on a wetland
//            delineation, so they are listed under mayAlsoRestrict and drawn separately. No
//            county elsewhere publishes one we use: the note says buffers are not mapped; none
//            is invented.
//   slope    the per-pixel slope raster (src/services/slope-raster.js: AWS Terrain Tiles, ~7-13 m
//            pixels, Horn 3 x 3 slope, shared cache with /api/land-analysis): pixels steeper than
//            STEEP_SLOPE_PCT, as rectangles. If the tiles fail, the 5 x 5 slope-grid cells
//            (src/services/slope-grid.js, called in-process so its cache is shared) steeper than
//            STEEP_SLOPE_PCT, as their cell rectangles, with a note that the grid is coarse.
//            Slopes of 15-30% are not subtracted; the slope layer's note gives their acres ("may
//            limit building"), and slopeClasses (additive) gives every class.
//            Threshold: 30% is the one documented rule (Spokane County / Spokane Valley critical
//            areas: geologically hazardous areas are slopes of 30% or greater). Montana county
//            subdivision rules found 2026-11-17 use 25% as a trigger for geotechnical review
//            (Yellowstone County) or a presumption of unsuitability (Missoula, Carbon), not a
//            removal; so 25-30% stays shown, not subtracted, in every county.
//   setback  the zoning setback, only when the rules table gives one plain number ("10 feet",
//            Stevens County tables). Front/side/rear text ("Front 10 ft; rear 15 ft; ...") is
//            not applied: which line is the front is not known.
// Area: src/shared/area-mask.js (strip union, 400 strips; geometry on 1.5 m strips, at most
// 1,500 rectangles).
import { json } from '../shared/http.js';
import { ringsFromGeometry, SQM_PER_ACRE } from '../shared/polygon-coverage.js';
import { arcgisQuery as polygonQuery, spatialParams } from '../shared/arcgis.js';
import { arcgisQuery } from '../shared/upstream.js';
import { maskAreas, maskGeometry, SETBACK_GROUP } from '../shared/area-mask.js';
import { floodScreening, describeFloodRow, FEMA_PROVIDER, ESRI_PROVIDER, FEMA_NFHL_FLOOD_LAYER, ESRI_USA_FLOOD_HAZARD_LAYER } from './flood.js';
import { floodShareParams, WHERE_NOT_X, FLOOD_SHARE_MAX_BYTES, FLOOD_REQUEST_HEADERS, BACKUP_OUT_FIELDS } from './flood-share.js';
import { wetlandsScreening, nwiOutlines } from './wetlands.js';
import { handleSlopeGrid } from './slope-grid.js';
import { slopeRaster, boundsRing, MAY_LIMIT_PCT } from './slope-raster.js';
import { SPOKANE_WETLAND_LAYERS } from '../counties/spokane-overlays.js';

export const STEEP_SLOPE_PCT = 30;
export const LAYER_TIMEOUT_MS = 26000;
export const FLOOD_OUTLINE_TIMEOUT_MS = 7000;
export const DISCLAIMER = 'Screening estimate, not a survey. Wetland buffers depend on a delineation; setbacks and easements not included.';
export const DISCLAIMER_WITH_SETBACK = 'Screening estimate, not a survey. Wetland buffers depend on a delineation; the general zoning setback is included, easements are not.';
export const METHOD = 'Parcel outline minus the union of mapped constraints (strip integration, no survey data)';

const FT_PER_M = 3.28084;
const NWI_SOURCE = 'USFWS National Wetlands Inventory';

// County wetland and buffer layers, keyed by lower-case county name. The layer URLs and field
// mappings stay in the county adapter (src/counties/spokane-overlays.js).
export const COUNTY_WETLAND_SOURCES = Object.freeze({
  spokane: {
    county: 'Spokane County', agency: 'Spokane County GIS',
    wetland: SPOKANE_WETLAND_LAYERS.filter(l => l.type === 'wetland'),
    buffer: SPOKANE_WETLAND_LAYERS.filter(l => l.type === 'wetland_buffer'),
    bufferLabel: 'Mapped wetland buffers (190/250 ft, Spokane County)',
    bufferSource: 'Spokane County Wetland Buffer 190ft and 250ft layers',
    bufferNote: 'Spokane County maps 190 ft and 250 ft wetland buffers; they are shown but not subtracted, because the buffer that applies depends on a wetland delineation.'
  }
});

const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const countyKey = county => String(county || '').replace(/\s+County$/i, '').trim().toLowerCase();

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

// A plain single setback number from a zoning rules table ("10 feet", "25 ft"), in feet; else null.
export function parseSetbackFeet(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)\.?\s*$/i.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

const rect = ([[s, w], [n, e]]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

// ---- Layers. Each returns { status, rings?: [rings...], source, note?, detail? } and never throws.

async function floodLayer(geometry, ctx, county) {
  const label = 'FEMA high-risk flood zone (SFHA)';
  const { status, body } = await floodScreening(geometry, ctx, { county });
  if (status !== 200 || !body?.available) return { status: 'unavailable', label, note: 'Flood map did not answer, so flood areas were not subtracted.' };
  const provider = body.source?.provider;
  if (body.category === 'not_mapped') return { status: 'not_mapped', label, source: provider, note: 'No FEMA flood map covers this parcel, so no flood area was subtracted.' };
  const zoneD = (body.zones || []).some(z => String(z).trim().toUpperCase() === 'D') ? ' FEMA zone D (flood risk undetermined) is mapped here; it is not a high-risk zone, so it was not subtracted.' : '';
  if (!body.high) return { status: 'none', label, source: provider, rings: [], ...(zoneD ? { note: zoneD.trim() } : {}) };
  if (provider !== FEMA_PROVIDER && provider !== ESRI_PROVIDER) {
    return { status: 'unavailable', label, source: provider, note: 'The flood zone came from a county flood map whose outlines are not measured here, so flood areas were not subtracted.' };
  }
  if (body.floodShare?.status !== 'measured') return { status: 'unavailable', label, source: provider, note: 'The flood zone share could not be measured, so flood areas were not subtracted.' };
  if (!(Number(body.sfhaAcres) > 0)) return { status: 'none', label, source: provider, rings: [], note: 'The high-risk flood zone only touches the parcel line.' };
  // Outlines from the layer the share was measured on (floodShare.source: Esri when FEMA's
  // outline queries failed), and from the Esri backup if FEMA fails here.
  const esri = { provider: ESRI_PROVIDER, url: ESRI_USA_FLOOD_HAZARD_LAYER, backup: true };
  const fema = { provider: FEMA_PROVIDER, url: FEMA_NFHL_FLOOD_LAYER, backup: false };
  const layersToTry = provider === ESRI_PROVIDER || body.floodShare?.source === ESRI_PROVIDER ? [esri] : [fema, esri];
  const errors = [];
  for (const layer of layersToTry) {
    try {
      const { backup } = layer;
      const features = await arcgisQuery(layer.url, floodShareParams(geometry, backup ? '1=1' : WHERE_NOT_X, backup ? BACKUP_OUT_FIELDS : 'FLD_ZONE,ZONE_SUBTY,SFHA_TF'), {
        agency: layer.provider, label: 'buildable-flood', timeoutMs: FLOOD_OUTLINE_TIMEOUT_MS, retries: 0, maxBytes: FLOOD_SHARE_MAX_BYTES, headers: FLOOD_REQUEST_HEADERS
      });
      const sfha = features.filter(f => describeFloodRow(f?.attributes || {}, { backup }).sfha);
      const zones = [...new Set(sfha.map(f => describeFloodRow(f.attributes || {}, { backup }).zone))];
      const rings = sfha.map(f => ringsFromGeometry(f.geometry)).filter(Boolean);
      if (!rings.length) throw new Error('no SFHA outline came back');
      return { status: 'counted', label: zones.length ? `FEMA high-risk flood zone ${zones.join(', ')}` : label, source: layer.provider === provider ? provider : `${layer.provider} (copy of ${provider})`, rings };
    } catch (error) {
      errors.push(`${layer.provider}: ${error?.message}`);
    }
  }
  console.warn('Buildable area: flood outlines failed', errors.join('; '));
  return { status: 'unavailable', label, source: provider, note: 'Flood zone outlines could not be fetched, so flood areas were not subtracted.' };
}

async function nwiLayer(geometry, ctx) {
  const { status, body } = await wetlandsScreening(geometry, ctx);
  if (status !== 200 || !body?.available) return { status: 'unavailable', source: NWI_SOURCE, note: 'National Wetlands Inventory did not answer, so NWI wetlands were not subtracted.' };
  if (!body.intersects) return { status: 'none', source: NWI_SOURCE, rings: [] };
  try {
    const rings = (await nwiOutlines(geometry)).map(f => ringsFromGeometry(f.geometry)).filter(Boolean);
    return { status: rings.length ? 'counted' : 'none', source: NWI_SOURCE, rings };
  } catch (error) {
    console.warn('Buildable area: NWI outlines failed', error?.message);
    return { status: 'unavailable', source: NWI_SOURCE, note: 'National Wetlands Inventory outlines could not be fetched, so NWI wetlands were not subtracted.' };
  }
}

async function countyLayers(layers, geometry, agency) {
  const rings = ringsFromGeometry(geometry);
  const answers = await Promise.all(layers.map(layer => polygonQuery(layer.url, { ...spatialParams({ rings }), outFields: layer.outFields }, { agency, label: `buildable-${layer.label}` })));
  return answers.flat().map(f => ringsFromGeometry(f?.geometry)).filter(Boolean);
}

async function countyWetlandLayer(source, geometry, kind) {
  const layers = source[kind];
  const sourceName = kind === 'buffer' ? source.bufferSource : layers.map(l => l.source).join('; ');
  try {
    const rings = await countyLayers(layers, geometry, source.agency);
    return { status: rings.length ? 'counted' : 'none', source: sourceName, rings };
  } catch (error) {
    console.warn(`Buildable area: ${source.county} ${kind} layers failed`, error?.message);
    return { status: 'unavailable', source: sourceName, note: kind === 'buffer' ? `${source.county} wetland buffer layers did not answer, so mapped buffers are not shown.` : `${source.county} wetland layers did not answer, so they were not subtracted.` };
  }
}

// The raster's slope classes; buildableFromLayers turns each share into acres of this answer's
// parcel acres, so they add up to parcelAcres.
function rasterClasses(raster) {
  return (raster.classes || []).map(c => ({ key: c.key, label: c.label, pct: c.pct, share: c.share }));
}

async function slopeLayer(geometry, env, ctx) {
  const label = `Slopes over ${STEEP_SLOPE_PCT}%`;
  const raster = await slopeRaster(geometry, { ctx });
  if (raster?.available) {
    const limiting = (raster.classes || []).filter(c => c.key === '15-25' || c.key === '25-30').reduce((a, c) => a + (c.share || 0), 0);
    return {
      status: raster.steepMask?.length ? 'counted' : 'none', label,
      source: `${raster.source} (${raster.pixelM} m pixels)`,
      rings: (raster.steepMask || []).map(boundsRing),
      slopeClasses: rasterClasses(raster),
      limitingShare: limiting,
      note: limiting >= 0.005
        ? `About ${Math.round(limiting * 1000) / 10}% of the parcel is ${MAY_LIMIT_PCT}–${STEEP_SLOPE_PCT}% slope: it may limit building (driveways, septic, foundations; some counties ask for an engineer's review over 25%), so it is shown, not subtracted.`
        : undefined
    };
  }
  try {
    const response = await handleSlopeGrid(new Request('https://acresx.internal/api/slope-grid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry }) }), env, ctx);
    const grid = await response.json();
    if (!grid?.available || !Array.isArray(grid.cells)) return { status: 'unavailable', label, note: 'Elevation samples were not available, so steep slopes were not subtracted.' };
    const steep = grid.cells.filter(c => Number(c.gradePct) > STEEP_SLOPE_PCT && Array.isArray(c.bounds));
    const resolution = grid.resolution || 'parcel grid';
    return {
      status: steep.length ? 'counted' : 'none', label, source: `${grid.source || 'USGS elevation'} (${resolution})`,
      rings: steep.map(c => rect(c.bounds)),
      note: `The detailed slope map was unavailable${raster?.error ? ` (${raster.error})` : ''}, so slope is read from a coarse ${resolution} of elevation samples; small steep areas such as banks or draws may not show.`
    };
  } catch (error) {
    console.warn('Buildable area: slope grid failed', error?.message);
    return { status: 'unavailable', label, note: 'Elevation samples were not available, so steep slopes were not subtracted.' };
  }
}

// ---- The estimate

const settle = (promise, fallback) => withTimeout(promise, LAYER_TIMEOUT_MS, fallback.what).catch(error => ({ status: 'unavailable', ...fallback, note: `${fallback.note} (${error?.message || 'failed'})` }));

// Pure part: layer answers -> response body (exported for tests).
export function buildableFromLayers(geometry, layers, { setbackFt = null, setbackNote = '', countyNotes = [] } = {}) {
  const parcel = ringsFromGeometry(geometry);
  const notes = [];
  const groups = {};
  const meta = {};
  let flag = null;
  for (const layer of layers) {
    if (layer.status === 'counted' && layer.rings?.length) {
      groups[layer.key] = layer.rings; meta[layer.key] = layer;
      if (layer.shownOnly) flag = layer.key;
    }
    if (layer.note) notes.push(layer.note);
  }
  const setbackM = setbackFt > 0 ? setbackFt / FT_PER_M : 0;
  if (setbackNote) notes.push(setbackNote);
  notes.push(...countyNotes);
  const areas = maskAreas(parcel, groups, { setbackM, flag });
  const total = areas.parcelSqM;
  const counted = layers.filter(l => !l.shownOnly && ['counted', 'none', 'not_mapped'].includes(l.status));
  const anyCheck = counted.length > 0 || setbackM > 0;
  const missing = layers.filter(l => !l.shownOnly && (l.status === 'unavailable' || l.partial));
  const toAcres = sqm => round2(sqm / SQM_PER_ACRE);
  const toPct = sqm => (total > 0 ? round1(Math.min(1, sqm / total) * 100) : 0);
  const parcelAcres = toAcres(total);
  const layerList = layers.map(l => ({ key: l.key, label: l.label, status: l.shownOnly && l.status === 'counted' ? 'shown' : l.status, ...(groups[l.key] ? { acres: toAcres(l.key === flag ? areas.flaggedSqM : areas.groups[l.key]) } : {}), ...(l.source ? { source: l.source } : {}), ...(l.note ? { note: l.note } : {}) }));
  if (setbackM > 0) layerList.push({ key: SETBACK_GROUP, label: `Zoning setback (${setbackFt} ft from the parcel line)`, status: 'counted', acres: toAcres(areas.groups[SETBACK_GROUP]), source: 'County zoning rules table' });
  if (!(total > 0) || !anyCheck) {
    return {
      status: 'unavailable', parcelAcres: total > 0 ? parcelAcres : null, buildableAcres: null, buildablePct: null, removedAcres: null, removedPct: null, overlapAcres: null,
      removed: [], mayAlsoRestrict: [], layers: layerList, notes: notes.length ? notes : ['No constraint layer could be checked.'], disclaimer: DISCLAIMER, method: METHOD, geometry: null, removedGeometry: null, bufferGeometry: null
    };
  }
  const removed = Object.keys(areas.groups).filter(k => k !== flag && areas.groups[k] > 0).map(k => k === SETBACK_GROUP
    ? { key: k, reason: `Zoning setback (${setbackFt} ft from the parcel line)`, acres: toAcres(areas.groups[k]), pct: toPct(areas.groups[k]), source: 'County zoning rules table' }
    : { key: k, reason: meta[k].label, acres: toAcres(areas.groups[k]), pct: toPct(areas.groups[k]), source: meta[k].source || '' })
    .filter(r => r.acres > 0 || r.pct > 0);
  const mayAlsoRestrict = flag && areas.flaggedSqM > 0 && toAcres(areas.flaggedSqM) > 0
    ? [{ key: flag, reason: meta[flag].label, acres: toAcres(areas.flaggedSqM), pct: toPct(areas.flaggedSqM), source: meta[flag].source || '', note: 'The buffer that applies depends on a wetland delineation.' }]
    : [];
  const ownSum = Object.entries(areas.groups).filter(([k]) => k !== flag).reduce((a, [, v]) => a + v, 0);
  const overlap = Math.max(0, ownSum - areas.removedSqM);
  const buildableSqM = Math.max(0, total - areas.removedSqM);
  const shape = maskGeometry(parcel, groups, { setbackM, flag });
  const slope = layers.find(l => l.key === 'slope');
  const slopeClasses = Array.isArray(slope?.slopeClasses)
    ? slope.slopeClasses.map(c => ({ key: c.key, label: c.label, pct: c.pct, acres: toAcres((c.share || 0) * total) }))
    : null;
  return {
    status: missing.length ? 'partial' : 'measured',
    parcelAcres, buildableAcres: toAcres(buildableSqM), buildablePct: toPct(buildableSqM),
    removedAcres: toAcres(areas.removedSqM), removedPct: toPct(areas.removedSqM), overlapAcres: toAcres(overlap),
    removed, mayAlsoRestrict, layers: layerList, notes,
    disclaimer: setbackM > 0 ? DISCLAIMER_WITH_SETBACK : DISCLAIMER, method: METHOD,
    geometry: shape.buildable.length ? { type: 'MultiPolygon', coordinates: shape.buildable } : null,
    removedGeometry: shape.removed.length ? { type: 'MultiPolygon', coordinates: shape.removed } : null,
    bufferGeometry: shape.flagged.length ? { type: 'MultiPolygon', coordinates: shape.flagged } : null,
    // Additive: slope classes of the parcel from the slope raster (null on the coarse grid).
    slopeClasses
  };
}

export async function buildableArea(body, env, ctx) {
  const geometry = body?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !ringsFromGeometry(geometry)) {
    return { status: 400, body: { status: 'unavailable', error: 'Parcel polygon geometry is required.', removed: [], notes: [], geometry: null } };
  }
  const county = typeof body.county === 'string' ? body.county : '';
  const source = COUNTY_WETLAND_SOURCES[countyKey(county)] || null;
  const countyName = county ? `${county.replace(/\s+County$/i, '').trim()} County` : 'this county';

  const jobs = [
    settle(floodLayer(geometry, ctx, county || undefined), { what: 'Flood', label: 'FEMA high-risk flood zone (SFHA)', note: 'Flood map did not answer, so flood areas were not subtracted.' }).then(l => ({ key: 'flood', ...l })),
    settle(nwiLayer(geometry, ctx), { what: 'Wetlands', source: NWI_SOURCE, note: 'National Wetlands Inventory did not answer, so NWI wetlands were not subtracted.' }).then(l => ({ key: 'wetland', label: 'Mapped wetlands', ...l })),
    source ? settle(countyWetlandLayer(source, geometry, 'wetland'), { what: `${source.county} wetlands`, note: `${source.county} wetland layer did not answer, so it was not subtracted.` }).then(l => ({ key: 'countyWetland', label: `County-mapped wetlands (${source.county})`, ...l })) : null,
    source ? settle(countyWetlandLayer(source, geometry, 'buffer'), { what: `${source.county} wetland buffers`, note: `${source.county} wetland buffer layers did not answer, so mapped buffers are not shown.` }).then(l => ({ key: 'buffer', label: source.bufferLabel, shownOnly: true, ...l })) : null,
    settle(slopeLayer(geometry, env, ctx), { what: 'Slope', label: `Slopes over ${STEEP_SLOPE_PCT}%`, note: 'Elevation samples were not available, so steep slopes were not subtracted.' }).then(l => ({ key: 'slope', ...l }))
  ].filter(Boolean);
  const layers = await Promise.all(jobs);

  // NWI and the county wetland layer are one constraint ("Mapped wetlands"), unioned.
  const nwi = layers.find(l => l.key === 'wetland');
  const cw = layers.find(l => l.key === 'countyWetland');
  if (cw) {
    const both = [nwi, cw].filter(l => l.status === 'counted');
    const down = [nwi, cw].filter(l => l.status === 'unavailable');
    nwi.rings = both.flatMap(l => l.rings);
    nwi.source = [nwi, cw].filter(l => l.status !== 'unavailable').map(l => l.source).filter(Boolean).join('; ');
    nwi.status = both.length ? 'counted' : down.length ? 'unavailable' : 'none';
    // Says which layers it is: the page's wetland finding is NWI only, so the numbers differ.
    const names = both.map(l => (l === nwi ? 'NWI' : source.county));
    nwi.label = names.length ? `Mapped wetlands (${names.join(' + ')})` : 'Mapped wetlands';
    if (both.length && down.length) nwi.partial = true;
    nwi.note = [nwi.note, cw.note].filter(Boolean).join(' ') || undefined;
    layers.splice(layers.indexOf(cw), 1);
  }

  if (!cw && nwi.status === 'counted') nwi.label = 'Mapped wetlands (NWI)';

  const countyNotes = [];
  if (!source) countyNotes.push(`Wetland buffers are not mapped for ${countyName}; only the mapped wetlands themselves were removed.`);
  else if (layers.find(l => l.key === 'buffer')?.status === 'counted') countyNotes.push(source.bufferNote);

  const setbackText = body?.zoning?.setback;
  const setbackFt = parseSetbackFeet(setbackText);
  let setbackNote = '';
  if (setbackFt > 0) setbackNote = `The zoning rules give a ${setbackFt} ft setback from property lines${body?.zoning?.code ? ` (${body.zoning.code})` : ''}; it is removed along every parcel line. Road and easement setbacks are not included.`;
  else if (setbackFt === 0) setbackNote = 'The zoning rules give no setback from property lines here; none was removed.';
  else if (setbackText) setbackNote = 'Zoning setbacks were not subtracted: the rules give different front, side and rear setbacks, and which line is the front is not mapped.';
  else setbackNote = 'Zoning setbacks were not subtracted: the zoning rules for this parcel give no single setback number.';

  return { status: 200, body: buildableFromLayers(geometry, layers, { setbackFt, setbackNote, countyNotes }) };
}

export async function handleBuildableArea(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { status, body: result } = await buildableArea(body, env, ctx);
  return json(result, status, status === 200 && result.status === 'measured' ? 'public, max-age=3600' : 'no-store');
}
