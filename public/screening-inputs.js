// Shared screening inputs, so every surface (overview, snapshot cards, score, cost model,
// printable report) reads the same number from the same rule (2026-11-14 consistency fixes).
// Injected first by maybeInjectUiPolish() in src/index.js; the other scripts call these helpers
// at render time.
//
// window.AcresXWellDepth: nearby well depth, one definition everywhere (dashboard card, overview,
//   score water factor, cost model, printable report).
//   Terrain-aware (2026-11-17; public/well-terrain.js attaches POST /api/well-depth-terrain's answer
//   to the wells array as wells.terrain; the rules are in src/services/well-depth-terrain.js):
//   wells within +/-50 ft of the homesite elevation are the comparable ones; wells more than 100 ft
//   lower are drainage wells and are reported separately. Confidence is moderate with at least 3
//   comparable wells (and the nearest wells not mostly in a drainage): depth = their median, range
//   = their 25th-75th percentile. Otherwise low: a range from the elevation-adjusted depths, with
//   the caution "Few wells at this elevation nearby ...". Never "Shallow" at low confidence.
//   Without the terrain answer (failed, timed out, not covered): the median reported depth
//   (CompletedDepth > 0) of the residential-comparable wells among the closest five
//   (nonresidential types left out; all five when none is clearly residential), labelled
//   "elevation not checked, low confidence", with a widened range.
//   stats(data).planningDepth: the high end of the range (the cost model's well line);
//   scoreDepth: the depth grade(s) and the score's water factor use (median at moderate
//   confidence, the high end at low). An on-parcel well record (existing-well.js) is a separate
//   fact, not this number.
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
  const SIMILAR_FT = 50;
  const DRAINAGE_FT = 100;
  const MIN_COMPARABLE = 3;
  const FEW_COMPARABLE = 'Few wells at this elevation nearby — depth could be much greater; ask a local driller.';
  const NOT_CHECKED = 'Elevation not checked: nearby wells may sit in a valley or drainage below this parcel; ask a local driller.';

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
  function quantile(values, q) {
    const s = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return null;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  const round10 = v => Math.round(v / 10) * 10;

  // The closest-five median (the fallback, and context next to the terrain estimate).
  function nearest(wellsList) {
    const wells = wellsList.slice(0, NEARBY);
    const comparable = wells.filter(w => !excludedWell(w)).map(depthOf).filter(v => v != null);
    const all = wells.map(depthOf).filter(v => v != null);
    const med = median(comparable);
    const fallbackMedian = median(all);
    return { med, fallbackMedian, depths: med != null ? comparable : all, excluded: wells.filter(excludedWell).length, total: wells.length };
  }

  // null when the wells have not loaded. Otherwise { depth, feet, count, lowFt, highFt,
  // confidence ('moderate' | 'low' | null), method ('terrain' | 'nearest' | 'none'), comparable,
  // planningDepth, scoreDepth, elevationChecked, parcelElevationFt, waterLevelDepthFt, drainage,
  // higher, deepWells, residential, median, fallbackMedian, excluded, total, terrainStatus }.
  // depth: the central number (null: no depth on record); count: the wells it rests on.
  function stats(data) {
    if (!data || !Array.isArray(data.wells)) return null;
    const n = nearest(data.wells);
    const t = data.wells.terrain;
    const nearestDepth = n.med ?? n.fallbackMedian;
    const common = { residential: n.med != null, median: n.med, fallbackMedian: n.fallbackMedian, nearestDepth, excluded: n.excluded, total: n.total, terrainStatus: t ? (t.available ? 'estimated' : t.status || 'unavailable') : 'not_checked' };
    const e = t?.available ? t.estimate : null;
    if (e && finite(e.depthFt) != null) {
      const confidence = e.confidence === 'moderate' ? 'moderate' : 'low';
      const lowFt = finite(e.lowFt) ?? e.depthFt, highFt = finite(e.highFt) ?? e.depthFt;
      return {
        ...common, method: 'terrain', confidence, elevationChecked: true,
        depth: e.depthFt, feet: Math.round(e.depthFt), lowFt, highFt,
        count: e.comparableCount || 0, comparable: e.comparableCount || 0, usedCount: e.usedCount || 0,
        planningDepth: finite(e.planningDepthFt) ?? highFt,
        scoreDepth: finite(e.scoreDepthFt) ?? (confidence === 'moderate' ? e.depthFt : highFt),
        parcelElevationFt: finite(e.parcelElevationFt ?? t.parcelElevationFt),
        waterLevelDepthFt: finite(e.waterLevelDepthFt), waterLevelWells: e.waterLevelWells || 0,
        drainage: e.drainage || null, higher: e.higher || null, deepWells: e.deepWells || null,
        searchRadiusMiles: finite(t.searchRadiusMiles)
      };
    }
    if (nearestDepth == null) {
      return { ...common, method: 'none', confidence: null, elevationChecked: false, depth: null, feet: null, count: 0, comparable: 0, lowFt: null, highFt: null, planningDepth: null, scoreDepth: null };
    }
    // Elevation not checked: today's median, low confidence, the range widened upward.
    const lowFt = Math.round(nearestDepth);
    const highFt = Math.max(lowFt, round10(Math.max(nearestDepth * 1.5, quantile(n.depths, 0.75) ?? 0)));
    return {
      ...common, method: 'nearest', confidence: 'low', elevationChecked: false,
      depth: nearestDepth, feet: Math.round(nearestDepth), count: n.depths.length, comparable: 0,
      lowFt, highFt, planningDepth: highFt, scoreDepth: highFt
    };
  }

  const plural = n => `${n} well${n === 1 ? '' : 's'}`;
  const ft = n => `${Math.round(n).toLocaleString('en-US')} ft`;
  const rangeText = s => (Math.round(s.lowFt) === Math.round(s.highFt) ? ft(s.lowFt) : `${Math.round(s.lowFt).toLocaleString('en-US')}–${ft(s.highFt)}`);
  const atElevation = s => (s.comparable ? `${plural(s.comparable)} at similar elevation` : 'no wells at similar elevation');

  // The card value: "100 ft" (moderate), "240–1,370 ft" (low), or 'Not available'.
  const value = s => (s?.feet == null ? 'Not available' : s.confidence === 'moderate' ? ft(s.depth) : rangeText(s));
  function label(s) {
    if (s?.feet == null) return 'No nearby well depths on record';
    if (s.method === 'terrain') return s.confidence === 'moderate' ? `Estimated well depth (${atElevation(s)})` : `Estimated well depth range · low confidence (${atElevation(s)})`;
    return `Median nearby well depth (${plural(s.count)}) · elevation not checked, low confidence`;
  }
  // The overview fact, under the label "Estimated well depth".
  function fact(s) {
    if (s?.feet == null) return 'Not available';
    if (s.method === 'terrain') return s.confidence === 'moderate' ? `${ft(s.depth)} (${rangeText(s)}; ${atElevation(s)})` : `${rangeText(s)} (low confidence)`;
    return `${rangeText(s)} (${plural(s.count)}; low confidence, elevation not checked)`;
  }
  // "Nearby wells are mostly in a drainage about 220 ft lower; upland wells may be much deeper."
  function drainageText(s) {
    const d = s?.drainage;
    if (!d || !d.count) return '';
    if (d.mostly) return `Nearby wells are mostly in a drainage about ${ft(d.medianDropFt)} lower; upland wells may be much deeper.`;
    return `${d.count} of the ${d.of} nearest wells ${d.count === 1 ? 'sits' : 'sit'} over ${DRAINAGE_FT} ft lower (drainage ${d.count === 1 ? 'well' : 'wells'}, not used as comparable).`;
  }
  // One deep well at similar or higher ground does not move the range (two are needed, owner
  // decision 2026-11-18); it is named instead.
  function deepText(s) {
    const one = s?.method === 'terrain' ? s.deepWells?.single : null;
    if (!one || !(one.depthFt > (s.highFt ?? 0))) return '';
    const where = one.dzFt > SIMILAR_FT ? 'on higher ground' : 'at similar elevation';
    return `One nearby well ${where} went to ${ft(one.depthFt)}; deeper wells are possible.`;
  }
  function caution(s) {
    if (!s || s.feet == null || s.confidence === 'moderate') return '';
    if (s.method === 'nearest') return NOT_CHECKED;
    return s.comparable < MIN_COMPARABLE ? FEW_COMPARABLE : 'Depth could be much greater; ask a local driller.';
  }
  // "Homesite about 3,535 ft; static water about 220 ft below it (9 wells)".
  function elevationText(s) {
    if (s?.method !== 'terrain' || s.parcelElevationFt == null) return '';
    const water = s.waterLevelDepthFt != null && s.waterLevelWells ? `; static water about ${ft(s.waterLevelDepthFt)} below it (${plural(s.waterLevelWells)})` : '';
    return `Homesite about ${ft(s.parcelElevationFt)} elevation${water}`;
  }
  // The card's short status line.
  function status(s) {
    if (!s || s.feet == null) return '';
    if (s.method === 'nearest') return 'Elevation not checked · low confidence';
    if (s.drainage?.mostly) return 'Nearby wells mostly in a drainage below the parcel';
    if (s.confidence !== 'moderate') return 'Few wells at this elevation nearby';
    return `${atElevation(s)}${s.excluded ? ` · ${s.excluded} nonresidential excluded` : ''}`;
  }
  // The card's foot line: the label, plus what was left out and any caution.
  function note(s) {
    if (!s) return 'Closest five recorded wells';
    if (s.feet == null) return 'No nearby depth records returned';
    if (s.method === 'nearest') {
      const extra = !s.residential ? ' · no clearly residential well type' : s.excluded ? ` · ${s.excluded} nonresidential excluded` : '';
      return `${label(s)}${extra}`;
    }
    return [label(s), drainageText(s), deepText(s), caution(s)].filter(Boolean).join(' · ');
  }
  // { key, label, cls, score }: the card grade, the report chip and the score's water factor.
  function grade(s) {
    if (!s || s.depth == null) return null;
    const d = s.scoreDepth ?? s.depth;
    if (s.confidence === 'moderate') {
      if (d <= 200) return { key: 'shallow', label: 'Shallow', cls: 'green', score: 92 };
      if (d <= 400) return { key: 'moderate', label: 'Moderate', cls: 'amber', score: 76 };
      return { key: 'deep', label: 'Deep', cls: 'red', score: 55 };
    }
    if (d <= 400) return { key: 'uncertain', label: 'Uncertain', cls: 'amber', score: 70 };
    return { key: 'possibly_deep', label: 'Possibly deep', cls: 'red', score: 55 };
  }
  // The cost lines' basis: "100 ft estimated well depth (range 80–140 ft; 5 wells at similar elevation)".
  function basis(s) {
    if (s?.feet == null) return '';
    if (s.method === 'terrain') return s.confidence === 'moderate'
      ? `${ft(s.depth)} estimated well depth (range ${rangeText(s)}; ${atElevation(s)})`
      : `${rangeText(s)} estimated well depth (low confidence; ${atElevation(s)})`;
    return `${ft(s.depth)} median nearby well depth (${plural(s.count)}; elevation not checked, low confidence)`;
  }
  // The report's well line: "Estimated well depth: 240–1,370 ft, low confidence (1 well at similar elevation)".
  function reportLine(s) {
    if (s?.feet == null) return 'No nearby well depths on record';
    if (s.method === 'terrain') return s.confidence === 'moderate'
      ? `Estimated well depth: ${ft(s.depth)} (range ${rangeText(s)}; ${atElevation(s)})`
      : `Estimated well depth: ${rangeText(s)}, low confidence (${atElevation(s)})`;
    return `Median nearby well depth (${plural(s.count)}): ${ft(s.depth)} — elevation not checked, low confidence`;
  }

  root.AcresXWellDepth = {
    NEARBY, SIMILAR_FT, DRAINAGE_FT, MIN_COMPARABLE, FEW_COMPARABLE, NOT_CHECKED,
    stats, value, label, fact, note, status, caution, drainageText, deepText, elevationText, grade, basis, reportLine, rangeText, excludedWell, median
  };

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

  function assess(land) {
    const soil = land?.soil;
    if (!soil?.available) return null;
    const t = land?.terrain;
    const measured = t?.available ? finite(t.gradePct) : null;
    const soilSlope = finite(soil.soilSlopePct);
    const slopePct = measured ?? soilSlope;
    const c = classify({ drainage: soil.drainage, hydrologicGroup: soil.hydrologicGroup, slopePct });
    // An answer without the inputs (older cached answers) keeps the service's grade.
    const feasibility = soil.drainage || soil.hydrologicGroup ? c.feasibility : (soil.soilMapFeasibility || soil.feasibility || 'moderate');
    const range = soilSlopeRange(soil);
    const mapSlope = range ? `soil map unit spans ${range[0]}–${range[1]}% slopes` : soilSlope != null ? `soil map unit's typical slope ${soilSlope}%` : '';
    let context;
    if (measured != null) context = [mapSlope, `measured parcel grade ${pct1(measured)}`].filter(Boolean).join('; ');
    else context = `measured parcel grade not available${soilSlope != null ? `; soil map slope ${soilSlope}% used` : ''}`;
    context = context.charAt(0).toUpperCase() + context.slice(1);
    const limits = c.limits.map(x => (x.startsWith('slope') && measured != null ? `measured grade ${pct1(measured)} (over ${LIMITED_OVER_PCT}%)` : x));
    return {
      feasibility,
      slopePct, slopeSource: measured != null ? 'measured' : soilSlope != null ? 'soil_map' : 'none',
      soilSlopeRange: range, limits, context,
      note: 'USDA screening only; a site evaluation sets the system type.'
    };
  }

  // Once per land answer (idempotent). Returns the same object.
  function apply(land) {
    const soil = land?.soil;
    if (!soil?.available || soil.septic) return land;
    const a = assess(land);
    if (!a) return land;
    soil.soilMapFeasibility = soil.feasibility;
    soil.feasibility = a.feasibility;
    soil.septic = { slopePct: a.slopePct, slopeSource: a.slopeSource, soilSlopeRange: a.soilSlopeRange, limits: a.limits, context: a.context, note: a.note };
    return land;
  }

  // The septic factor (0-100) before public sewer (public-utilities.js) is considered.
  function score(land) {
    const soil = land?.soil || {};
    if (!soil.available) return 50;
    const f = soil.septic ? soil.feasibility : assess(land)?.feasibility || soil.feasibility;
    return f === 'favorable' ? 92 : f === 'limited' ? 38 : 66;
  }

  // The soil answer came from the backup (USDA Soil Data Access was down): say so where it shows.
  const BACKUP_LABEL = 'Source: USDA SSURGO via Esri (backup — USDA service unavailable)';
  const sourceLabel = soil => (soil?.available && soil.backup ? BACKUP_LABEL : '');

  root.AcresXSeptic = { FAVORABLE_MAX_PCT, LIMITED_OVER_PCT, BACKUP_LABEL, sourceLabel, classify, soilSlopeRange, assess, apply, score };

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
