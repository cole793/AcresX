// The assembled page object (`last`) -> the index row: the score (public/score-core.js, loaded
// with node:vm), the typed columns of `parcels`, one `parcel_layers` status per layer, and the
// trimmed score inputs for `parcel_inputs` (docs/explore-index.md sections 3 and 6).
import { loadScoreCore } from './browser-scripts.mjs';

const finite = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const bool = v => (v === true ? 1 : v === false ? 0 : null);
const text = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

// ---- R5 (docs/explore-index.md section 8), REPLICATED until src/zoning/use-flags.js exists.
// Single-family: the report's matcher (public/property-report-v2.js:348). Manufactured home: the
// rules tables' "Manufactured home" use (src/zoning/*-rules.js), not the park.
export const SINGLE_FAMILY_USE = /single[- ]family|dwelling, single|^residence$/i;
export const MANUFACTURED_HOME_USE = /^manufactured(?:\/mobile)? homes?\b(?!.*\bpark)|^mobile homes?\b(?!.*\bpark)/i;
const USE_STATUSES = ['permitted', 'limited', 'conditional', 'not_permitted'];
// { allowed: 1 | 0 | null, status } from the zoning rules answer. 1 only when permitted outright.
export function useFlag(zdp, pattern) {
  const uses = zdp?.available && Array.isArray(zdp.uses) ? zdp.uses : null;
  const use = uses?.find(u => pattern.test(String(u?.label || '')));
  const status = use && USE_STATUSES.includes(use.status) ? use.status : 'not_mapped';
  return { allowed: status === 'permitted' ? 1 : status === 'not_permitted' ? 0 : null, status };
}

// ---- Layer statuses ('ok' | 'none' | 'unavailable' | 'timeout' | 'not_configured' | 'not_checked')

const timedOut = (x, sectionState) => sectionState === 'timeout' || Boolean(x?.timedOut) || /timed out/i.test(String(x?.error || ''));
const failure = (x, sectionState) => (timedOut(x, sectionState) ? 'timeout' : 'unavailable');
// /api/well-depth-terrain answers that mean an upstream failed (src/services/well-depth-terrain.js),
// plus the page's own 'timeout' / 'failed' (public/well-terrain.js).
export const TERRAIN_FAILED = Object.freeze(['timeout', 'failed', 'wells_unavailable', 'elevation_unavailable']);
const shortError = x => text(String(x?.error || x?.note || '').replace(/https?:\/\/\S+/g, '<url>'), 160);

