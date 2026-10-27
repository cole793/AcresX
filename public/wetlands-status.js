// Shared reading of the /api/hazards wetlands result for the page's labels and scores. This file
// is the single source of truth for wetland categories, labels, detail text and the wetlands
// score. Injected by maybeInjectUiPolish() in src/index.js before the modules that use it;
// index.html, parcel-preview.js, score-cost.js and screening-refinements.js call
// window.AcresXWetlands at render time (and keep a simple fallback if it has not loaded).
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
  const PRESENT_MIN_ACRES = 0.05;
  const PRESENT_MIN_PCT = 0.5;
  const PRESENT_FLOOR_ACRES = 0.01;
  const CATEGORIES = ['present', 'unmeasured', 'nearby', 'none'];

  const GRADES = {
    present: { label: 'Mapped on parcel', cls: 'amber', overview: 'Mapped wetlands present', overviewCls: 'warn' },
    unmeasured: { score: 55, label: 'Mapped, extent unknown', cls: 'amber', overview: 'Mapped wetlands (extent not measured)', overviewCls: 'warn' },
    nearby: { score: 92, label: 'Nearby only', cls: '', overview: 'Wetland nearby (not on parcel)', overviewCls: '' },
    none: { score: 96, label: 'None mapped', cls: 'green', overview: 'No mapped wetlands', overviewCls: 'good' },
    unavailable: { score: 50, label: 'Unavailable', cls: 'amber', overview: 'Not verified', overviewCls: 'warn' }
  };

  // Number or null; null, undefined and '' are "no value" (Number(null) would be 0).
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function category(w) {
    if (!w?.available) return 'unavailable';
    if (CATEGORIES.includes(w.category)) return w.category;
    if (!w.intersects) return 'none';
    const acres = num(w.overlapAcres ?? w.wetlandAcres);
    if (acres == null) return 'unmeasured';
    if (acres >= PRESENT_MIN_ACRES) return 'present';
    const pct = num(w.coveragePct);
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const acresText = a => (a > 0 && a < 0.001 ? 'under 0.001 ac' : `${a < 0.01 ? a.toFixed(3) : a.toFixed(2)} ac`);

  function coverageText(w) {
    const pct = num(w.coveragePct);
    const acres = num(w.overlapAcres ?? w.wetlandAcres);
    if (pct == null && acres == null) return null;
    return [pct != null ? `${pct.toFixed(1)}% of parcel` : null, acres != null ? acresText(acres) : null].filter(Boolean).join(' · ');
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
    const score = cat === 'present' ? presentScore(num(w.coveragePct)) : g.score;
    return { category: cat, score, label: g.label, cls: g.cls, overview: g.overview, overviewCls: g.overviewCls, detail: detail(w, cat), note: note(w, cat) };
  }

  const score = w => grade(w).score;

  root.AcresXWetlands = { PRESENT_MIN_ACRES, PRESENT_MIN_PCT, PRESENT_FLOOR_ACRES, CATEGORIES, GRADES, category, grade, score };
})(typeof window !== 'undefined' ? window : globalThis);
