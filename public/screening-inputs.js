// Shared screening inputs, so every surface (overview, snapshot cards, score, cost model,
// printable report) reads the same number from the same rule (2026-11-14 consistency fixes).
// Injected first by maybeInjectUiPolish() in src/index.js; the other scripts call these helpers
// at render time.
//
// window.AcresXWellDepth: nearby well depth.
//   One definition everywhere: the median reported depth (CompletedDepth > 0) of the
//   residential-comparable wells among the closest five nearby records (findWells / the state
//   well searches return them closest first and keep five). Nonresidential types (irrigation,
//   monitoring, municipal, ...) are left out. When none of the five is clearly residential, the
//   median of all five depths is used and the note says so. Label: "Median nearby well depth
//   (N wells)". An on-parcel well record (existing-well.js) is a separate fact, not this number.
//
// window.AcresXSeptic: septic screening from USDA soil plus the measured parcel slope.
//   The soil service (src/services/soils.js classifyFeasibility) grades septic from the map
//   unit's drainage class, hydrologic group and the map unit's typical slope (slope_r). A map
//   unit can span a wide slope range ("15 to 35 percent slopes") that says little about this
//   parcel, so the slope part uses the measured parcel average grade (USGS terrain,
//   land.terrain.gradePct) when there is one; drainage and hydrologic group still come from
//   SSURGO. Same thresholds as the server: limited if poorly drained, hydrologic group D or
//   slope over 15%; favorable if well drained, not group D and slope 8% or less; else moderate.
//   apply(land) runs once when /api/land-analysis answers (findLandAnalysis is wrapped below):
//   soil.feasibility becomes this grade, the server's grade stays in soil.soilMapFeasibility, and
//   soil.septic carries the slope used, the limits found and the context line. Without terrain
//   the soil map slope is kept (as before). USDA screening only; a site evaluation sets the
//   system type.
//   BACKUP_LABEL / sourceLabel(soil): the source line shown on the septic card and its details
//   when the soil answer came from the Esri SSURGO backup (src/services/soils.js, soil.backup).
(function (root) {
  const finite = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // ---- Nearby well depth

  const NEARBY = 5;
  const NONRESIDENTIAL = /\b(irrigat|agricultur|industrial|monitor|observation|injection|dewater|geothermal|environmental|remediation|municipal)\w*/i;

  function wellText(well) {
    const p = well?.properties || {};
    return [p.WellProjectType, p.WellSubType, p.ProjectName, p.SiteType, p.WaterUse, p.WELL_USE, p.USE, p.Status, p.STATUS]
      .filter(Boolean).join(' ').toLowerCase();
  }
  const excludedWell = well => NONRESIDENTIAL.test(wellText(well));
  const depthOf = well => { const n = finite(well?.properties?.CompletedDepth); return n != null && n > 0 ? n : null; };
  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // { depth, feet, count, residential, median, fallbackMedian, excluded, total } or null when the
  // wells have not loaded. depth: the number every surface shows (null: no depth on record);
  // count: the wells it is the median of.
  function stats(data) {
    if (!data || !Array.isArray(data.wells)) return null;
    const wells = data.wells.slice(0, NEARBY);
    const comparable = wells.filter(w => !excludedWell(w)).map(depthOf).filter(v => v != null);
    const all = wells.map(depthOf).filter(v => v != null);
    const med = median(comparable);
    const fallbackMedian = median(all);
    const depth = med ?? fallbackMedian;
    return {
      depth, feet: depth == null ? null : Math.round(depth),
      count: med != null ? comparable.length : all.length,
      residential: med != null,
      median: med, fallbackMedian,
      excluded: wells.filter(excludedWell).length,
      total: wells.length
    };
  }
  const plural = n => `${n} well${n === 1 ? '' : 's'}`;
  // "100 ft", or 'Not available'.
  const value = s => (s?.feet == null ? 'Not available' : `${s.feet.toLocaleString('en-US')} ft`);
  // "Median nearby well depth (5 wells)".
  const label = s => (s?.feet == null ? 'No nearby well depths on record' : `Median nearby well depth (${plural(s.count)})`);
  // "100 ft (5 wells)": the overview fact, under the label "Median nearby well depth".
  const fact = s => (s?.feet == null ? 'Not available' : `${value(s)} (${plural(s.count)})`);
  // The card's foot line: the label, plus what was left out.
  function note(s) {
    if (!s) return 'Closest five recorded wells';
    if (s.feet == null) return 'No nearby depth records returned';
    const extra = !s.residential ? ' · no clearly residential well type' : s.excluded ? ` · ${s.excluded} nonresidential excluded` : '';
    return `${label(s)}${extra}`;
  }

  root.AcresXWellDepth = { NEARBY, stats, value, label, fact, note, excludedWell, median };

  // ---- Septic

  const FAVORABLE_MAX_PCT = 8;
  const LIMITED_OVER_PCT = 15;
  const pct1 = n => `${Number(n).toFixed(1)}%`;

  function classify({ drainage, hydrologicGroup, slopePct }) {
    const d = String(drainage || '').toLowerCase();
    const hyd = String(hydrologicGroup || '').toUpperCase();
    const slope = finite(slopePct);
    const limits = [];
    if (/very poorly|poorly/.test(d)) limits.push(`${String(drainage).toLowerCase()} soil`);
    if (hyd.includes('D')) limits.push(`hydrologic group ${hyd} (slow infiltration)`);
    if (slope != null && slope > LIMITED_OVER_PCT) limits.push(`slope over ${LIMITED_OVER_PCT}%`);
    if (limits.length) return { feasibility: 'limited', limits };
    if (/well drained|somewhat excessively|excessively/.test(d) && (slope == null || slope <= FAVORABLE_MAX_PCT)) return { feasibility: 'favorable', limits };
    return { feasibility: 'moderate', limits };
  }

  // "15 to 35 percent slopes" in the map unit name -> [15, 35].
  function soilSlopeRange(soil) {
    const m = /(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)\s*percent\s+slopes?/i.exec(String(soil?.mapUnit || ''));
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  // Septic slope input (owner decision 2026-11-18, PR #93): the slope of the best homesite area,
  // not the parcel average. In order: the buildable-area homesite (gentlest ~1 ac outside flood
  // zones, wetlands and slopes over 30%: last.buildableArea.homesite), the slope raster's gentlest
  // ~1 ac (land.terrain.homesiteSlopePct, before the buildable answer arrives), then the parcel
  // average grade (no raster), then the soil map unit's slope.
  function homesiteInput(land, buildable) {
    const b = buildable === undefined ? (() => { try { return typeof last !== 'undefined' ? last?.buildableArea : root.last?.buildableArea; } catch { return root.last?.buildableArea; } })() : buildable;
    const fromBuildable = finite(b?.homesite?.slopePct);
    if (fromBuildable != null) return { slopePct: fromBuildable, homesite: b.homesite };
    const t = land?.terrain;
    const fromTerrain = t?.available ? finite(t.homesiteSlopePct) : null;
    if (fromTerrain != null) return { slopePct: fromTerrain, homesite: t.homesite || null };
    return null;
  }

  function assess(land, buildable) {
    const soil = land?.soil;
    if (!soil?.available) return null;
    const t = land?.terrain;
    const average = t?.available ? finite(t.gradePct) : null;
    const site = homesiteInput(land, buildable);
    const measured = site ? site.slopePct : average;
    const soilSlope = finite(soil.soilSlopePct);
    const slopePct = measured ?? soilSlope;
    const c = classify({ drainage: soil.drainage, hydrologicGroup: soil.hydrologicGroup, slopePct });
    // An answer without the inputs (older cached answers) keeps the service's grade.
    const feasibility = soil.drainage || soil.hydrologicGroup ? c.feasibility : (soil.soilMapFeasibility || soil.feasibility || 'moderate');
    const range = soilSlopeRange(soil);
    const mapSlope = range ? `soil map unit spans ${range[0]}–${range[1]}% slopes` : soilSlope != null ? `soil map unit's typical slope ${soilSlope}%` : '';
    let context;
    if (site) context = [`drainfield-area slope ${pct1(site.slopePct)} (gentlest ~1 ac)`, average != null ? `parcel average ${pct1(average)}` : '', mapSlope].filter(Boolean).join('; ');
    else if (measured != null) context = [mapSlope, `measured parcel grade ${pct1(measured)}`].filter(Boolean).join('; ');
    else context = `measured parcel grade not available${soilSlope != null ? `; soil map slope ${soilSlope}% used` : ''}`;
    context = context.charAt(0).toUpperCase() + context.slice(1);
    const limits = c.limits.map(x => (x.startsWith('slope') && measured != null ? `${site ? 'drainfield-area slope' : 'measured grade'} ${pct1(measured)} (over ${LIMITED_OVER_PCT}%)` : x));
    return {
      feasibility,
      slopePct, slopeSource: site ? 'homesite' : measured != null ? 'measured' : soilSlope != null ? 'soil_map' : 'none',
      parcelGradePct: average, homesite: site?.homesite || null,
      soilSlopeRange: range, limits, context,
      note: 'USDA screening only; a site evaluation sets the system type.'
    };
  }

  // Grades the land answer (idempotent for the same slope input). Re-grades when the input
  // changes, i.e. when the buildable-area homesite arrives after the land answer. Returns land.
  const inputKey = land => { const s = homesiteInput(land); return s ? `h:${s.slopePct}` : 'avg'; };
  function apply(land) {
    const soil = land?.soil;
    if (!soil?.available) return land;
    const key = inputKey(land);
    if (soil.septic && soil.septic.inputKey === key) return land;
    if (soil.septic) soil.feasibility = soil.soilMapFeasibility;
    const a = assess(land);
    if (!a) return land;
    soil.soilMapFeasibility = soil.feasibility;
    soil.feasibility = a.feasibility;
    soil.septic = { slopePct: a.slopePct, slopeSource: a.slopeSource, parcelGradePct: a.parcelGradePct, homesite: a.homesite, soilSlopeRange: a.soilSlopeRange, limits: a.limits, context: a.context, note: a.note, inputKey: key };
    return land;
  }

  // The septic factor (0-100) before public sewer (public-utilities.js) is considered.
  function score(land) {
    const soil = land?.soil || {};
    if (!soil.available) return 50;
    if (soil.septic) apply(land);
    const f = soil.septic ? soil.feasibility : assess(land)?.feasibility || soil.feasibility;
    return f === 'favorable' ? 92 : f === 'limited' ? 38 : 66;
  }

  // The soil answer came from the backup (USDA Soil Data Access was down): say so where it shows.
  const BACKUP_LABEL = 'Source: USDA SSURGO via Esri (backup — USDA service unavailable)';
  const sourceLabel = soil => (soil?.available && soil.backup ? BACKUP_LABEL : '');

  root.AcresXSeptic = { FAVORABLE_MAX_PCT, LIMITED_OVER_PCT, BACKUP_LABEL, sourceLabel, classify, soilSlopeRange, homesiteInput, assess, apply, score };

  // ---- Terrain factor (owner decision 2026-11-18, PR #93): a gradual scale instead of steps.
  // Piecewise-linear through the old step values, so a parcel at 15.1% no longer scores 27 points
  // below one at 14.9%: 0-5% -> 96, then 96 -> 82 by 10%, 82 -> 62 by 15%, 62 -> 35 by 25%, and
  // 35 beyond. gradePct is the parcel's mean grade (the slope raster's mean when measured,
  // src/services/slope-raster.js). The one definition for score-cost.js and
  // screening-refinements.js (and so the dashboard and the report).
  const TERRAIN_ANCHORS = Object.freeze([[0, 96], [5, 96], [10, 82], [15, 62], [25, 35]]);
  function terrainScore(gradePct) {
    const g = gradePct === null || gradePct === undefined || gradePct === '' ? NaN : Number(gradePct);
    if (!Number.isFinite(g)) return 50;
    const A = TERRAIN_ANCHORS;
    if (g <= A[0][0]) return A[0][1];
    for (let i = 1; i < A.length; i++) {
      const [x0, y0] = A[i - 1], [x1, y1] = A[i];
      if (g <= x1) return Math.round((y0 + (y1 - y0) * (g - x0) / (x1 - x0)) * 10) / 10;
    }
    return A[A.length - 1][1];
  }
  root.AcresXTerrain = { ANCHORS: TERRAIN_ANCHORS, score: terrainScore };

  // The land answer is graded once, as it arrives, so the card, the detail tab, the score, the
  // cost model and the report all read the same septic grade (progressive-loading.js looks the
  // function up on window at call time).
  if (typeof root.findLandAnalysis === 'function' && !root.findLandAnalysis.__septic) {
    const base = root.findLandAnalysis;
    const wrapped = async function (...args) {
      const result = await base.apply(this, args);
      try { apply(result); } catch (error) { console.warn('AcresX septic screening failed', error); }
      return result;
    };
    wrapped.__septic = true;
    root.findLandAnalysis = wrapped;
  }
})(typeof window !== 'undefined' ? window : globalThis);