export function layerStatuses(last, { sections = {}, followups = {}, parcelLayer, cityLayer, assessmentLayer } = {}) {
  const C = loadScoreCore();
  const out = {};
  const set = (layer, status, extra = {}) => { out[layer] = { status, source: null, sourceVersion: null, backup: null, error: null, ...extra }; };

  if (parcelLayer) set('parcel', parcelLayer.status, parcelLayer);
  if (cityLayer) set('city_limits', cityLayer.status, cityLayer);
  if (assessmentLayer) set('assessment', assessmentLayer.status, assessmentLayer);

  const zp = last.zoningPermits;
  const zs = zp?.zoning?.status;
  if (zs === 'gis_match' || zs === 'city_jurisdiction') set('zoning', 'ok', { source: text(zp?.source?.name || zp?.zoning?.sourceUrl) });
  else if (zs === 'no_match') set('zoning', 'none');
  else if (zs === 'not_configured') set('zoning', 'not_configured');
  else if (zp && !['unavailable', 'error'].includes(zs) && zs) set('zoning', 'ok', { error: text(zs) });
  else set('zoning', failure(zp, sections.zoningPermits), { error: shortError(zp) || shortError(zp?.zoning) });

  const zdp = last.zoningDevelopmentPotential;
  if (followups.zoningDevelopmentPotential === 'not_sent' || !zdp) set('zoning_rules', 'not_configured', { error: zs === 'gis_match' ? 'rules not mapped for this jurisdiction' : null });
  else if (zdp.available) set('zoning_rules', 'ok', { source: text(zdp.sourceChapter || zdp.source) });
  else if (zdp.error) set('zoning_rules', failure(zdp, followups.zoningDevelopmentPotential), { error: shortError(zdp) });
  else set('zoning_rules', 'none', { error: text(zdp.status) });

  const flood = last.flood;
  if (flood?.available) set('flood', 'ok', { source: text(flood.source?.provider), backup: bool(C.flood.isBackup(flood)) });
  else set('flood', failure(flood, sections.flood), { error: shortError(flood) });

  const w = last.wetlands;
  if (w?.available) set('wetlands', w.intersects ? 'ok' : 'none', { source: 'USFWS NWI' });
  else set('wetlands', failure(w, sections.wetlands), { error: shortError(w) });

  const land = last.land;
  if (land?.soil?.available) set('land', 'ok', { source: text(land.soil.source), backup: bool(Boolean(land.soil.backup)) });
  else set('land', failure(land?.soil?.error ? land.soil : land, sections.land), { error: shortError(land?.soil) || shortError(land) });
  if (land?.terrain?.available) set('slope', 'ok', { source: text(land.terrain.gradeMethod === 'raster' ? 'slope raster' : land.terrain.source), sourceVersion: text(land.terrain.gradeMethod) });
  else set('slope', failure(land?.terrain?.error ? land.terrain : land, sections.land), { error: shortError(land?.terrain) || shortError(land) });

  const b = last.buildableArea;
  if (!b) set('buildable', 'not_checked');
  else if (b.status === 'measured' || b.status === 'partial') set('buildable', 'ok', { error: b.status === 'partial' ? 'partial' : null });
  else set('buildable', failure({ error: (b.notes || [])[0] }, followups.buildableArea), { error: text((b.notes || [])[0], 160) });

  const wells = last.wells;
  if (wells?.lookupFailed) set('wells', failure(wells, sections.wells), { error: shortError(wells) });
  else if (Array.isArray(wells) && !wells.length) set('wells', 'none');
  else set('wells', 'ok', { source: 'WA Ecology well reports' });
  const t = wells?.terrain;
  if (wells?.lookupFailed || !t) set('well_terrain', 'not_checked');
  else if (t.available) set('well_terrain', 'ok', { sourceVersion: null });
  else if (TERRAIN_FAILED.includes(t.status)) set('well_terrain', t.status === 'timeout' || /timed out/i.test(String(t.error || '')) ? 'timeout' : 'unavailable', { error: shortError(t) || text(t.status) });
  else if (t.status === 'not_supported') set('well_terrain', 'not_configured');
  else set('well_terrain', 'none', { error: text(t.status) });

  const pu = last.publicUtilities;
  if (pu?.available) set('public_utilities', 'ok');
  else set('public_utilities', failure(pu, sections.publicUtilities), { error: shortError(pu) });

  const u = last.utility;
  if (u?.lookupFailed) set('utility', failure(u, sections.utility), { error: shortError(u) });
  else if (sections.utility === 'timeout') set('utility', 'timeout');
  else if (Array.isArray(u) && !u.length) set('utility', 'none');
  else set('utility', 'ok', { source: 'HIFLD retail service territories' });

  const pi = last.powerIntelligence;
  if (followups.powerIntelligence === 'not_sent' || !pi) set('power', 'not_checked', { error: 'no utility provider to ask about' });
  else if (pi.available) set('power', 'ok', { source: text(pi.adapter) });
  else set('power', failure(pi, followups.powerIntelligence), { error: shortError(pi) });

  const ra = last.costContext?.roadAccess;
  if (!ra) set('road', 'not_checked');
  else if (ra.available) set('road', ra.status === 'found' ? 'ok' : 'none', { source: text(ra.source?.name) });
  else if (ra.status === 'not_configured') set('road', 'not_configured');
  else set('road', failure(ra, followups.costContext), { error: shortError(ra) });

  // Not in the first runs (docs/explore-index.md section 3): treasurer pages, and MLS (Q7).
  set('tax', 'not_checked');
  set('listing', 'not_checked');
  return out;
}

