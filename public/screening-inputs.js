// Shared screening inputs, so every surface (overview, snapshot cards, score, cost model,
// printable report) reads the same number from the same rule (2026-11-14 consistency fixes).
// Injected after score-core.js by maybeInjectUiPolish() in src/index.js; the other scripts call these helpers
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
//   stats(data).planningDepth: the high end of the range (the cost model's "could reach" deep-well
//   note; the cost line itself prices the most likely depth, local-cost-model.js wellPlan);
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
  // The rules (well depth stats and grade, septic classify, terrain score) are in score-core.js
  // (window.AcresXScoreCore, injected before this file); this file keeps the text and the page
  // wiring, and its window names as thin wrappers.
  const C = root.AcresXScoreCore;
  if (!C) throw new Error('AcresX: public/score-core.js must load before screening-inputs.js');
  const WD = C.wellDepth;

  // ---- Nearby well depth

  const { NEARBY, SIMILAR_FT, DRAINAGE_FT, MIN_COMPARABLE, excludedWell, median } = WD;
  const FEW_COMPARABLE = 'Few wells at this elevation nearby — depth could be much greater; ask a local driller.';
  const NOT_CHECKED = 'Elevation not checked: nearby wells may sit in a valley or drainage below this parcel; ask a local driller.';

  // null when the wells have not loaded. Otherwise { depth, feet, count, lowFt, highFt,
  // confidence ('moderate' | 'low' | null), method ('terrain' | 'nearest' | 'none'), comparable,
  // planningDepth, scoreDepth, elevationChecked, parcelElevationFt, waterLevelDepthFt, drainage,
  // higher, deepWells, residential, median, fallbackMedian, excluded, total, terrainStatus }.
  // depth: the central number (null: no depth on record); count: the wells it rests on.
  const stats = data => WD.stats(data);

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
  // One deep well at similar or higher ground (owner decisions 2026-11-18): with fewer than 3
  // comparable wells it sets the top of the range and is named in full; with 3 or more it does not
  // move the range (two are needed) and is named briefly.
  function deepText(s) {
    const one = s?.method === 'terrain' ? s.deepWells?.single : null;
    if (!one) return '';
    const where = one.dzFt > SIMILAR_FT ? `on ground about ${ft(one.dzFt)} higher` : 'at similar elevation';
    if (s.deepWells.raisedHigh) {
      const extra = [one.flowing ? 'flowing artesian' : '', one.approximateLocation ? 'location approximate (section centre)' : ''].filter(Boolean).join('; ');
      const dist = one.distanceMi != null ? ` ${one.distanceMi.toFixed(1)} mi away` : '';
      return `Top of the range: one well${dist} ${where} went to ${ft(one.depthFt)}${extra ? ` (${extra})` : ''}; ask a local driller.`;
    }
    if (!(one.depthFt > (s.highFt ?? 0))) return '';
    return `One nearby well ${one.dzFt > SIMILAR_FT ? 'on higher ground' : 'at similar elevation'} went to ${ft(one.depthFt)}; deeper wells are possible.`;
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
  const grade = s => WD.grade(s);
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

  const SX = C.septic;
  const { FAVORABLE_MAX_PCT, LIMITED_OVER_PCT, classify } = SX;
  const pct1 = n => `${Number(n).toFixed(1)}%`;

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
  // buildable defaults to the page's last.buildableArea (the rule itself is score-core.js
  // septic.homesiteInput, which takes it as an argument).
  const pageBuildable = buildable => (buildable === undefined ? (() => { try { return typeof last !== 'undefined' ? last?.buildableArea : root.last?.buildableArea; } catch { return root.last?.buildableArea; } })() : buildable);
  const homesiteInput = (land, buildable) => SX.homesiteInput(land, pageBuildable(buildable));

  function assess(land, buildable) {
    const soil = land?.soil;
    if (!soil?.available) return null;
    // The grade (score-core.js septic.evaluate); this function adds the context text.
    const e = SX.evaluate(land, pageBuildable(buildable));
    const { input, noneClear, site, average, measured, soilSlope, slopePct, feasibility } = e;
    const c = e.classified;
    const range = soilSlopeRange(soil);
    const mapSlope = range ? `soil map unit spans ${range[0]}–${range[1]}% slopes` : soilSlope != null ? `soil map unit's typical slope ${soilSlope}%` : '';
    let context;
    if (site) context = [`drainfield-area slope ${pct1(site.slopePct)} (gentlest ~1 ac)`, average != null ? `parcel average ${pct1(average)}` : '', mapSlope].filter(Boolean).join('; ');
    else if (measured != null) context = [mapSlope, `measured parcel grade ${pct1(measured)}`, noneClear ? (input.notChecked ? 'mapped constraints too detailed to check a ~1 acre site' : 'no ~1 acre site clear of mapped constraints') : ''].filter(Boolean).join('; ');
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
  const inputKey = land => { const s = homesiteInput(land); return s?.noneClear ? 'none' : s ? `h:${s.slopePct}` : 'avg'; };
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
    if (!soil.available) return SX.SCORES.unavailable;
    if (soil.septic) apply(land);
    const f = soil.septic ? soil.feasibility : assess(land)?.feasibility || soil.feasibility;
    return SX.feasibilityScore(f);
  }

  // The soil answer came from the backup (USDA Soil Data Access was down): say so where it shows.
  const BACKUP_LABEL = 'Source: USDA SSURGO via Esri (backup — USDA service unavailable)';
  const sourceLabel = soil => (soil?.available && soil.backup ? BACKUP_LABEL : '');

  root.AcresXSeptic = { FAVORABLE_MAX_PCT, LIMITED_OVER_PCT, BACKUP_LABEL, sourceLabel, classify, soilSlopeRange, homesiteInput, assess, apply, score };

  // ---- Terrain factor (owner decision 2026-11-18, PR #93): a gradual scale instead of steps,
  // piecewise-linear through the old step values (score-core.js terrain.score). gradePct is the
  // parcel's mean grade (the slope raster's mean when measured, src/services/slope-raster.js).
  root.AcresXTerrain = { ANCHORS: C.terrain.ANCHORS, score: gradePct => C.terrain.score(gradePct) };

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
