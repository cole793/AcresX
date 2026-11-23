// The buildability score rules, in one place (R1 of docs/explore-index.md section 8). A classic
// script with no DOM access and no globals read: every function takes its inputs (the page's
// `last` answer, or one layer of it) as arguments, so the same file runs in the browser
// (injected first by maybeInjectUiPolish() in src/index.js, and by shared-report.html) and in
// Node through node:vm (test/score-core.test.js), as globalThis.AcresXScoreCore.
//
// The page's helpers are thin wrappers over this file and keep their names:
//   window.AcresXScore      screening-refinements.js  calculate, missingInputs, wellStats, WEIGHTS ...
//   window.AcresXWellDepth  screening-inputs.js       stats, grade (+ the card and report text)
//   window.AcresXSeptic     screening-inputs.js       classify, assess, apply, score (+ text)
//   window.AcresXTerrain    screening-inputs.js       score, ANCHORS
//   window.AcresXFlood      flood-status.js           category, score, shareScore (+ labels)
//   window.AcresXWetlands   wetlands-status.js        category, score (+ labels)
//   window.AcresXUtilities  public-utilities.js       waterScore, septicScore, water, sewer (+ costs)
//
// SCORE_RULES_VERSION: bump it on any weight, threshold or factor change, together with the
// recorded fixture scores in test/fixtures/score-core-expected.json (same discipline as
// WELL_TERRAIN_RULES_VERSION in src/services/well-depth-terrain.js). Listing/MLS claims and the
// cost estimate never feed the score.
(function (root) {
  const SCORE_RULES_VERSION = 1;

  // Number or null; null, undefined and '' are "no value" (Number(null) would be 0).
  const finite = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  // The score's own reading (screening-refinements.js before R1): Number(v) when finite, so a null
  // reads as 0. Kept as it was for the buildable-area check.
  const number = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const andList = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

  // ---- Nearby well depth (window.AcresXWellDepth; the rules are described in screening-inputs.js)

  const NEARBY = 5;
  const NONRESIDENTIAL = /\b(irrigat|agricultur|industrial|monitor|observation|injection|dewater|geothermal|environmental|remediation|municipal)\w*/i;
  const SIMILAR_FT = 50;
  const DRAINAGE_FT = 100;
  const MIN_COMPARABLE = 3;

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

  // stats(last): null when the wells have not loaded, else the depth summary described in
  // screening-inputs.js (depth, feet, count, lowFt, highFt, confidence, method, planningDepth,
  // scoreDepth, ...). data.wells.terrain is POST /api/well-depth-terrain's answer.
  function wellStats(data) {
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
        comparableMedianFt: finite(e.comparableMedianFt), comparableP25Ft: finite(e.comparableP25Ft), comparableP75Ft: finite(e.comparableP75Ft),
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

  // { key, label, cls, score }: the card grade, the report chip and the score's water factor.
  // Never "Shallow" at low confidence; low confidence grades by the high end of the range.
  function wellGrade(s) {
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

  const wellDepth = Object.freeze({ NEARBY, NONRESIDENTIAL, SIMILAR_FT, DRAINAGE_FT, MIN_COMPARABLE, excludedWell, depthOf, median, quantile, nearest, stats: wellStats, grade: wellGrade });

  // ---- Septic (window.AcresXSeptic; the rules are described in screening-inputs.js)

  const FAVORABLE_MAX_PCT = 8;
  const LIMITED_OVER_PCT = 15;

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

  // The septic slope input: the buildable-area homesite (last.buildableArea.homesite), else the
  // slope raster's gentlest ~1 ac (land.terrain.homesiteSlopePct), else null (the parcel average
  // or the soil map slope are used). buildable: last.buildableArea, passed in.
  function homesiteInput(land, buildable) {
    const b = buildable;
    const fromBuildable = finite(b?.homesite?.slopePct);
    if (fromBuildable != null) return { slopePct: fromBuildable, homesite: b.homesite };
    // No ~1 acre site clear of mapped constraints: the parcel average, not a site in a flood zone.
    if (b?.homesiteStatus === 'none_clear') return { noneClear: true };
    if (b?.homesiteStatus === 'not_checked') return { noneClear: true, notChecked: true };
    const t = land?.terrain;
    const fromTerrain = t?.available ? finite(t.homesiteSlopePct) : null;
    if (fromTerrain != null) return { slopePct: fromTerrain, homesite: t.homesite || null };
    return null;
  }

  // The septic grade for a land answer: { feasibility, classified, input, site, noneClear,
  // average, measured, soilSlope, slopePct }, or null without an available soil answer.
  function septicEvaluate(land, buildable) {
    const soil = land?.soil;
    if (!soil?.available) return null;
    const t = land?.terrain;
    const average = t?.available ? finite(t.gradePct) : null;
    const input = homesiteInput(land, buildable);
    const noneClear = Boolean(input?.noneClear);
    const site = noneClear ? null : input;
    const measured = site ? site.slopePct : average;
    const soilSlope = finite(soil.soilSlopePct);
    const slopePct = measured ?? soilSlope;
    const classified = classify({ drainage: soil.drainage, hydrologicGroup: soil.hydrologicGroup, slopePct });
    // An answer without the inputs (older cached answers) keeps the service's grade.
    const feasibility = soil.drainage || soil.hydrologicGroup ? classified.feasibility : (soil.soilMapFeasibility || soil.feasibility || 'moderate');
    return { feasibility, classified, input, site, noneClear, average, measured, soilSlope, slopePct };
  }

  const SEPTIC_SCORES = Object.freeze({ favorable: 92, limited: 38, moderate: 66, unavailable: 50 });
  const feasibilityScore = f => (f === 'favorable' ? SEPTIC_SCORES.favorable : f === 'limited' ? SEPTIC_SCORES.limited : SEPTIC_SCORES.moderate);

  // The septic factor (0-100) before public sewer, from the land answer as given (it does not
  // write soil.septic; the page's AcresXSeptic.score grades and stores it first).
  function septicScore(land, buildable) {
    const soil = land?.soil || {};
    if (!soil.available) return SEPTIC_SCORES.unavailable;
    return feasibilityScore(septicEvaluate(land, buildable)?.feasibility || soil.feasibility);
  }

  const septic = Object.freeze({ FAVORABLE_MAX_PCT, LIMITED_OVER_PCT, SCORES: SEPTIC_SCORES, classify, homesiteInput, evaluate: septicEvaluate, feasibilityScore, score: septicScore });

  // ---- Terrain (window.AcresXTerrain; owner decision 2026-11-18, PR #93)
  // Piecewise-linear through the old step values: 0-5% -> 96, then 96 -> 82 by 10%, 82 -> 62 by
  // 15%, 62 -> 35 by 25%, and 35 beyond. gradePct is the parcel's mean grade.

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
  const terrain = Object.freeze({ ANCHORS: TERRAIN_ANCHORS, score: terrainScore });

  // ---- Flood (window.AcresXFlood; categories and their meaning are described in flood-status.js,
  // and match src/services/flood.js FLOOD_RANK / rowCategory)

  const FLOOD_BACKUP_PROVIDER = 'Esri USA Flood Hazard Areas';
  const FLOOD_CATEGORIES = Object.freeze(['high', 'undetermined', 'moderate', 'not_mapped', 'minimal']);
  const NOT_MAPPED_ZONES = Object.freeze(['AREA NOT INCLUDED', 'OPEN WATER']);
  const FLOOD_SCORES = Object.freeze({ high: 20, moderate: 70, undetermined: 55, minimal: 96, not_mapped: 70, limited: 50, unavailable: 50 });

  const isLimited = flood => flood?.available === true && flood?.source?.emptyResult === true;
  const isBackup = flood => flood?.source?.provider === FLOOD_BACKUP_PROVIDER;
  const upper = v => String(v ?? '').trim().toUpperCase();

  // { zone, subtype, sfha } -> category, or null for a row without a zone.
  // A backup-source X with no subtype is moderate: that layer has no minimal X.
  function rowCategory(row, backup) {
    const zone = upper(row?.zone);
    if (!zone) return null;
    if (NOT_MAPPED_ZONES.includes(zone)) return 'not_mapped';
    if (row.sfha === true || /^(A|V)/.test(zone)) return 'high';
    if (zone === 'B') return 'moderate';
    if (zone === 'C') return 'minimal';
    if (zone === 'D') return 'undetermined';
    if (zone === 'X') {
      const subtype = String(row.subtype || '').trim();
      if (subtype) return /AREA OF MINIMAL FLOOD HAZARD/i.test(subtype) ? 'minimal' : 'moderate';
      return backup ? 'moderate' : 'minimal';
    }
    return 'undetermined';
  }

  // Rows for classification: zoneDetails when present, else bare zone codes.
  function rowsOf(flood) {
    if (Array.isArray(flood?.zoneDetails) && flood.zoneDetails.length) return flood.zoneDetails;
    return (Array.isArray(flood?.zones) ? flood.zones : []).map(zone => ({ zone, subtype: null, sfha: null }));
  }

  // Worst of the given categories; none at all is not_mapped.
  function worst(categories) {
    const ranked = categories.map(c => FLOOD_CATEGORIES.indexOf(c)).filter(i => i >= 0);
    return ranked.length ? FLOOD_CATEGORIES[Math.min(...ranked)] : 'not_mapped';
  }

  // The flood result's category: unavailable, limited, or one of FLOOD_CATEGORIES.
  function floodCategory(flood) {
    if (!flood?.available) return 'unavailable';
    if (isLimited(flood) || flood.category === 'limited') return 'limited';
    if (FLOOD_CATEGORIES.includes(flood.category)) return flood.category;
    const backup = isBackup(flood);
    const found = rowsOf(flood).map(r => rowCategory(r, backup)).filter(Boolean);
    // Older answers whose `high` came from SFHA_TF or Esri symbology with no zone code to match.
    // Not when every zone is 'AREA NOT INCLUDED' / 'OPEN WATER': that was the old high bug.
    const onlyNotMapped = found.length > 0 && found.every(c => c === 'not_mapped');
    if (flood.high && !onlyNotMapped) found.push('high');
    if (flood.intersects && !found.length) found.push('undetermined');
    return worst(found);
  }

  // The flood category score (0-100).
  const floodScore = flood => FLOOD_SCORES[floodCategory(flood)];

  // Zone shares were measured (src/services/flood-share.js).
  const shareMeasured = flood => flood?.available === true && flood?.floodShare?.status === 'measured' && Array.isArray(flood?.floodZones) && flood.floodZones.length > 0;

  // The flood factor when FEMA zone shares were measured (2026-11-14), else null (the category
  // score applies). Only high-risk (SFHA) answers change:
  //   SFHA under 1% of the parcel (edge only)   85   small penalty (minimal is 96)
  //   SFHA 1% to under 95%                      5 + 75 x (share outside the SFHA)^1.5
  //                                             (10% -> 69, 25% -> 54, 50% -> 32, 67% -> 19)
  //   SFHA 95% or more (whole parcel)           5    severe
  function floodShareScore(flood) {
    if (!shareMeasured(flood) || floodCategory(flood) !== 'high') return null;
    const share = finite(flood.sfhaSharePct);
    if (share == null) return null;
    if (share < 1) return 85;
    if (share >= 95) return 5;
    return Math.round((5 + 75 * Math.pow(1 - share / 100, 1.5)) * 10) / 10;
  }

  const flood = Object.freeze({
    BACKUP_PROVIDER: FLOOD_BACKUP_PROVIDER, CATEGORIES: FLOOD_CATEGORIES, NOT_MAPPED_ZONES, SCORES: FLOOD_SCORES,
    isLimited, isBackup, rowCategory, rowsOf, worst, category: floodCategory, score: floodScore, shareMeasured, shareScore: floodShareScore
  });

  // ---- Wetlands (window.AcresXWetlands; categories are described in wetlands-status.js and
  // match wetlandCategory() in src/services/wetlands.js)

  const PRESENT_MIN_ACRES = 0.05;
  const PRESENT_MIN_PCT = 0.5;
  const PRESENT_FLOOR_ACRES = 0.01;
  const WETLAND_CATEGORIES = Object.freeze(['present', 'unmeasured', 'nearby', 'none']);
  const WETLAND_SCORES = Object.freeze({ unmeasured: 55, nearby: 92, none: 96, unavailable: 50 });

  function wetlandCategory(w) {
    if (!w?.available) return 'unavailable';
    if (WETLAND_CATEGORIES.includes(w.category)) return w.category;
    if (!w.intersects) return 'none';
    const acres = finite(w.overlapAcres ?? w.wetlandAcres);
    if (acres == null) return 'unmeasured';
    if (acres >= PRESENT_MIN_ACRES) return 'present';
    const pct = finite(w.coveragePct);
    if (pct != null && pct >= PRESENT_MIN_PCT && acres >= PRESENT_FLOOR_ACRES) return 'present';
    return 'nearby';
  }

  // Present: the share of the parcel that is mapped wetland sets the score.
  function presentScore(pct) {
    if (pct == null) return 55;
    if (pct < 5) return 90;
    if (pct < 15) return 80;
    if (pct < 30) return 65;
    if (pct < 50) return 45;
    return 22;
  }

  function wetlandScore(w) {
    const cat = wetlandCategory(w);
    return cat === 'present' ? presentScore(finite(w.coveragePct)) : WETLAND_SCORES[cat];
  }

  const wetlands = Object.freeze({ PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES, CATEGORIES: WETLAND_CATEGORIES, SCORES: WETLAND_SCORES, category: wetlandCategory, presentScore, score: wetlandScore });

  // ---- Public water and sewer (window.AcresXUtilities; owner bug 2026-11-15)
  // last.publicUtilities is POST /api/public-utilities's answer. Only "served" counts: it replaces
  // the well / septic factor with SCORE.served. "likely" is context only and never scored.

  const UTILITY_SCORE = Object.freeze({ served: 92 });
  function utilityFinding(service, l) {
    const f = l?.publicUtilities?.[service] || null;
    return f && f.status === 'served' ? f : null;
  }
  const utilities = Object.freeze({
    SCORE: UTILITY_SCORE,
    finding: utilityFinding,
    water: l => utilityFinding('water', l),
    sewer: l => utilityFinding('sewer', l),
    waterScore: (base, l) => { const f = utilityFinding('water', l); return f ? UTILITY_SCORE[f.status] : base; },
    septicScore: (base, l) => { const f = utilityFinding('sewer', l); return f ? UTILITY_SCORE[f.status] : base; }
  });

  // ---- The buildability score (window.AcresXScore, screening-refinements.js)
  // 7 factors (0-100) weighted by WEIGHTS, shown /10, then the buildable-area homesite check.
  // Factors with missing inputs are left out and the weights of the measured ones re-normalized,
  // so a timed-out layer does not lower the score; "Provisional" below MIN_MEASURED measured.

  const WEIGHTS = Object.freeze({ water: 15, soil: 20, terrain: 20, flood: 15, wetlands: 10, power: 10, zoning: 10 });

  // Buildable area (owner request 2026-11-14; POST /api/buildable-area):
  // - Homesite minimum: 0.5 ac, or half the parcel on a parcel under 1 acre.
  // - Buildable acres below that minimum: the score is capped at 2.5 + 2.5 x (buildable / minimum).
  // - At or above it: no buildable-area penalty (flood and wetlands are already scored by share).
  // - Not measured (still loading, or unavailable): no change.
  const HOMESITE_MIN_AC = 0.5;
  const REMOVED_NAMES = Object.freeze({ flood: 'the flood zone', wetland: 'wetlands', slope: 'steep slopes', setback: 'setbacks' });
  // The acres format of window.AcresXBuildable.fmtAcres (buildable-area.js).
  const fmtAcres = (a, parcel) => ((parcel ?? a) >= 10 ? a.toFixed(1) : a.toFixed(2));

  function buildableCheck(l) {
    const b = l?.buildableArea;
    const ok = b && (b.status === 'measured' || b.status === 'partial') && number(b.buildableAcres) != null;
    if (!ok) return { measured: false, pending: !b };
    const acres = number(b.buildableAcres);
    const parcel = number(b.parcelAcres);
    const need = parcel != null && parcel < 1 ? Math.min(HOMESITE_MIN_AC, parcel / 2) : HOMESITE_MIN_AC;
    const tight = acres < need;
    const fmt = a => fmtAcres(a, parcel);
    const removed = [...new Set((b.removed || []).filter(r => number(r.acres) > 0).map(r => REMOVED_NAMES[r.key] || String(r.reason || r.key).toLowerCase()))];
    let why;
    if (tight) why = `Only ${fmt(acres)} ac remain outside ${andList(removed) || 'mapped constraints'}: a homesite may not fit`;
    else if (removed.length) why = `${fmt(acres)} ac remain outside ${andList(removed)}`;
    else why = `All ${fmt(acres)} ac outside mapped flood zones, wetlands and steep slopes`;
    return { measured: true, acres, need, tight, cap: tight ? 2.5 + 2.5 * (acres / need) : null, why };
  }

  // ---- Missing inputs (2026-11-15): "data missing" is not "data says bad"
  // A factor whose source failed, timed out or has not answered yet is left out of the score.
  // Real answers keep their score: no nearby wells on record, no utility territory found, a
  // county without a zoning source, the FEMA backup's "limited flood data". Per factor:
  //   water     no public water, and the well-records lookup failed or timed out
  //   soil      no public sewer, and the USDA soil answer is unavailable
  //   terrain   the USGS elevation answer is unavailable
  //   flood     the FEMA flood answer is unavailable
  //   wetlands  the NWI wetlands answer is unavailable
  //   power     no confirmed territory, and the utility-territory lookup failed or timed out
  //   zoning    the zoning source answered unavailable / error
  // { key, what, service, section, state: 'pending'|'timeout'|'failed', reason, text } per key.
  const MISSING = Object.freeze({
    water: { what: 'Water', service: 'the well-records lookup', section: 'wells' },
    soil: { what: 'Soil', service: 'USDA soil service', section: 'land' },
    terrain: { what: 'Terrain', service: 'USGS elevation service', section: 'land' },
    flood: { what: 'Flood', service: 'FEMA flood map service', section: 'flood' },
    wetlands: { what: 'Wetlands', service: 'NWI wetlands service', section: 'wetlands' },
    power: { what: 'Power', service: 'the utility-territory lookup', section: 'utility' },
    zoning: { what: 'Zoning', service: 'the county zoning source', section: 'zoningPermits' }
  });
  const MIN_MEASURED = 4;

  // sectionStatus(name): the page's progressive-loading state for a section
  // (window.AcresXSections.status), or nothing outside the page.
  function sectionStateOf(sectionStatus) {
    return name => {
      let s;
      try { s = sectionStatus?.(name); } catch { s = undefined; }
      return s === 'pending' || s === 'timeout' || s === 'failed' ? s : null;
    };
  }

  function missingInputs(l, sectionStatus) {
    const sectionState = sectionStateOf(sectionStatus);
    const soil = l?.land?.soil, terrain = l?.land?.terrain;
    const timedOut = x => Boolean(x?.timedOut) || /timed out/i.test(String(x?.error || ''));
    // A layer whose answer is still null has not arrived yet.
    const stateOf = (section, answer) => sectionState(section) || (answer == null ? 'pending' : timedOut(answer) ? 'timeout' : 'failed');
    const out = {};
    const add = (key, state) => {
      const m = MISSING[key];
      const reason = state === 'pending' ? `${m.service} is still loading` : `${m.service} ${state === 'timeout' ? 'timed out' : "didn't answer"}`;
      const text = `${m.what} not checked (${reason})${state === 'pending' ? '' : ' — try again'}`;
      out[key] = { key, what: m.what, service: m.service, section: m.section, state, reason, text };
    };
    const wellsState = sectionState('wells');
    if (!utilities.water(l) && (wellsState || l?.wells?.lookupFailed)) add('water', wellsState || 'failed');
    if (!utilities.sewer(l) && !soil?.available) add('soil', stateOf('land', l?.land));
    if (!terrain?.available) add('terrain', stateOf('land', l?.land));
    if (!l?.flood?.available) add('flood', stateOf('flood', l?.flood));
    if (!l?.wetlands?.available) add('wetlands', stateOf('wetlands', l?.wetlands));
    const utilState = sectionState('utility');
    if (!l?.powerIntelligence?.territory?.confirmed && (utilState || l?.utility?.lookupFailed)) add('power', utilState || 'failed');
    const zp = l?.zoningPermits;
    if (zp == null || ['unavailable', 'error'].includes(zp?.zoning?.status)) add('zoning', stateOf('zoningPermits', zp));
    return out;
  }

  // opts: { sectionStatus(name), septicScore(land) }. septicScore defaults to septic.score with
  // l.buildableArea; the page passes AcresXSeptic.score, which also stores the grade on the land
  // answer for the septic card.
  function factors(l, opts = {}) {
    const wells = wellStats(l);
    const depth = wells?.depth ?? null;
    const terrainAnswer = l?.land?.terrain || {};
    const floodAnswer = l?.flood || {};
    const wetlandsAnswer = l?.wetlands || {};
    const zoning = l?.zoningPermits?.zoning || {};
    const utilityFound = Array.isArray(l?.utility) && l.utility.length > 0;

    // The water factor is the well grade's score; 40 with no depth on record.
    const grade = wellGrade(wells);
    const wellWater = depth != null ? grade.score : 40;
    // Septic: USDA drainage and hydrologic group with the measured slope.
    const soilSeptic = opts.septicScore ? opts.septicScore(l?.land) : septicScore(l?.land, l?.buildableArea);
    // Public water / sewer replace the well and septic inputs when served (not when only likely).
    const water = utilities.waterScore(wellWater, l);
    const soilScore = utilities.septicScore(soilSeptic, l);
    const terrainFactor = !terrainAnswer.available ? 50 : terrainScore(terrainAnswer.gradePct);
    // With measured zone shares, the flood factor follows how much of the parcel is in the SFHA;
    // unmeasured shares keep the category score.
    const floodFactor = floodShareScore(floodAnswer) ?? floodScore(floodAnswer);
    const powerScore = l?.powerIntelligence?.territory?.confirmed ? 78 : utilityFound ? 70 : 45;
    const zoningScore = zoning.status === 'gis_match' ? 86 : zoning.status === 'no_match' ? 52 : 45;

    const gaps = missingInputs(l, opts.sectionStatus);
    const factor = (key, score, label) => ({ score, label, measured: !gaps[key], ...(gaps[key] ? { missing: gaps[key] } : {}) });
    return {
      water: factor('water', water, 'Water'),
      soil: factor('soil', soilScore, 'Septic'),
      terrain: factor('terrain', terrainFactor, 'Terrain'),
      flood: factor('flood', floodFactor, 'Flood'),
      wetlands: factor('wetlands', wetlandScore(wetlandsAnswer), 'Wetlands'),
      power: factor('power', powerScore, 'Power'),
      zoning: factor('zoning', zoningScore, 'Zoning')
    };
  }

  // { score, factorScore, rating, band, factors, constraint, buildable, why, completeness, weights }
  // for one `last` answer. score is /10 (null when nothing was measured).
  function calculate(l, opts = {}) {
    const fs = factors(l, opts);
    const all = Object.entries(fs);
    const measured = all.filter(([, f]) => f.measured);
    const weightSum = measured.reduce((s, [key]) => s + WEIGHTS[key], 0);
    const weighted = weightSum ? measured.reduce((s, [key, f]) => s + f.score * WEIGHTS[key], 0) / weightSum : null;
    const buildable = buildableCheck(l);
    const factorScore = weighted == null ? null : weighted / 10;
    const score = factorScore == null ? null : buildable.cap != null ? Math.min(factorScore, buildable.cap) : factorScore;
    const missing = all.filter(([, f]) => !f.measured).map(([, f]) => ({ ...f.missing, label: f.label }));
    const total = all.length;
    const provisional = measured.length < MIN_MEASURED;
    const completeness = {
      measured: measured.length, total, complete: !missing.length, provisional, missing,
      label: missing.length ? `Incomplete — ${measured.length} of ${total} factors measured` : '',
      detail: missing.length ? `Not measured: ${missing.map(m => `${m.label} (${m.reason})`).join('; ')}. Left out of the score${provisional ? '; too few factors for a firm rating' : ''}.` : '',
      // Sections a retry can re-run (settled ones only: a pending one is still on its way).
      retry: [...new Set(missing.filter(m => m.state !== 'pending').map(m => m.section))]
    };
    const band = score == null ? '' : score >= 8.5 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5.5 ? 'Moderate' : 'Challenging';
    const rating = score == null ? 'Not scored' : provisional ? 'Provisional' : band;
    const pool = (measured.length ? measured : all).map(([, f]) => f);
    const constraint = pool.slice().sort((a, b) => a.score - b.score)[0];
    // One line for "why this score", under the score on the dashboard and on report page 1.
    const why = buildable.measured ? buildable.why
      : buildable.pending ? `Buildable area still measuring · main constraint: ${constraint.label.toLowerCase()}`
      : `Buildable area not measured · main constraint: ${constraint.label.toLowerCase()}`;
    return { score, factorScore, rating, band, factors: fs, constraint, buildable, why, completeness, weights: { ...WEIGHTS } };
  }

  root.AcresXScoreCore = Object.freeze({
    SCORE_RULES_VERSION, WEIGHTS, HOMESITE_MIN_AC, MIN_MEASURED, MISSING, REMOVED_NAMES,
    finite, andList,
    wellDepth, septic, terrain, flood, wetlands, utilities,
    buildableCheck, missingInputs, factors, calculate
  });
})(typeof window !== 'undefined' ? window : globalThis);