// ---- The score and the typed columns

// The page's AcresXSections.status for the score: 'done' | 'failed' | 'timeout' per section.
export const sectionStatusOf = sections => name => sections?.[name];

export function scoreOf(last, sections) {
  const C = loadScoreCore();
  return C.calculate(last, { sectionStatus: sectionStatusOf(sections) });
}

export function scoreColumns(result) {
  const C = loadScoreCore();
  const factors = Object.fromEntries(Object.entries(result.factors).map(([k, f]) => [k, { score: f.score, measured: f.measured }]));
  return {
    score: result.score == null ? null : result.score,
    score_band: result.band || null,
    score_rating: result.rating,
    score_factors_measured: result.completeness.measured,
    score_provisional: result.completeness.provisional ? 1 : 0,
    score_why: text(result.why, 300),
    score_factors_json: JSON.stringify(factors),
    score_version: String(C.SCORE_RULES_VERSION)
  };
}

export function layerColumns(last) {
  const C = loadScoreCore();
  const zp = last.zoningPermits || {};
  const z = zp.zoning || {};
  const zdp = last.zoningDevelopmentPotential;
  const home = useFlag(zdp, SINGLE_FAMILY_USE), mh = useFlag(zdp, MANUFACTURED_HOME_USE);
  const zoned = ['gis_match', 'city_jurisdiction', 'no_match'].includes(z.status) || (z.status && !['unavailable', 'error'].includes(z.status));

  const flood = last.flood;
  const floodOk = flood?.available === true;
  const zonesByShare = floodOk ? (Array.isArray(flood.floodZones) && flood.floodZones.length
    ? [...flood.floodZones].sort((a, b) => (finite(b.sharePct) ?? 0) - (finite(a.sharePct) ?? 0)).map(r => r.zone)
    : (flood.zones || [])) : [];

  const w = last.wetlands;
  const land = last.land || {};
  const soil = land.soil?.available ? land.soil : null;
  const terrain = land.terrain?.available ? land.terrain : null;
  const b = last.buildableArea;
  const bOk = b && (b.status === 'measured' || b.status === 'partial');
  const septic = soil ? C.septic.evaluate(land, last.buildableArea) : null;

  const wells = C.wellDepth.stats(last);
  const wellsOk = Array.isArray(last.wells) && !last.wells.lookupFailed;

  const pu = last.publicUtilities?.available ? last.publicUtilities : null;
  const u = Array.isArray(last.utility) && !last.utility.lookupFailed ? last.utility : null;
  const pi = last.powerIntelligence?.available ? last.powerIntelligence : null;
  const line = pi?.nearestLine;
  const ra = last.costContext?.roadAccess?.available ? last.costContext.roadAccess : null;

  return {
    zoning_code: text(z.code, 60),
    zoning_name: text(z.name, 120),
    zoning_jurisdiction: text(zp.jurisdiction || zp.permitJurisdiction?.name, 120),
    zoning_status: text(z.status, 40),
    home_allowed: zoned ? home.allowed : null,
    home_allowed_status: zoned ? home.status : null,
    manufactured_home_allowed: zoned ? mh.allowed : null,
    manufactured_home_status: zoned ? mh.status : null,

    flood_share_pct: floodOk && C.flood.shareMeasured(flood) ? finite(flood.sfhaSharePct) : null,
    flood_high: floodOk ? (C.flood.category(flood) === 'high' ? 1 : 0) : null,
    flood_zones: floodOk ? text([...new Set(zonesByShare.filter(Boolean))].join(','), 120) : null,
    wetlands_pct: w?.available ? (finite(w.coveragePct) ?? (w.intersects ? null : 0)) : null,
    wetlands_category: w?.available ? C.wetlands.category(w) : null,

    slope_mean_pct: terrain ? finite(terrain.gradePct) : null,
    slope_median_pct: null, // R7: slope-raster.js has no p50Pct yet
    slope_p90_pct: terrain ? finite(terrain.p90GradePct) : null,
    slope_max_pct: terrain ? finite(terrain.maxGradePct) : null,
    buildable_acres: bOk ? finite(b.buildableAcres) : null,
    buildable_status: b ? text(b.status, 20) : null,
    homesite_slope_pct: finite(b?.homesite?.slopePct) ?? (terrain ? finite(terrain.homesiteSlopePct) : null),

    septic_grade: septic && ['favorable', 'moderate', 'limited'].includes(septic.feasibility) ? septic.feasibility : null,
    soil_drainage: soil ? text(soil.drainage, 60) : null,
    soil_hydro_group: soil ? text(soil.hydrologicGroup, 10) : null,
    well_depth_ft: wellsOk ? finite(wells?.depth) : null,
    well_depth_low_ft: wellsOk ? finite(wells?.lowFt) : null,
    well_depth_high_ft: wellsOk ? finite(wells?.highFt) : null,
    well_confidence: wellsOk ? text(wells?.confidence, 20) : null,
    well_count: wellsOk ? (wells?.count ?? 0) : null,
    public_water: pu ? text(pu.water?.status, 20) : null,
    public_sewer: pu ? text(pu.sewer?.status, 20) : null,
    power_provider: u ? text(u[0], 120) : null,
    power_territory_confirmed: pi ? bool(Boolean(pi.territory?.confirmed)) : null,
    power_line_distance_ft: finite(line?.distanceFt),
    power_line_source: line ? text([line.lineType, line.sourceLabel || line.source].filter(Boolean).join(' · '), 120) : null,
    road_distance_ft: ra ? finite(ra.distanceFt) : null,
    road_public: ra && ra.road ? bool(Boolean(ra.road.public)) : null
  };
}

