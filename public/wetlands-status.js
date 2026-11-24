// Shared reading of the /api/hazards wetlands result for the page's labels and scores. This file
// is the single source of truth for wetland labels and detail text (the categories and the
// wetlands score are score-core.js rules). Injected by maybeInjectUiPolish() in src/index.js before the modules that use it;
// index.html and parcel-preview.js call window.AcresXWetlands at render time (and keep a simple
// fallback if it has not loaded); the score reads the rules from score-core.js.
//
// Categories (rules match wetlandCategory() in src/services/wetlands.js):
//   present      NWI wetland overlaps the parcel by >= 0.05 ac, or >= 0.5% of the parcel and
//                >= 0.01 ac                          score by coverage (90 .. 22), amber
//   unmeasured   NWI wetland intersects, overlap could not be measured        score 55, amber
//   nearby       NWI wetland touches the parcel, overlap below the threshold  score 92, neutral
//   none         no NWI wetland intersects the parcel                         score 96, green
//   unavailable  available:false                                              score 50, amber
// Answers without `category` (older cached ones) are classified from intersects / wetlandAcres /
// coveragePct. A null coveragePct is "not measured", never 0%.
(function (root) {
  // The rules (categories, thresholds and scores) are in score-core.js (window.AcresXScoreCore,
  // injected before this file); this file keeps the labels and text.
  const C = root.AcresXScoreCore;
  if (!C) throw new Error('AcresX: public/score-core.js must load before wetlands-status.js');
  const WC = C.wetlands;
  const { PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES, CATEGORIES } = WC;

  const GRADES = {
    present: { label: 'Mapped on parcel', cls: 'amber', overview: 'Mapped wetlands present', overviewCls: 'warn' },
    unmeasured: { score: WC.SCORES.unmeasured, label: 'Mapped, extent unknown', cls: 'amber', overview: 'Mapped wetlands (extent not measured)', overviewCls: 'warn' },
    nearby: { score: WC.SCORES.nearby, label: 'Nearby only', cls: '', overview: 'Wetland nearby (not on parcel)', overviewCls: '' },
    none: { score: WC.SCORES.none, label: 'None mapped', cls: 'green', overview: 'No mapped wetlands', overviewCls: 'good' },
    unavailable: { score: WC.SCORES.unavailable, label: 'Unavailable', cls: 'amber', overview: 'Not verified', overviewCls: 'warn' }
  };

  // Number or null; null, undefined and '' are "no value" (Number(null) would be 0).
  const num = C.finite;
  const category = w => WC.category(w);

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const acresText = a => (a > 0 && a < 0.001 ? 'under 0.001 ac' : `${a < 0.01 ? a.toFixed(3) : a.toFixed(2)} ac`);

  // A real overlap under 0.05% would round to "0.0%"; show it as "<0.1%".
  const pctText = pct => (pct > 0 && pct < 0.05 ? '<0.1%' : `${pct.toFixed(1)}%`);

  function coverageText(w) {
    const pct = num(w.coveragePct);
    const acres = num(w.overlapAcres ?? w.wetlandAcres);
    if (pct == null && acres == null) return null;
    return [pct != null ? `${pctText(pct)} of parcel` : null, acres != null ? acresText(acres) : null].filter(Boolean).join(' · ');
  }

  function detail(w, cat) {
    if (cat === 'unavailable') return 'NWI service unavailable';
    if (cat === 'none') return 'No NWI wetland intersects parcel';
    const count = num(w.count) || 0;
    if (cat === 'unmeasured') return `${plural(count, 'mapped wetland feature')} on or touching the parcel; overlap not measured`;
    if (cat === 'nearby') {
      const acres = num(w.overlapAcres ?? w.wetlandAcres);
      return `Mapped NWI wetland at the parcel edge, not on the parcel${acres > 0 ? ` (overlap ${acresText(acres)})` : ''}. Check setbacks with the county.`;
    }
    const cover = coverageText(w);
    return `${plural(count, 'mapped wetland feature')}${cover ? ` · ${cover}` : ''}`;
  }

  // The one-line note under the score card.
  function note(w, cat) {
    if (cat === 'unavailable') return 'Mapped wetlands: unavailable';
    if (cat === 'none') return 'Mapped wetlands: none detected';
    if (cat === 'unmeasured') return 'Mapped wetlands detected · coverage percentage unavailable';
    if (cat === 'nearby') return 'Mapped wetlands: nearby only, not on parcel';
    const cover = coverageText(w);
    return cover ? `Mapped wetlands: ${cover}` : 'Mapped wetlands detected · coverage percentage unavailable';
  }

  // { category, score, label, cls, overview, overviewCls, detail, note } for one wetlands result.
  function grade(w) {
    const cat = category(w);
    const g = GRADES[cat];
    const score = WC.score(w);
    return { category: cat, score, label: g.label, cls: g.cls, overview: g.overview, overviewCls: g.overviewCls, detail: detail(w, cat), note: note(w, cat) };
  }

  const score = w => WC.score(w);

  root.AcresXWetlands = { PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES, CATEGORIES, GRADES, category, grade, score };
})(typeof window !== 'undefined' ? window : globalThis);