// ---- Trimmed score inputs (parcel_inputs.inputs_json): only what score-core.js reads, so a
// score-rules change can be re-run without the network. No owner, address or project name: a
// well's ProjectName is kept only as the non-residential word the score matches on.
const pick = (o, keys) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])) : o ?? null);
const WELL_TEXT = ['WellProjectType', 'WellSubType', 'SiteType', 'WaterUse', 'WELL_USE', 'USE', 'Status', 'STATUS'];

export function trimInputs(last, sections) {
  const C = loadScoreCore();
  const wells = Array.isArray(last.wells) ? last.wells.slice(0, C.wellDepth.NEARBY).map(wl => {
    const p = wl?.properties || {};
    const out = { CompletedDepth: p.CompletedDepth ?? null, ...pick(p, WELL_TEXT) };
    const word = String(p.ProjectName || '').match(C.wellDepth.NONRESIDENTIAL)?.[0];
    if (word) out.ProjectName = word;
    return { properties: out };
  }) : [];
  const t = last.wells?.terrain;
  const estimate = t?.estimate ? pick(t.estimate, ['confidence', 'depthFt', 'lowFt', 'highFt', 'comparableCount', 'usedCount', 'planningDepthFt', 'scoreDepthFt', 'parcelElevationFt', 'waterLevelDepthFt', 'waterLevelWells', 'comparableMedianFt', 'comparableP25Ft', 'comparableP75Ft', 'drainage', 'higher', 'deepWells']) : undefined;
  const land = last.land ? {
    available: last.land.available, error: last.land.error, timedOut: last.land.timedOut,
    soil: pick(last.land.soil, ['available', 'error', 'timedOut', 'drainage', 'hydrologicGroup', 'soilSlopePct', 'feasibility', 'soilMapFeasibility', 'backup']),
    terrain: pick(last.land.terrain, ['available', 'error', 'timedOut', 'gradePct', 'p90GradePct', 'maxGradePct', 'homesiteSlopePct', 'gradeMethod'])
  } : null;
  const flood = last.flood ? pick(last.flood, ['available', 'error', 'timedOut', 'intersects', 'high', 'zones', 'zoneDetails', 'category', 'floodZones', 'sfhaSharePct', 'floodShare']) : null;
  if (flood?.floodZones) flood.floodZones = flood.floodZones.map(r => pick(r, ['zone', 'subtype', 'sfha', 'category', 'sharePct', 'acres']));
  if (last.flood?.source) flood.source = pick(last.flood.source, ['provider', 'emptyResult']);
  const b = last.buildableArea;
  return {
    sections: { ...sections },
    wells: { list: wells, lookupFailed: Boolean(last.wells?.lookupFailed), timedOut: Boolean(last.wells?.timedOut), ...(t ? { terrain: { available: t.available, status: t.status, ...(estimate ? { estimate } : {}), parcelElevationFt: t.parcelElevationFt ?? null, searchRadiusMiles: t.searchRadiusMiles ?? null } } : {}) },
    utility: { list: Array.isArray(last.utility) ? [...last.utility] : [], lookupFailed: Boolean(last.utility?.lookupFailed) },
    land, flood,
    wetlands: last.wetlands ? pick(last.wetlands, ['available', 'error', 'timedOut', 'intersects', 'category', 'coveragePct', 'overlapAcres', 'wetlandAcres']) : null,
    zoningPermits: last.zoningPermits ? { available: last.zoningPermits.available, error: last.zoningPermits.error, timedOut: last.zoningPermits.timedOut, zoning: pick(last.zoningPermits.zoning, ['status', 'code']) } : null,
    powerIntelligence: last.powerIntelligence ? { available: last.powerIntelligence.available, territory: pick(last.powerIntelligence.territory, ['confirmed']) } : undefined,
    publicUtilities: last.publicUtilities ? { available: last.publicUtilities.available, water: pick(last.publicUtilities.water, ['status']), sewer: pick(last.publicUtilities.sewer, ['status']) } : null,
    buildableArea: b ? { status: b.status, buildableAcres: b.buildableAcres, parcelAcres: b.parcelAcres, homesiteStatus: b.homesiteStatus, homesite: b.homesite ? pick(b.homesite, ['slopePct']) : b.homesite, removed: (b.removed || []).map(r => pick(r, ['key', 'reason', 'acres'])) } : undefined
  };
}

// Back to a `last` the score core reads (arrays with their lookupFailed/terrain marks) + sections.
export function rehydrateInputs(inputs) {
  const wells = (inputs.wells?.list || []).map(w => ({ properties: { ...w.properties } }));
  if (inputs.wells?.lookupFailed) wells.lookupFailed = true;
  if (inputs.wells?.timedOut) wells.timedOut = true;
  if (inputs.wells?.terrain) wells.terrain = inputs.wells.terrain;
  const utility = [...(inputs.utility?.list || [])];
  if (inputs.utility?.lookupFailed) utility.lookupFailed = true;
  const last = { wells, utility, land: inputs.land, flood: inputs.flood, wetlands: inputs.wetlands, zoningPermits: inputs.zoningPermits, publicUtilities: inputs.publicUtilities };
  if (inputs.powerIntelligence) last.powerIntelligence = inputs.powerIntelligence;
  if (inputs.buildableArea) last.buildableArea = inputs.buildableArea;
  return { last, sections: inputs.sections || {} };
}

// The comma list of layer keys that did not answer (parcels.layers_missing).
export function layersMissing(statuses) {
  const missing = Object.entries(statuses).filter(([, s]) => s.status === 'unavailable' || s.status === 'timeout').map(([k]) => k);
  return missing.length ? missing.join(',') : null;
}
