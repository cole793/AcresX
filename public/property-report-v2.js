// Printable property report. Owner redesigns: 2026-11-13 ("too crowded": Letter pages plus a cost
// appendix) and 2026-11-17 (realtors: "content great, layout hard to read, page 1 overwhelming"),
// the calm layout: more space, larger type, a muted palette, page 1 a summary only.
//
//   Page 1  Summary: light header, address + one facts line, parcel map with scale bar, north arrow
//           and location inset (buildable area shaded sage, removed area hatched terracotta,
//           mapped wetland buffers hatched ochre: shown, not removed), three "at a glance" tiles
//           (buildability score with its one-line why, buildable acres, site cost range) and at
//           most 5 key findings with a small status dot.
//   Page 2  Site details: any further key findings, about the score (why, top drivers), the buildable-area breakdown, site
//           conditions (water, septic, public water/sewer, power, access, flood, wetlands, terrain)
//           as label/value rows.
//   Page 3  Zoning & records: zoning in plain words + permitted uses, overlays, assessor values
//           and tax line, and a listing only when one matched.
//   Page 4  Costs & next steps: what the total sums, the cost table (line, confidence tag, range)
//           with a total equal to the page-1 range, a "before you buy" checklist.
//   Page 5  Cost assumptions: how each cost line was estimated (only when the lines carry it).
//   Last    Sources: the county coverage line, numbered sources with dates, the screening limits.
//
// One source per number:
// - Score: the dashboard's (#scoreMetric, painted by screening-refinements.js); drivers from the
//   same factors (window.AcresXScore.calculate()).
// - Costs: window.AcresXCostModel.estimate() (local-cost-model.js; generic counties get their generic
//   estimate through it). Both pages show the sum of the lines the table lists.
// - Flood / wetlands / public utilities: window.AcresXFlood, AcresXWetlands, AcresXUtilities.
// - Buildable acres: data.buildableArea (/api/buildable-area via public/buildable-area.js);
//   the score's homesite check reads it (screening-refinements.js buildableCheck: under the homesite
//   minimum caps the score); the score's one-line "why" is printed under the score.
// Listing data is shown only when a listing matched, as unverified context; it never feeds the score.
// No owner names are read or shown.
// Co-branding: when the user saved report branding on the Settings page (public/report-branding.js,
// this browser only), page 1 says "Prepared by <name>, <brokerage>" with their logo and contact line,
// every footer carries their contact line, and AcresX appears as "Powered by AcresX". The screening
// disclaimers are the same with or without branding. All branding text is escaped here.
(() => {
  const $ = id => document.getElementById(id);
  const txt = id => ($(id)?.textContent || '').trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const NA = 'Not available';
  const clean = v => (v && v !== '—' && v !== NA && !/^undefined|^NaN/.test(String(v)) ? String(v).trim() : '');
  const val = (...ids) => { for (const id of ids) { const v = clean(txt(id)); if (v) return v; } return ''; };
  const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const usd = n => (num(n) == null ? '' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
  const range = (lo, hi) => {
    const a = num(lo), b = num(hi);
    if (a == null && b == null) return NA;
    if (a == null || b == null || Math.round(a) === Math.round(b)) return usd(a ?? b);
    return `${usd(a)}–${usd(b)}`;
  };
  const kRange = (lo, hi) => {
    const k = n => `$${Math.round(n / 1000)}k`;
    return Math.round(lo / 1000) === Math.round(hi / 1000) ? k(lo) : `${k(lo)}–${k(hi)}`;
  };
  const STATE_NAMES = { WA: 'Washington', ID: 'Idaho', MT: 'Montana' };
  const SMALL = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'on', 'to']);
  const KEEP_UPPER = new Set(['LLC', 'PLLC', 'PUD', 'REA', 'USA', 'US', 'NW', 'NE', 'SW', 'SE', 'WA', 'MT', 'CDA']);
  // "INLAND POWER & LIGHT COMPANY" -> "Inland Power & Light Company"; mixed-case text is kept.
  const titleCase = s => {
    s = String(s || '').trim();
    if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
    // Abbreviations (LLC, PUD, MT, NW) stay upper case.
    return s.split(/(\s+)/).map((w, i) => (KEEP_UPPER.has(w.replace(/\W/g, '')) ? w : (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.toLowerCase().replace(/(^|[-/'(])([a-z])/g, (m, a, b) => a + b.toUpperCase())))).join('');
  };
  const sentence = s => { s = String(s || '').trim(); return s && !/[.!?]$/.test(s) ? `${s}.` : s; };
  // A saved or shared report (renderHtml from a snapshot) prints the date it was generated.
  let renderDate = null;
  const reportNow = () => (renderDate ? new Date(renderDate) : new Date());
  const today = () => reportNow().toISOString().slice(0, 10);

  function reportState() { try { return window.__acresxLast || (typeof last !== 'undefined' ? last : null); } catch { return window.__acresxLast || null; } }

  // ---- Sources: one numbered list for the whole report (last page).
  function sourceList() {
    const list = [], index = new Map();
    const add = (name, { url = '', date = '', verified = true } = {}) => {
      name = String(name || '').trim();
      if (!name) return null;
      const key = `${name}|${date}`;
      if (!index.has(key)) { list.push({ name, url, date, verified }); index.set(key, list.length); }
      return index.get(key);
    };
    const mark = ns => { const u = [...new Set(ns.filter(Boolean))].sort((a, b) => a - b); return u.length ? `<sup class="ref">[${u.join(', ')}]</sup>` : ''; };
    return { list, add, mark };
  }

  // ---- Parcel identity

  function area(parcel, p) {
    const A = window.AcresXAcreage;
    if (A) { const d = A.describe(parcel); if (d.text) return { text: d.text, official: d.official, officialText: d.officialText, note: d.note }; }
    let a = Number(p?.ACRES || p?.ACREAGE || p?.GIS_ACRES || p?.Acres || p?.acres);
    if (Number.isFinite(a) && a > 0) return one(a);
    try { if (typeof turf !== 'undefined' && parcel?.geometry) { a = turf.area(parcel) / 4046.8564224; if (Number.isFinite(a) && a > 0) return one(a); } } catch {}
    return { text: '', official: NaN, officialText: '', note: '' };
  }
  function one(a) { const text = `${a >= 100 ? a.toFixed(1) : a.toFixed(2)} acres`; return { text, official: a, officialText: text, note: '' }; }

  function identity(data) {
    const parcel = data.parcel || {}, p = parcel.properties || {};
    const stateCode = String(p._stateCode || $('state')?.value || p.STATE || 'WA').toUpperCase();
    const county = String(p._countyDisplay || p.COUNTY_NM || $('county')?.value || '').replace(/\s+County$/i, '').trim();
    const pid = String(p.ORIG_PARCEL_ID || p.PARCEL_ID_NR || p.PARCEL_ID || p.PID_NUM || p.PIN || val('parcelFact') || $('parcel')?.value || '').trim();
    const street = [p.SITUS_ADDRESS, p.ADDRESS, p.SitusAddress].map(v => String(v || '').trim()).find(v => v && !/^unassigned|^no situs/i.test(v)) || '';
    const city = titleCase(String(p.SITUS_CITY_NM || p.CITY || '').trim());
    const zip = String(p.SITUS_ZIP_NR || p.ZIP || '').trim();
    const place = [city, [stateCode, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {
      pid, county, stateCode, stateName: p._stateDisplay || STATE_NAMES[stateCode] || stateCode,
      address: street ? titleCase(street) : '', place, acreage: area(parcel, p)
    };
  }

  // ---- Assessor

  function assessment(data) {
    const d = data?.propertyAssessment || {};
    if (!d.available) return null;
    const out = (o, src) => ({ ...o, source: src || d.countySource || d.statewideSource || d.source || '' });
    if (Array.isArray(d.countyRecords) && d.countyRecords.length) {
      const r = d.countyRecords[0] || {}, code = String(r.propertyClass || '').trim(), descr = String(r.propertyClassDescription || '').trim();
      const total = num(r.totalValue) ?? num(r.landValue), land = num(r.landValue);
      const imp = num(r.improvementValue) ?? (total != null && land != null ? total - land : null);
      return out({ total, land, improvements: imp, year: r.taxYear || '', propertyClass: code && descr ? `${code} – ${descr}` : code || descr, acres: num(r.assessorAcres) });
    }
    if (d.state === 'WA') { const r = d.records?.[0] || {}; return out({ total: num(r.land_value), land: num(r.land_value), improvements: null, year: r.tax_year || r.asmt_year || '', acres: num(r.acreage) }); }
    if (d.state === 'MT') { const r = d.statewideRecords?.[0] || {}; const t = num(r.TotalValue), l = num(r.TotalLandValue); return out({ total: t, land: l, improvements: num(r.TotalBuildingValue) ?? (t != null && l != null ? t - l : null), year: r.TaxYear || '', propertyClass: String(r.PropType || '').trim(), acres: num(r.TotalAcres) }); }
    if (d.state === 'ID') { const r = d.statewideRecords?.[0] || {}; return out({ total: num(r.VAL_TOTAL) ?? num(r.VAL_LAND), land: num(r.VAL_LAND), improvements: null, year: r.UPDATED ? new Date(Number(r.UPDATED)).getFullYear() : '', acres: null }); }
    return null;
  }

  // ---- Score (the dashboard's) and its top drivers

  function wellDepth(data) {
    const S = window.AcresXScore;
    // The one definition (screening-inputs.js), the number the dashboard shows.
    try { const s = window.AcresXWellDepth?.stats(data) || S?.wellStats?.(); if (s) return s.depth == null ? null : { depth: s.depth, count: s.count || 0 }; } catch {}
    return null;
  }

  function floodGrade(f) {
    const FX = window.AcresXFlood;
    if (FX) return FX.grade(f);
    if (!f?.available) return { category: 'unavailable', label: NA, cls: 'amber', detail: 'Flood map service did not answer.' };
    const zones = (f.zones || []).join(', ');
    if (f.high) return { category: 'high', label: 'High risk', cls: 'red', detail: `FEMA zone ${zones || 'A'} (high-risk flood area)` };
    if (f.intersects) return { category: 'moderate', label: 'Mapped zone', cls: 'amber', detail: `FEMA zone ${zones}` };
    return { category: 'minimal', label: 'Minimal', cls: 'green', detail: 'No FEMA high-risk flood area mapped on the parcel' };
  }
  function wetlandGrade(w) {
    const WX = window.AcresXWetlands;
    if (WX) return WX.grade(w);
    if (!w?.available) return { category: 'unavailable', label: NA, cls: 'amber', detail: 'Wetland map service did not answer.' };
    if (!w.intersects) return { category: 'none', label: 'None mapped', cls: 'green', detail: 'No NWI wetland intersects the parcel' };
    const pct = num(w.coveragePct);
    return { category: 'present', label: 'Mapped on parcel', cls: 'amber', detail: `${w.count || 1} mapped wetland feature${w.count === 1 ? '' : 's'}${pct != null ? ` · ${pct.toFixed(1)}% of parcel` : ''}` };
  }
  const chipOf = cls => (cls === 'red' ? 'risk' : cls === 'green' ? 'good' : 'verify');

  function scoreInfo(data, facts) {
    let calc = null;
    try { calc = window.AcresXScore?.calculate?.() || null; } catch {}
    const shown = val('scoreMetric');
    const n = num(shown) ?? (calc ? Number(calc.score.toFixed(1)) : null);
    const value = n == null ? '' : n.toFixed(1);
    // Fewer than 4 of 7 factors measured: "Provisional", in a neutral color (screening-refinements.js).
    const provisional = Boolean(calc?.completeness?.provisional);
    const band = n == null || provisional ? 'na' : n >= 7 ? 'good' : n >= 5.5 ? 'fair' : 'poor';
    const base = n == null ? '' : provisional ? 'Provisional' : n >= 8.5 ? 'Excellent' : n >= 7 ? 'Good' : n >= 5.5 ? 'Moderate' : 'Challenging';
    // Limited-coverage county (public/coverage-trust.js): "Excellent · limited data"; same number.
    const rating = window.AcresXCoverage?.softRating ? window.AcresXCoverage.softRating(base, data) : base;
    let drivers = [];
    if (calc) {
      // Impact on the score: weight x distance from a neutral 70. Largest three, either direction.
      // Measured factors only; a factor whose source did not answer is listed as "not checked".
      drivers = Object.entries(calc.factors).filter(([, f]) => f.measured !== false).map(([key, f]) => ({ key, score: f.score, impact: (f.score - 70) * (calc.weights?.[key] ?? 10) }))
        .filter(d => d.impact !== 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3)
        .map(d => ({ good: d.score >= 70, text: driverText(d.key, d.score >= 70, data, facts) })).filter(d => d.text);
      (calc.completeness?.missing || []).forEach(m => drivers.push({ missing: true, text: m.text }));
    }
    if (!drivers.length) drivers = facts.findings.slice(0, 3).map(f => ({ good: f.level === 'good', text: f.title }));
    // The same one-line "why" as the dashboard score card (screening-refinements.js).
    const why = calc?.why || '';
    // "Incomplete — 5 of 7 factors measured", the dashboard's label; '' when every factor was measured.
    const incomplete = calc?.completeness?.label || '';
    return { value, band, rating, drivers, why, incomplete };
  }

  function driverText(key, good, data, f) {
    const PU = window.AcresXUtilities;
    switch (key) {
      case 'water': {
        const pw = PU?.water(data);
        if (pw) return `Public water ${pw.status === 'served' ? 'likely available' : 'may be available'}${pw.provider ? ` (${pw.provider})` : ''}`;
        if (!f.well) return 'No nearby well depths on record';
        const d = Math.round(f.well.depth);
        return d <= 200 ? `Shallow nearby wells (about ${d} ft median)` : d <= 400 ? `Moderate well depths nearby (about ${d} ft)` : `Deep wells nearby (about ${d} ft median)`;
      }
      case 'soil': {
        const ps = PU?.sewer(data);
        if (ps) return `Public sewer ${ps.status === 'served' ? 'likely available' : 'may be available'}`;
        const soil = data.land?.soil || {};
        if (!soil.available) return 'Soil data not available for septic screening';
        return soil.feasibility === 'favorable' ? 'Soils look favorable for a septic system' : soil.feasibility === 'limited' ? 'Soils may limit a conventional septic system' : 'Soils moderately suited to septic';
      }
      case 'terrain': {
        const t = data.land?.terrain || {};
        if (!t.available) return 'Terrain not measured';
        const g = Number(t.gradePct);
        return g <= 5 ? `Nearly flat ground (${g.toFixed(1)}% average grade)` : g <= 10 ? `Gentle slope (${g.toFixed(1)}% average grade)` : g <= 15 ? `Moderate slope (${g.toFixed(1)}% grade)` : `Steep ground (${g.toFixed(1)}% average grade)`;
      }
      case 'flood': {
        const g = floodGrade(data.flood);
        return g.category === 'high' ? 'High-risk FEMA flood zone on the parcel' : g.category === 'minimal' ? 'Minimal flood hazard mapped' : `Flood: ${g.label.toLowerCase()}`;
      }
      case 'wetlands': {
        const g = wetlandGrade(data.wetlands);
        const pct = num(data.wetlands?.coveragePct);
        return g.category === 'present' ? `Mapped wetland on ${pct != null ? `${pct.toFixed(1)}% of ` : ''}the parcel` : g.category === 'none' ? 'No mapped wetlands' : `Wetlands: ${g.label.toLowerCase()}`;
      }
      case 'power': return good ? `Power provider territory mapped (${f.power.primary || 'provider found'})` : 'Power provider not identified';
      case 'zoning': return good ? (f.coverage?.limited ? `Zoning mapped from statewide data (${f.zoneCode || 'zone found'}); verify` : `Official zoning mapped (${f.zoneCode || 'zone found'})`) : 'Zoning not confirmed from an official map';
      default: return '';
    }
  }

  // ---- Facts shared by the pages

  function powerFacts(data) {
    const list = (Array.isArray(data.utility) ? data.utility : []).map(titleCase).filter(Boolean);
    const pi = data.powerIntelligence || {};
    const primary = titleCase(pi.provider) || list[0] || '';
    const others = list.filter(x => x.toLowerCase() !== primary.toLowerCase());
    // distribution.estimatedDistanceFt is the distance the cost model uses (null for an
    // OpenStreetMap line too far or too uncertain to price: src/services/power-intelligence.js).
    const d = num(pi.distribution?.estimatedDistanceFt);
    return { primary, others, distanceFt: d, line: powerLine(pi, data, primary), lookupFailed: Boolean(data.utility?.lookupFailed) };
  }

  // The nearest mapped line, worded by the same rules as the power card (public/ui-polish.js
  // AcresXPowerLine): OpenStreetMap distances are "mapped lines only"; a far or uncertain one is
  // "Distance not confirmed — likely served", never "far from power". null when no line is mapped.
  function powerLine(pi, data, primary) {
    const line = pi.nearestLine;
    const ft = num(line?.distanceFt);
    if (!line || ft == null) return null;
    const osm = line.mappedOnly === true || line.source === 'OpenStreetMap';
    const usable = line.usableForCost === true && line.lineType === 'distribution';
    const feet = `${Math.round(ft).toLocaleString('en-US')} ft`;
    let context = [];
    try { context = window.AcresXPowerLine?.servedContext?.(pi, data) || []; } catch { context = []; }
    if (!context.length && pi.provider) context = [`inside ${primary || pi.provider} territory`];
    const verify = primary ? `verify with ${primary}` : 'verify with the local utility';
    const likely = context.length ? ` Likely served: ${context.join('; ')}` : '';
    const source = osm
      ? { name: 'OpenStreetMap power lines (\u00a9 OpenStreetMap contributors; mapped lines only)', url: 'https://www.openstreetmap.org/copyright' }
      : { name: line.source || line.sourceLabel || 'Utility line map', url: line.sourceUrl || '' };
    if (osm && usable) return { confirmed: true, source, text: `Nearest line mapped in OpenStreetMap about ${feet} away (mapped lines only; OSM maps few local lines here, so the actual nearest line may be closer); the utility confirms the route` };
    if (osm) return { confirmed: false, source, text: `Distance not confirmed — likely served, ${verify}. Nearest ${line.lineType === 'distribution' ? '' : line.lineType === 'transmission' ? 'transmission ' : 'unclassified '}line mapped in OpenStreetMap is about ${feet} away, but OSM maps few local lines here; the actual nearest line may be much closer.${likely}` };
    if (line.lineType === 'transmission') return { confirmed: false, source, text: `Distance not confirmed — likely served, ${verify}. Nearest mapped line is a transmission line about ${feet} away (${line.sourceLabel || 'mapped data'}); local distribution lines are not mapped here.${likely}` };
    return { confirmed: true, source, text: `Distribution line on the ${line.sourceLabel || 'utility map'} about ${feet} away; the utility confirms the route` };
  }

  function costEstimate(data) {
    let e = null;
    try {
      const M = window.AcresXCostModel;
      if (M && typeof M.estimate === 'function') e = M.estimate(data);
      else {
        const f = window.__acresxScreeningCostEstimate || window.__acresxGeneralCostEstimate;
        const base = typeof f === 'function' ? f() : null;
        e = base ? { ...base, local: false } : null;
      }
    } catch (err) { console.warn('Report cost calculation unavailable', err); }
    const labels = { well: 'Well / water', septic: 'Septic', electric: 'Power', power: 'Power', driveway: 'Driveway / access', sitework: 'Site work', permits: 'Permits' };
    const lines = Object.entries(e?.components || {}).map(([key, x]) => ({ key, ...x, label: x.label || labels[key] || key, low: num(x.low), high: num(x.high) }))
      .filter(x => x.low != null || x.high != null)
      .map(x => ({ ...x, low: x.low ?? x.high, high: Math.max(x.high ?? x.low, x.low ?? x.high) }));
    if (!lines.length) return null;
    // The total is the sum of the lines shown (page 1 and page 3 print this same pair).
    const low = lines.reduce((s, x) => s + Math.round(x.low), 0), high = lines.reduce((s, x) => s + Math.round(x.high), 0);
    // Connection alternatives of "likely" public water/sewer (public-utilities.js) and the unverified
    // listing note: shown under the table, never in the total (the dashboard card shows the same).
    const alternatives = lines.map(x => x.alternative).filter(Boolean);
    return { lines, low, high, local: Boolean(e.local), note: e.coverageNote || (e.local ? '' : 'Generic regional ranges; local prices not yet sourced for this county.'), missingNote: e.missingNote || '', alternatives, listingNote: e.listingNote || '' };
  }

  // Confidence tag per cost line, from the `verified` flags of its sources (cost-tables.js):
  // every source verified and the line is a fee schedule or tariff -> "Published fee"; every source
  // verified otherwise (state DOT bid prices, a utility's own estimator) -> "Local price"; any AcresX
  // planning allowance or no source -> "Estimate — get a quote".
  function costTag(line) {
    const s = (line.sources || []).filter(x => x.name);
    if (!s.length || s.some(x => !x.verified)) return { cls: 'estimate', text: 'Estimate — get a quote' };
    if (line.key === 'permits' || line.formula === 'avista' || line.feeProvider) return { cls: 'fee', text: 'Published fee' };
    return { cls: 'local', text: 'Local price' };
  }

  function gatherFacts(data) {
    const id = identity(data);
    const zp = data.zoningPermits || {}, zdp = data.zoningDevelopmentPotential || {};
    const zoneCode = zp.zoning?.code || zdp.code || val('zoningMetric') || '';
    const zoneName = titleCase(zdp.name || zp.zoning?.name || '');
    const PU = window.AcresXUtilities;
    const flood = floodGrade(data.flood), wet = wetlandGrade(data.wetlands);
    // "Zone A on 12% of parcel (2.4 ac); rest zone X" (public/flood-status.js; '' when unmeasured).
    flood.share = window.AcresXFlood?.shareText ? window.AcresXFlood.shareText(data.flood) : '';
    // Septic grade from the measured parcel slope (screening-inputs.js; already applied on the page).
    try { window.AcresXSeptic?.apply(data.land); } catch {}
    const ra = data.costContext?.roadAccess;
    const sfd = (Array.isArray(zdp.uses) ? zdp.uses : []).find(u => /single[- ]family|dwelling, single|^residence$/i.test(u.label || ''));
    const f = {
      ...id, zp, zdp, zoneCode: zoneCode && zoneCode !== 'Not configured' ? zoneCode : '', zoneName,
      flood, wet, well: wellDepth(data), power: powerFacts(data), road: ra,
      water: PU?.water(data) || null, sewer: PU?.sewer(data) || null, puChecked: Boolean(data.publicUtilities?.available),
      soil: data.land?.soil || {}, terrain: data.land?.terrain || {}, sfd,
      assess: assessment(data), cost: costEstimate(data),
      // County coverage badge (public/coverage-trust.js, /api/county-coverage); null if not loaded.
      coverage: window.AcresXCoverage?.forData?.(data)?.coverage || null,
      structure: window.AcresXCoverage?.existingStructure?.(data) || null
    };
    f.findings = findings(data, f);
    return f;
  }

  // ---- Page 1: key findings (red: risk, amber: verify, green: good)

  function findings(data, f) {
    const red = [], amber = [], green = [];
    // Assessor improvements or a well record on the parcel: there may already be a home (info only).
    const existing = f.structure ? [{ title: f.structure.title, detail: f.structure.detail }] : [];
    const overlays = Array.isArray(f.zp.overlays) ? f.zp.overlays : [];
    // Layers whose source did not answer (screening-refinements.js missingInputs): one "not
    // checked" finding instead of a warning that reads as bad data.
    let missing = {};
    try { missing = window.AcresXScore?.missingInputs?.(data) || {}; } catch { missing = {}; }
    const gaps = Object.values(missing);
    if (gaps.length) amber.push({ title: `Not checked: ${gaps.map(m => m.what.toLowerCase()).join(', ')} — try again`, detail: `${gaps.map(m => m.reason.charAt(0).toUpperCase() + m.reason.slice(1)).join('; ')}. Left out of the score.` });
    if (f.flood.category === 'high') red.push({ title: 'High-risk flood zone on the parcel', detail: f.flood.share || f.flood.detail });
    else if (['moderate', 'undetermined', 'not_mapped', 'limited'].includes(f.flood.category)) amber.push({ title: `Flood: ${f.flood.label.toLowerCase()}`, detail: f.flood.share || f.flood.detail });
    if (f.wet.category === 'present' || f.wet.category === 'unmeasured') red.push({ title: 'Mapped wetland on the parcel', detail: f.wet.detail });
    else if (overlays.some(o => o.type === 'wetland')) red.push({ title: 'County-mapped wetland on the parcel', detail: overlays.find(o => o.type === 'wetland').name });
    if (f.road?.available && f.road.status === 'found' && f.road.road?.public === false) amber.push({ title: 'Access is by a private road', detail: `Nearest road ${f.road.road.name || ''} is private; confirm a recorded easement.` });
    else if (f.road?.status === 'none_within') amber.push({ title: 'No mapped road nearby', detail: 'Confirm legal access before buying.' });
    if (f.power.others.length) amber.push({ title: 'Overlapping power territories', detail: `${f.power.primary} · also listed: ${f.power.others.join(', ')}` });
    else if (!f.power.primary && !missing.power) amber.push({ title: 'Power provider not identified', detail: 'Ask the local utilities which one serves the parcel.' });
    if (f.puChecked && !f.sewer) amber.push({ title: 'No public sewer found', detail: 'Plan for a septic system and a soil evaluation.' });
    if (!f.water && f.well && f.well.depth > 400) amber.push({ title: 'Deep wells nearby', detail: `About ${Math.round(f.well.depth)} ft median depth of nearby wells` });
    if (!f.water && !f.well && !missing.water) amber.push({ title: 'No nearby well depths', detail: 'Ask a local driller about expected depth and yield.' });
    if (!f.sewer && f.soil.available && f.soil.feasibility === 'limited') amber.push({ title: 'Soils may limit septic', detail: f.soil.mapUnit || 'USDA soil screening' });
    if (f.terrain.available && Number(f.terrain.gradePct) > 8 && Number(f.terrain.gradePct) <= 15) amber.push({ title: 'Moderate slope', detail: `${Number(f.terrain.gradePct).toFixed(1)}% average grade` });
    if (f.terrain.available && Number(f.terrain.gradePct) > 15) red.push({ title: 'Steep ground', detail: `${Number(f.terrain.gradePct).toFixed(1)}% average grade` });
    if (f.sfd && f.sfd.status === 'permitted') green.push({ title: `Zoning allows a home (${f.zoneCode})`, detail: f.zdp.density || 'Single-family dwelling permitted' });
    else if (f.sfd && f.sfd.status === 'not_permitted') red.push({ title: `Zoning does not list a home as allowed (${f.zoneCode})`, detail: 'Confirm with the jurisdiction.' });
    else if (f.sfd) amber.push({ title: `A home needs review in ${f.zoneCode}`, detail: f.zdp.density || 'Standards or conditional review apply' });
    if (f.water) green.push({ title: 'Public water likely available', detail: f.water.provider || 'Verify with the city/district' });
    if (f.sewer) green.push({ title: 'Public sewer likely available', detail: f.sewer.provider || 'Verify with the city/district' });
    if (f.terrain.available && Number(f.terrain.gradePct) <= 8) green.push({ title: 'Low slope', detail: `${Number(f.terrain.gradePct).toFixed(1)}% average grade` });
    if (!f.water && f.well && f.well.depth <= 200) green.push({ title: 'Shallow wells nearby', detail: `About ${Math.round(f.well.depth)} ft median depth of nearby wells` });
    if (f.power.primary && !f.power.others.length) green.push({ title: 'Power provider mapped', detail: f.power.primary });
    if (!f.sewer && f.soil.available && f.soil.feasibility === 'favorable') green.push({ title: 'Favorable soil for septic', detail: f.soil.mapUnit || 'USDA soil screening' });
    if (f.flood.category === 'minimal') green.push({ title: 'Minimal flood hazard', detail: f.flood.detail });
    if (f.wet.category === 'none' && !overlays.some(o => o.type === 'wetland')) green.push({ title: 'No mapped wetlands', detail: 'National Wetlands Inventory' });
    const tag = level => x => ({ ...x, level });
    const risks = [...red.map(tag('risk')), ...existing.map(tag('verify')), ...amber.map(tag('verify'))];
    const goods = green.map(tag('good'));
    const keepGood = Math.min(goods.length, Math.max(2, 6 - risks.length));
    const out = [...risks.slice(0, 6 - keepGood), ...goods.slice(0, keepGood)];
    return out.slice(0, 6);
  }

  // ---- Map

  function ring(parcel) {
    try { let c = parcel?.geometry?.coordinates; if (!c) return null; while (Array.isArray(c?.[0]?.[0]?.[0])) c = c[0]; return c[0]?.length ? c[0] : null; } catch { return null; }
  }
  function niceScale(ftPerPx, targetPx) {
    const opts = [50, 100, 200, 250, 500, 1000, 2000, 2640, 5280, 10560];
    let best = opts[0];
    for (const o of opts) if (o / ftPerPx <= targetPx) best = o;
    return { ft: best, px: best / ftPerPx, label: best >= 2640 ? `${best / 5280} mi` : `${best.toLocaleString('en-US')} ft` };
  }
  // SVG path for a GeoJSON (Multi)Polygon in the map's frame.
  function geoPath(geometry, toXY) {
    const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polys.map(poly => (poly || []).map(r => (r || []).map((p, i) => `${i ? 'L' : 'M'}${toXY(p)}`).join('') + 'Z').join('')).join('');
  }
  function parcelMap(parcel, buildable) {
    const r = ring(parcel);
    if (!r) return `<div class="map map-missing">Parcel outline not available for a map</div>`;
    // 800 x 330 (was 800 x 400) since the buildable-area strip sits under the map, so page 1 still fits.
    const W = 800, H = 330;
    const xs = r.map(p => +p[0]), ys = r.map(p => +p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, k = Math.cos(cy * Math.PI / 180) || 1;
    // Work in ground-proportional units (longitude x cos(lat)) so the image is not stretched.
    // At least about 0.0016 deg (580 ft) tall: Esri's export refuses requests past its finest zoom.
    let bw = Math.max((maxX - minX) * k * 1.4, 0.0032), bh = Math.max((maxY - minY) * 1.4, 0.0016);
    if (bw / bh < W / H) bw = bh * W / H; else bh = bw * H / W;
    const b = [cx - bw / k / 2, cy - bh / 2, cx + bw / k / 2, cy + bh / 2];
    const toXY = p => `${((p[0] - b[0]) / (b[2] - b[0]) * W).toFixed(1)},${((b[3] - p[1]) / (b[3] - b[1]) * H).toFixed(1)}`;
    const pts = r.map(toXY).join(' ');
    const shaded = buildableMeasured(buildable);
    const keepPath = shaded && buildable.geometry ? geoPath(buildable.geometry, toXY) : '';
    const cutPath = shaded && buildable.removedGeometry ? geoPath(buildable.removedGeometry, toXY) : '';
    const bufPath = shaded && buildable.bufferGeometry ? geoPath(buildable.bufferGeometry, toXY) : '';
    // The layers in the muted status colors (sage, terracotta, ochre).
    const mc = { cutBg: 'rgba(164,81,59,.18)', cut: 'rgba(176,94,70,.8)', bufBg: 'rgba(196,154,60,.16)', buf: 'rgba(192,148,58,.85)', keep: 'rgba(111,154,126,.45)' };
    const shading = keepPath || cutPath ? `<defs><pattern id="cutHatch" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><rect width="9" height="9" fill="${mc.cutBg}"/><rect width="3.5" height="9" fill="${mc.cut}"/></pattern><pattern id="bufHatch" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(-45)"><rect width="9" height="9" fill="${mc.bufBg}"/><rect width="3" height="9" fill="${mc.buf}"/></pattern></defs>${keepPath ? `<path class="keep" d="${keepPath}" fill="${mc.keep}"/>` : ''}${cutPath ? `<path class="cut" d="${cutPath}" fill="url(#cutHatch)"/>` : ''}${bufPath ? `<path class="buf" d="${bufPath}" fill="url(#bufHatch)"/>` : ''}` : '';
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${b.join(',')}&bboxSR=4326&imageSR=4326&size=1000,${Math.round(1000 * H / W)}&format=jpg&f=image`;
    const ftPerPx = bw * 364000 / W; // 1 degree of latitude is about 364,000 ft
    const s = niceScale(ftPerPx, 150);
    const insetW = 0.36, insetH = insetW * 120 / 160; // degrees of latitude, about 25 x 19 miles
    const ib = [cx - insetW / k / 2, cy - insetH / 2, cx + insetW / k / 2, cy + insetH / 2];
    const ink = '#2f3437';
    const insetUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?bbox=${ib.join(',')}&bboxSR=4326&imageSR=4326&size=320,240&format=png&f=image`;
    return `<figure class="map"><img class="map-img" src="${url}" alt="Satellite image of the parcel" onerror="this.closest('.map').classList.add('img-error')">
<svg class="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${shading}<polygon points="${pts}"/></svg>
<svg class="map-deco" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
<g transform="translate(36,38)"><circle r="21" fill="#fff" fill-opacity=".92"/><path d="M0,-16 L6,2 L0,-1 L-6,2 Z" fill="${ink}"/><text y="15" text-anchor="middle" font-size="10" font-weight="600" fill="${ink}">N</text></g>
<g transform="translate(18,${H - 30})"><rect x="-6" y="-9" width="${(s.px + 60).toFixed(0)}" height="22" rx="5" fill="#fff" fill-opacity=".92"/><rect x="0" y="0" width="${(s.px / 2).toFixed(1)}" height="5" fill="${ink}"/><rect x="${(s.px / 2).toFixed(1)}" y="0" width="${(s.px / 2).toFixed(1)}" height="5" fill="#fff" stroke="${ink}" stroke-width="1"/><text x="${(s.px + 6).toFixed(1)}" y="6" font-size="12" font-weight="600" fill="${ink}">${esc(s.label)}</text></g>
</svg>
<div class="map-tag">Parcel boundary approximate${keepPath || cutPath ? ` · <i class="k"></i>buildable estimate <i class="c"></i>removed${bufPath ? ' <i class="b"></i>wetland buffer (not removed)' : ''}` : ''}</div>
<div class="inset"><img src="${insetUrl}" alt="Location map" onerror="this.parentElement.classList.add('img-error')"><span class="inset-dot"></span><span class="inset-label">Location</span></div>
<figcaption class="map-credit">Imagery © Esri and contributors · Inset © Esri, OpenStreetMap contributors</figcaption>
<div class="map-error">Aerial imagery could not be loaded</div></figure>`;
  }

  // ---- Shared bits

  const eyebrow = t => `<div class="eyebrow">${esc(t)}</div>`;
  const chip = (level, text) => `<span class="chip ${level}">${esc(text)}</span>`;
  const brandMark = b => (b.logo ? `<img class="agent-logo-sm" src="${esc(b.logo)}" alt="${esc(b.brokerage || b.name)}">` : `<span class="agent-mark">${esc(b.preparedBy)}</span>`);
  const pageHead = (title, f) => `<header class="mini-head">${f.brand ? brandMark(f.brand) : '<img class="logo-sm" src="/assets/acresx-logo.png" alt="AcresX">'}<div class="mini-title">${eyebrow(title)}<span>${esc(f.address || 'No situs address')} · Parcel ${esc(f.pid || NA)}</span></div></header>`;
  const footer = (n, total, brand) => (brand
    ? `<footer class="foot branded"><span class="foot-agent"><span class="foot-line foot-who">Prepared by ${esc([brand.name, brand.brokerage].filter(Boolean).join(' · ') || brand.preparedBy)}</span>${brand.footerContact.length ? `<span class="foot-line foot-contact">${brand.footerContact.map(esc).join(' · ')}</span>` : ''}</span><span class="foot-right">Powered by AcresX · Screening only · Page ${n} of ${total}</span></footer>`
    : `<footer class="foot"><span>AcresX · Preliminary property intelligence · Verify material findings</span><span>Page ${n} of ${total}</span></footer>`);

  // ---- Buildable acres (screening estimate; feeds only the score's homesite check)

  const buildableMeasured = b => Boolean(b) && (b.status === 'measured' || b.status === 'partial') && num(b.buildableAcres) != null;
  // The buildable-area facts (page 1 tile, page 2 breakdown).
  function buildableParts(b) {
    const B = window.AcresXBuildable;
    const fa = (a, ref) => (B ? B.fmtAcres(a, ref) : (num(ref ?? a) >= 10 ? Number(a).toFixed(1) : Number(a).toFixed(2)));
    if (!buildableMeasured(b)) return { measured: false, why: !b ? 'The buildable-area estimate had not loaded when this report was generated.' : ((b.notes || [])[0] || 'The constraint layers did not answer.') };
    const keep = Math.max(0, Math.min(100, num(b.buildablePct) ?? 0));
    const removed = (b.removed || []).map(r => `${esc(r.reason)} <b>${esc(fa(r.acres, b.parcelAcres))} ac</b> (${esc(num(r.pct) ?? 0)}%)`);
    if (num(b.overlapAcres) >= 0.01) removed.push(`overlaps counted once (${esc(fa(b.overlapAcres, b.parcelAcres))} ac)`);
    const missing = (b.layers || []).filter(l => l.status === 'unavailable' || l.status === 'not_mapped').map(l => l.label || l.key);
    return {
      measured: true, keep, acres: fa(b.buildableAcres, b.parcelAcres), parcelAcres: fa(b.parcelAcres),
      head: `About ${fa(b.buildableAcres, b.parcelAcres)} of ${fa(b.parcelAcres)} acres buildable`,
      list: `${removed.length ? `Removed: ${removed.join(' · ')}.` : 'No mapped flood zone, wetland or steep slope removed.'}${missing.length ? ` Not counted: ${esc(missing.join(', '))}.` : ''}${(b.layers || []).some(l => l.key === 'buffer') ? '' : ' Wetland buffers not mapped here.'}`,
      maybe: (b.mayAlsoRestrict || []).map(r => `<b>May also be restricted:</b> ${esc(String(r.reason).replace(/^Mapped/, 'mapped'))} ${esc(fa(r.acres, b.parcelAcres))} ac (${esc(num(r.pct) ?? 0)}%) — the buffer that applies depends on a wetland delineation.`),
      note: `${esc(b.disclaimer || '')} Verify with the responsible agency.`
    };
  }
  // ---- Page 1

  const generatedOn = () => reportNow().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  function brandParts() {
    try { const B = window.AcresXBranding; return B ? B.parts(B.load()) : null; } catch { return null; }
  }

  // ---- Section blocks (pages 2-4)

  const USE_LABELS = { permitted: 'Permitted', limited: 'With standards', conditional: 'Conditional review', not_permitted: 'Not permitted' };
  function zoningBlock(f, S) {
    const z = f.zdp, uses = Array.isArray(z.uses) ? z.uses : [];
    const zsrc = typeof f.zp.source === 'string' ? f.zp.source : f.zp.source?.agency || f.zp.source?.name || '';
    const zref = S.mark([S.add(z.source ? `${z.source}${z.sourceChapter ? `, chapter ${z.sourceChapter}` : ''}` : zsrc, { url: z.sourceUrl || f.zp.zoning?.sourceUrl || f.zp.sourceUrl, date: '' })]);
    const juris = f.zp.jurisdiction || z.jurisdiction || '';
    const title = f.zoneName && f.zoneName !== f.zoneCode ? f.zoneName : f.zoneCode ? `Zone ${f.zoneCode}` : 'Zoning';
    const head = `<div class="zone-head"><div class="zone-code">${esc(f.zoneCode || NA)}</div><div><strong>${esc(title)}</strong>${zref}<span>${esc([juris, z.density || 'Density: see the zoning code'].filter(Boolean).join(' · '))}</span></div></div>`;
    if (!z.available || !uses.length) {
      const why = String(z.note || 'Detailed permitted-use rules are not in AcresX for this zone yet').replace(/[.\s]+$/, '');
      const link = f.zp.zoning?.url ? ` Zone summary: ${f.zp.zoning.url}` : '';
      return `${head}<p class="plain">${esc(f.zoneCode ? `${f.zoneCode} is the mapped zone. ${why}; check the jurisdiction's zoning code for what can be built.${link}` : 'Zoning could not be confirmed from an official map. Verify with the jurisdiction.')}</p>`;
    }
    const s = f.sfd;
    const what = !s ? 'The use table below lists what this zone allows; a single-family home is not listed by name, so confirm with the jurisdiction.'
      : s.status === 'permitted' ? `A single-family home is permitted outright${z.density ? `, within the density limit (${z.density.replace(/^Maximum/, 'maximum')})` : ''}, subject to setbacks and the overlays below.`
        : s.status === 'not_permitted' ? 'A single-family home is not listed as permitted in this zone.'
          : `A single-family home is allowed with ${s.status === 'conditional' ? 'a conditional or special review' : 'added standards'}.`;
    return `${head}<p class="plain">${esc(what)}</p><table class="uses"><tbody>${pairs(uses).map(row => `<tr>${row.map(u => (u ? `<td><i class="${esc(u.status || 'verify')}"></i>${esc(u.label)}</td><td class="st">${esc(USE_LABELS[u.status] || 'Verify')}</td>` : '<td></td><td></td>')).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const pairs = list => { const half = Math.ceil(list.length / 2), out = []; for (let i = 0; i < half; i++) out.push([list[i], list[i + half]]); return out; };

  function overlayBlock(f, S) {
    const o = f.zp.overlays;
    const down = Array.isArray(f.zp.overlaysUnavailable) && f.zp.overlaysUnavailable.length ? `<p class="muted">Overlay layers that did not answer: ${esc(f.zp.overlaysUnavailable.map(x => x.type || x.name).join(', '))}.</p>` : '';
    const uga = f.zp.urbanGrowthArea;
    const ugaLine = uga && typeof uga.intersects === 'boolean' ? `<li><strong>${uga.intersects ? `Inside the urban growth area${uga.name ? ` (${esc(uga.name)})` : ''}` : 'Outside the urban growth area'}</strong></li>` : '';
    if (!Array.isArray(o)) return `<p class="muted">Overlay layers are not checked for this county yet.</p>`;
    if (!o.length) return `<ul class="overlays">${ugaLine}<li><strong>No mapped overlays found</strong> <span>on the overlay layers AcresX checks.</span></li></ul>${down}`;
    return `<ul class="overlays">${o.map(x => {
      const share = num(x.share);
      const ref = S.mark([S.add(x.source, { url: x.sourceUrl, date: '' })]);
      return `<li><strong>${esc(x.name || x.code || x.type)}</strong>${share != null ? ` <em>${share >= 0.995 ? 'whole parcel' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of parcel`}</em>` : ''}${ref}${x.detail ? `<span>${esc(x.detail)}</span>` : ''}</li>`;
    }).join('')}${ugaLine}</ul>${down}`;
  }

  function siteCards(data, f, S) {
    const PU = window.AcresXUtilities;
    const st = f.stateCode;
    const wellSource = st === 'ID' ? 'Idaho Department of Water Resources (IDWR) well records' : st === 'MT' ? 'Montana Bureau of Mines and Geology GWIC well records' : 'Washington Ecology well records';
    const cards = [];
    const card = (title, level, status, lines, refs = []) => cards.push(`<article class="site"><div class="site-top"><h3>${esc(title)}${S.mark(refs)}</h3>${chip(level, status)}</div>${lines.filter(Boolean).slice(0, 2).map(l => `<p>${esc(sentence(l))}</p>`).join('') || `<p>${NA}.</p>`}</article>`);
    // Water / well
    const ex = data.existingWell || {}, exm = ex.best || ex.match || {}, ev = exm.evidence || {};
    const wellNote = ex.available && ex.match ? (ev.insideParcel ? 'A recorded well maps inside the parcel; verify it' : `Possible well record ${num(ev.distanceToParcelFt) != null ? `${Math.round(ev.distanceToParcelFt).toLocaleString('en-US')} ft from the parcel` : 'nearby'} (${String(ex.confidence || 'low').toLowerCase()} confidence)`) : '';
    const depthLine = f.well ? `Median nearby well depth (${f.well.count} well${f.well.count === 1 ? '' : 's'}): ${Math.round(f.well.depth)} ft` : 'No nearby well depths on record';
    const wref = S.add(wellSource, { date: '' });
    if (f.water) {
      card('Water', 'good', 'Public water', [`${f.water.basis}${f.water.asOf ? ` (map as of ${f.water.asOf})` : ''}`, `If a private well were needed: ${depthLine.charAt(0).toLowerCase()}${depthLine.slice(1)}`], [S.add(f.water.source?.name, { url: f.water.source?.url, date: f.water.asOf ? `as of ${f.water.asOf}` : '' }), wref]);
    } else {
      const d = f.well?.depth;
      card('Water / well', d == null ? 'verify' : d <= 200 ? 'good' : d <= 400 ? 'verify' : 'risk', d == null ? 'No depth data' : d <= 200 ? 'Shallow wells' : d <= 400 ? 'Moderate depth' : 'Deep wells', [depthLine, wellNote], [wref]);
    }
    // Septic / soil
    const soil = f.soil;
    const sref = soil.available ? S.add('USDA NRCS Soil Data Access (SSURGO)', { date: '' }) : null;
    const soilLine = soil.available ? [soil.mapUnit || soil.component, soil.drainage, soil.hydrologicGroup ? `hydrologic group ${soil.hydrologicGroup}` : ''].filter(Boolean).join(' · ') : 'Soil data not available';
    if (f.sewer) card('Sewer', 'good', 'Public sewer', [`${f.sewer.basis}${f.sewer.asOf ? ` (map as of ${f.sewer.asOf})` : ''}`, soil.available ? `If a septic system were needed: ${soilLine}` : ''], [S.add(f.sewer.source?.name, { url: f.sewer.source?.url, date: '' }), sref]);
    else card('Septic / soil', !soil.available ? 'verify' : soil.feasibility === 'favorable' ? 'good' : soil.feasibility === 'limited' ? 'risk' : 'verify', !soil.available ? NA : soil.feasibility === 'favorable' ? 'Favorable' : soil.feasibility === 'limited' ? 'Limited' : 'Moderate', [soilLine, `${soil.septic?.context ? `${soil.septic.context}${soil.septic.limits?.length ? `; limited by ${soil.septic.limits.join(', ')}` : ''}. ` : ''}USDA screening only; a site evaluation sets the system type`], [sref]);
    // Public water / sewer
    if (PU && data.publicUtilities) {
      // Served counts; likely is "may be available", not counted (owner bug 2026-11-15).
      const both = f.water && f.sewer, any = f.water || f.sewer;
      const maybe = PU.likely?.('water', data) || PU.likely?.('sewer', data);
      const srcs = (data.publicUtilities.sources || []).filter(s => s.ok !== false).slice(0, 2).map(s => S.add(s.name, { url: s.url, date: '' }));
      const note = PU.listingNote?.(data) || '';
      card('Public water / sewer', both ? 'good' : 'verify', both ? 'Both mapped' : any ? 'One mapped' : maybe ? 'May be available' : data.publicUtilities.available ? 'Not found' : NA,
        note ? [`${PU.line('water', data)} · ${PU.line('sewer', data)}`, note] : [PU.line('water', data), PU.line('sewer', data)], srcs);
    } else card('Public water / sewer', 'verify', NA, ['Public water and sewer maps were not checked for this report']);
    // Power
    const p = f.power;
    if (p.primary) {
      const unconfirmed = p.line && !p.line.confirmed;
      const level = p.others.length || unconfirmed ? 'verify' : 'good';
      const status = p.others.length ? 'Overlapping territories' : unconfirmed ? 'Distance not confirmed' : 'Provider mapped';
      const lineText = p.line ? p.line.text : p.distanceFt != null ? `Mapped line about ${Math.round(p.distanceFt).toLocaleString('en-US')} ft away; the utility confirms the route` : 'Territory does not confirm a service connection; the utility confirms the route';
      const refs = [S.add('Utility service territory maps (HIFLD / utility published maps)', { date: '' }), ...(p.line ? [S.add(p.line.source.name, { url: p.line.source.url, date: '' })] : [])];
      card('Power', level, status, [`${p.primary}${p.others.length ? ` · also listed: ${p.others.join(', ')}` : ''}`, lineText], refs);
    }
    else card('Power', 'verify', p.lookupFailed ? NA : 'Not identified', ['Power provider not identified from territory maps']);
    // Access / driveway
    const ra = f.road;
    if (ra?.available && ra.status === 'found') {
      const priv = ra.road?.public === false;
      card('Access / driveway', priv ? 'verify' : 'good', priv ? 'Private road' : 'Public road', [`${Math.round(ra.distanceFt).toLocaleString('en-US')} ft to ${ra.road?.name || 'the nearest road'}${ra.road?.kind ? ` (${ra.road.kind})` : ''}`, priv ? (ra.nearestPublic ? `Nearest public road: ${ra.nearestPublic.road?.name || 'unnamed'} at ${Math.round(ra.nearestPublic.distanceFt).toLocaleString('en-US')} ft; confirm a recorded easement` : 'No public road nearby; confirm a recorded easement') : 'Straight-line distance, not a surveyed driveway route'], [S.add(ra.source?.name, { url: ra.source?.url, date: '' })]);
    } else if (ra?.available && ra.status === 'none_within') card('Access / driveway', 'risk', 'No road nearby', [`No mapped road within ${Math.round(ra.searchedFt || 0).toLocaleString('en-US')} ft`, 'Confirm legal access before buying']);
    else card('Access / driveway', 'verify', NA, ['Road access was not measured for this county']);
    // Flood
    const fl = data.flood || {};
    const fOverlay = (f.zp.overlays || []).find(o => /flood/i.test(`${o.type} ${o.name}`));
    const share = num(fl.sharePct) ?? (num(fl.share) != null ? num(fl.share) * 100 : null);
    card('Flood', chipOf(f.flood.cls), f.flood.label, [
      f.flood.detail,
      f.flood.share ? `${f.flood.share}. Map estimate; a floodplain determination confirms where the line falls` : share != null ? `Flood zone covers about ${share.toFixed(share < 10 ? 1 : 0)}% of the parcel` : fOverlay ? `County overlay: ${fOverlay.name}${num(fOverlay.share) != null ? ` on ${Math.round(fOverlay.share * 100)}% of the parcel` : ''}` : f.flood.category === 'high' ? 'Mapped share of the parcel not measured; check where the zone falls relative to a homesite' : ''
    ], [fl.available ? S.add(fl.source?.label || fl.source?.provider || 'FEMA National Flood Hazard Layer', { url: fl.source?.url, date: '' }) : null]);
    // Wetlands
    const w = data.wetlands || {};
    const types = Array.isArray(w.types) && w.types.length ? w.types.join(', ') : '';
    const wOver = (f.zp.overlays || []).filter(o => /wetland/.test(o.type || ''));
    const wOverLine = wOver.length ? `County map: ${wOver.map(o => `${String(o.name || o.type).replace(/^[^:]*:\s*/, '').replace(/\bfoot\b/g, 'ft')}${num(o.share) != null ? ` on ${Math.round(o.share * 100)}%` : ''}`).join('; ')}` : '';
    card('Wetlands', f.wet.category === 'present' || f.wet.category === 'unmeasured' ? 'risk' : chipOf(f.wet.cls), f.wet.label, [`${f.wet.detail}${types ? ` · ${types}` : ''}`, wOverLine], [w.available ? S.add('USFWS National Wetlands Inventory', { date: '' }) : null]);
    // Terrain
    const t = f.terrain;
    if (t.available && num(t.gradePct) != null) {
      const g = Number(t.gradePct), lc = data.land?.landCover;
      card('Terrain', g <= 8 ? 'good' : g <= 15 ? 'verify' : 'risk', g <= 8 ? 'Low slope' : g <= 15 ? 'Moderate' : 'Steep', [`${g.toFixed(1)}% average grade${num(t.maxGradePct) != null ? `, ${Number(t.maxGradePct).toFixed(1)}% max` : ''}${num(t.reliefFt) != null ? ` · ${Math.round(t.reliefFt)} ft relief` : ''}`, lc?.available && num(lc.openPct) != null ? `About ${lc.openPct}% open, ${lc.woodedPct}% wooded (satellite estimate)` : ''], [S.add(t.source || 'USGS 3DEP elevation', { date: '' })]);
    } else card('Terrain', 'verify', NA, ['Elevation data not available']);
    return `<div class="sites">${cards.join('')}</div>`;
  }

  // Property tax line from /api/property-tax (public/property-tax.js keeps it in last.propertyTax):
  // billed amount or Kootenai's levy-rate estimate, always with its basis; "Not available" otherwise.
  function taxCell(data, S) {
    const t = data?.propertyTax;
    if (!t) return '';
    const d = window.AcresXPropertyTax?.describe?.(t);
    if (!d) return '';
    const ref = t.available && t.source?.name ? S.mark([S.add(t.source.name, { url: window.AcresXPropertyTax.safeUrl(t.source.url), date: t.asOf ? `as of ${t.asOf}` : '' })])
      : d.linkUrl ? S.mark([S.add(d.linkLabel, { url: d.linkUrl, date: '' })]) : '';
    return `<div><span>${esc(d.heading)}</span><strong>${esc(d.value)}${ref}</strong><small>${esc(d.basis)}</small></div>`;
  }

  function assessorBlock(f, S, data) {
    const a = f.assess;
    const tax = taxCell(data, S);
    if (!a) return tax ? `<div class="assessor">${tax}</div><p class="muted">Assessor values not available for this parcel.</p>` : `<p class="muted">Assessor values not available for this parcel.</p>`;
    const ref = S.mark([S.add(a.source, { date: a.year ? `tax year ${a.year}` : '' })]);
    const cells = [];
    // Land equal to the total is shown once, with a note, instead of the same amount twice.
    const landOnly = a.total != null && a.land != null && Math.round(a.total) === Math.round(a.land) && !(a.improvements > 0);
    const landNote = a.improvements == null ? 'Land value; improvements not reported' : 'Land only; no assessed improvements';
    cells.push(`<div><span>Assessed value${a.year ? ` (${esc(a.year)})` : ''}</span><strong>${a.total != null ? esc(usd(a.total)) : NA}</strong>${landOnly ? `<small>${landNote}</small>` : ''}</div>`);
    if (!landOnly) {
      cells.push(`<div><span>Land</span><strong>${a.land != null ? esc(usd(a.land)) : NA}</strong></div>`);
      cells.push(`<div><span>Improvements</span><strong>${a.improvements != null ? (a.improvements > 0 ? esc(usd(a.improvements)) : 'None assessed') : NA}</strong></div>`);
    }
    cells.push(`<div><span>Tax category</span><strong>${esc(a.propertyClass || NA)}</strong><small>Tax category, not zoning</small></div>`);
    cells.push(`<div><span>Assessor acres</span><strong>${a.acres != null ? `${a.acres.toFixed(2)} ac` : NA}</strong></div>`);
    if (tax) cells.push(tax);
    return `<div class="assessor">${cells.join('')}</div><p class="muted">${esc(a.source || 'County assessor')}${ref}</p>`;
  }

  function listingBlock(data) {
    const listing = data.resoListings || data.listingContext || {};
    const rec = listing.best || listing.match || null;
    if (!rec) return '';
    const bits = [rec.status || rec.standardStatus || rec.StandardStatus, num(rec.listPrice) != null ? `List ${usd(rec.listPrice)}` : '', num(rec.daysOnMarket) != null ? `${rec.daysOnMarket} days on market` : '', rec.listingId ? `MLS ${rec.listingId}` : ''].filter(Boolean);
    return `<section class="c-sec block"><h2>Listing</h2><p class="listing"><strong>${esc(bits.join(' · ') || 'Listing match')}</strong><span>Listing claims are unverified context and do not affect the buildability score.</span></p></section>`;
  }

  function costBlock(f, S, notes) {
    const c = f.cost;
    if (!c) return `<p class="muted">Cost inputs were not available when this report was generated.</p>`;
    const rows = c.lines.map((l, i) => {
      const tag = costTag(l);
      const refs = (l.sources || []).filter(s => s.name).map(s => S.add(s.name, { url: s.url, date: !s.asOf ? '' : /^undated$/i.test(s.asOf) ? 'undated' : `as of ${s.asOf}`, verified: s.verified }));
      if (l.basis) notes.push(`<li><strong>${esc(l.label)}</strong>${S.mark(refs)}<span class="amt-note">${esc(range(l.low, l.high))}</span><p>${esc(l.basis)}</p></li>`);
      const alt = l.alternative ? `<tr class="alt"><td colspan="3">${esc(l.alternative.text)} <em>Alternative, not in the total.</em></td></tr>` : '';
      return `<tr><td><strong>${esc(l.label)}</strong>${S.mark(refs)}</td><td><span class="tag ${tag.cls}">${esc(tag.text)}</span></td><td class="amt">${esc(range(l.low, l.high))}</td></tr>${alt}`;
    }).join('');
    return `<table class="costs"><thead><tr><th>Line</th><th>Confidence</th><th class="amt">Range</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total (matches page 1)</td><td class="amt">${esc(range(c.low, c.high))}</td></tr></tfoot></table>
${c.listingNote ? `<p class="listing-note">${esc(c.listingNote)}. Not used in the estimate or the score.</p>` : ''}<p class="muted">Screening estimate, not a quote. ${esc(c.note || '')} Midpoint about ${esc(kRange((c.low + c.high) / 2, (c.low + c.high) / 2))}. Exact fees are used where an official schedule was found; everything else is a labeled planning range.</p>${f.appendixPage ? `<p class="pointer">How each line was estimated: appendix, page ${f.appendixPage}.</p>` : ''}`;
  }

  function checklist(data, f) {
    const items = [];
    const juris = f.zp.permitJurisdiction?.name || f.zp.jurisdiction || (f.county ? `${f.county} County` : 'the jurisdiction');
    items.push(['Zoning and use', `Confirm with ${juris} that a home is allowed${f.zoneCode ? ` in ${f.zoneCode}` : ''}${f.zdp.density ? ` (${f.zdp.density.replace(/^Maximum/, 'maximum')})` : ''}, and check setbacks, overlays and legal lot status.`]);
    const fw = [];
    if (f.flood.category === 'high' || f.flood.category === 'moderate') fw.push('a floodplain determination');
    if (f.wet.category === 'present' || f.wet.category === 'unmeasured' || (f.zp.overlays || []).some(o => /wetland/.test(o.type || ''))) fw.push('a wetland delineation');
    items.push(['Flood and wetlands', fw.length ? `Get ${fw.join(' and ')} before choosing a homesite; buffers can move where you can build.` : 'Confirm with the county that no flood or critical-area permit applies to your homesite.']);
    const PU = window.AcresXUtilities;
    const ask = service => { const m = PU?.likely?.(service, data); return m ? ` Also ask ${String(m.provider || 'the city or district').replace(/\s*\(.*?\)\s*$/, '')} whether public ${service} can serve the parcel${/^(city|town) of /i.test(m.provider || '') && m.cityLimits && m.cityLimits !== 'inside' ? ' (outside city limits this usually needs annexation or an extension agreement)' : ''}.` : ''; };
    items.push(['Water', f.water ? `Confirm water connection availability, capacity and fees with ${f.water.provider || 'the city/district'}.` : `Review nearby well logs and ask a licensed driller about depth, yield and water quality.${ask('water')}`]);
    items.push(['Sewer or septic', f.sewer ? `Confirm sewer connection availability and fees with ${f.sewer.provider || 'the city/district'}.` : `Order a soil and site evaluation from the local health district for a septic permit.${ask('sewer')}`]);
    items.push(['Power', f.power.primary ? `Request a line-extension estimate from ${f.power.primary}${f.power.others.length ? `, and confirm whether ${f.power.others.join(' or ')} serves the parcel instead` : ''}.` : 'Ask the local utilities which one serves the parcel and request a line-extension estimate.']);
    const priv = f.road?.status === 'found' && f.road.road?.public === false;
    items.push(['Access', priv ? `Confirm legal access over ${f.road.road.name || 'the private road'}: a recorded easement and any road maintenance agreement.` : 'Confirm legal access and the driveway approach permit with the road authority.']);
    items.push(['Title', 'Order a title report to review easements, covenants, CC&Rs and other recorded restrictions.']);
    return `<ol class="checklist">${items.slice(0, 7).map(([h, t]) => `<li><p><strong>${esc(h)}.</strong> ${esc(t)}</p></li>`).join('')}</ol>`;
  }

  const host = u => { try { return new URL(u).host; } catch { return ''; } };
  const sourceItems = S => S.list.map((s, i) => `<li value="${i + 1}">${esc(s.name)}${s.date ? `, ${esc(s.date)}` : ''}${s.verified === false ? ' (unverified)' : ''}${host(s.url) ? ` <span class="url">${esc(host(s.url))}</span>` : ''}</li>`).join('');
  const LIMITS = 'AcresX compiles public records and third-party data. It is not a survey, appraisal, title report, wetland delineation, septic design, utility availability confirmation, zoning determination or engineering analysis, and does not guarantee development approval. Parcel boundaries and mapped features are approximate. Cost estimates are planning ranges, not bids. Verify material findings with the responsible agency, utility, licensed professional and title provider.';

  // ---- Pages. The section blocks above (zoning, overlays, site conditions, assessor, costs,
  // checklist) are shared; the stylesheet (CSS) lays them out as plain sections with hairlines.
  const PAGE_NO = { summary: 1, details: 2, zoning: 3, costs: 4, assumptions: 5 };
  const sec = (title, body, cls = '') => `<section class="c-sec block${cls ? ` ${cls}` : ''}"><h2>${esc(title)}</h2>${body}</section>`;
  const dot = level => `<i class="dot ${esc(level)}"></i>`;
  // Page 1 lists at most this many key findings; the rest open page 2.
  const PAGE1_FINDINGS = 5;
  const findingList = list => `<ul class="kf">${list.map(x => `<li class="${esc(x.level)}">${dot(x.level)}<p><strong>${esc(x.title)}</strong>${x.detail ? `<span class="kf-d"> — ${esc(x.detail)}</span>` : ''}</p></li>`).join('')}</ul>`;

  function summaryHeader(b) {
    const right = `<div class="c-head-right"><span>Property report</span><span>Generated ${esc(generatedOn())}</span>${b ? '<span class="powered">Powered by AcresX</span>' : ''}</div>`;
    if (!b) return `<header class="c-head"><img class="logo" src="/assets/acresx-logo.png" alt="AcresX">${right}</header>`;
    return `<header class="c-head branded"><div class="agent">${b.logo ? `<img class="agent-logo" src="${esc(b.logo)}" alt="${esc(b.brokerage || b.name)}">` : ''}<div class="agent-text"><p class="prepared">Prepared by ${esc(b.name)}${b.brokerage ? `, ${esc(b.brokerage)}` : ''}</p>${b.contact.length ? `<p class="agent-contact">${b.contact.map(c => `<span class="ct">${esc(c)}</span>`).join(' · ')}</p>` : ''}</div></div>${right}</header>`;
  }

  function tiles(data, f, score) {
    const bx = buildableParts(data.buildableArea);
    const cost = f.cost;
    const scoreTile = `<article class="tile t-score band-${score.band}"><h3>Buildability score</h3><div class="t-num">${esc(score.value || '—')}${score.value ? '<small>/10</small>' : ''}</div><p class="t-label">${score.value ? dot(score.band) : ''}${esc(score.rating || NA)}</p>${score.incomplete ? `<p class="t-flag">${esc(score.incomplete)}</p>` : ''}${score.why ? `<p class="t-why">${esc(sentence(score.why))}</p>` : ''}</article>`;
    const acresTile = bx.measured
      ? `<article class="tile t-acres"><h3>Buildable acres</h3><div class="t-num">${esc(bx.acres)}<small> of ${esc(bx.parcelAcres)} ac</small></div><p class="t-label">About ${esc(bx.keep)}% of the parcel</p><p class="t-why">Screening estimate after mapped flood, wetland and steep-slope areas. Breakdown on page ${PAGE_NO.details}.</p></article>`
      : `<article class="tile t-acres"><h3>Buildable acres</h3><div class="t-num t-na">Not measured</div><p class="t-why">${esc(bx.why)}</p></article>`;
    const mid = cost ? kRange((cost.low + cost.high) / 2, (cost.low + cost.high) / 2) : '';
    const costTile = cost
      ? `<article class="tile t-cost"><h3>Site development cost</h3><div class="t-num t-range">${esc(range(cost.low, cost.high))}</div><p class="t-label">Midpoint about ${esc(mid)}</p><p class="t-why">Screening estimate, not a quote. ${cost.lines.length} cost lines on page ${PAGE_NO.costs}.</p></article>`
      : `<article class="tile t-cost"><h3>Site development cost</h3><div class="t-num t-na">${NA}</div><p class="t-why">Cost inputs were not available when this report was generated. Screening estimate, not a quote.</p></article>`;
    return `<div class="tiles">${scoreTile}${acresTile}${costTile}</div>`;
  }

  function page1(data, f, score, name) {
    const refName = name && ![f.address, `Parcel ${f.pid}`, f.pid, 'Property'].includes(name) ? name : '';
    const where = [f.county ? `${f.county} County` : '', f.stateName].filter(Boolean).join(', ');
    const meta = [esc(`Parcel ${f.pid || NA}`), esc(where || NA), f.acreage.text ? `<span class="c-acres">${esc(f.acreage.text)}</span>` : ''].filter(Boolean).join(' <span class="sep">·</span> ');
    // The city line only when it names a city: "MT" or "MT 59101" alone repeats the state above.
    const city = f.place && !/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(f.place) ? f.place : '';
    const sub = [city, refName ? `Reference: ${refName}` : ''].filter(Boolean).map(esc).join(' <span class="sep">·</span> ');
    const top = f.findings.slice(0, PAGE1_FINDINGS);
    const list = top.length ? findingList(top) : `<p class="muted">Key findings not available.</p>`;
    return `<section class="page p1"><div class="page-body">
${summaryHeader(f.brand)}
<div class="c-title"><h1>${esc(f.address || 'No situs address')}</h1><p class="c-meta">${meta}</p>${sub ? `<p class="c-sub">${sub}</p>` : ''}${f.acreage.note ? `<p class="c-sub acreage-note">${esc(f.acreage.note)}</p>` : ''}</div>
${parcelMap(data.parcel || {}, data.buildableArea)}
${tiles(data, f, score)}
${sec('Key findings', list, 'c-findings')}
<p class="disclaimer">Screening information from public records. Verify material findings with the responsible agency, utility or licensed professional before relying on them. Details, sources and next steps are on pages ${PAGE_NO.details}–${f.pages}.</p>
</div>${footer(1, f.pages, f.brand)}</section>`;
  }

  function scoreBlock(score) {
    const drivers = score.drivers.length
      ? `<ul class="c-list drivers">${score.drivers.map(d => (d.missing ? `<li class="missing">${dot('verify')}<p>${esc(d.text)}</p></li>` : `<li class="${d.good ? 'good' : 'risk'}">${dot(d.good ? 'good' : 'risk')}<p>${esc(d.text)}</p></li>`)).join('')}</ul>`
      : `<p class="muted">Score drivers not available.</p>`;
    const head = score.value ? `<p class="c-lead"><strong>${esc(score.value)} of 10</strong> · ${esc(score.rating || NA)}${score.incomplete ? ` · <span class="c-flag">${esc(score.incomplete)}</span>` : ''}</p>` : `<p class="c-lead">${esc(score.rating || 'Score not available')}</p>`;
    return `${head}${score.why ? `<p>${esc(sentence(score.why))}</p>` : ''}<p class="c-cap">What moved the score most</p>${drivers}`;
  }

  function buildableBlock(b) {
    const x = buildableParts(b);
    if (!x.measured) return `<div class="buildable"><p class="c-lead"><strong>Not measured</strong></p><p class="b-list">${esc(x.why)}</p></div>`;
    return `<div class="buildable"><div class="b-row"><p class="b-num">${esc(x.head)}</p><div class="b-bar"><span class="k" style="width:${x.keep}%"></span><span class="c" style="width:${100 - x.keep}%"></span></div><span class="b-pct">${esc(x.keep)}%</span></div>
<p class="b-list">${x.list}</p>${x.maybe.map(m => `<p class="b-maybe">${m}</p>`).join('')}<p class="b-note">${x.note}</p></div>`;
  }

  function page2(data, f, score, S) {
    // Findings past page 1's five are listed here, so every finding prints somewhere.
    const more = f.findings.slice(PAGE1_FINDINGS);
    return `<section class="page p2"><div class="page-body">${pageHead('Site details', f)}
${more.length ? sec('More findings', findingList(more), 'c-findings') : ''}
${sec('About the score', scoreBlock(score))}
${sec('Buildable area · screening estimate', buildableBlock(data.buildableArea))}
${sec('Site conditions', siteCards(data, f, S))}
</div>${footer(2, f.pages, f.brand)}</section>`;
  }

  function page3(data, f, S) {
    const z = f.zdp, acres = f.acreage.official, density = String(z.density || '');
    const densityWarning = Number.isFinite(acres) && /10 acres?/i.test(density) && acres < 10
      ? `<p class="warn-note">${dot('verify')}<span><strong>County verification recommended.</strong> Parcel area is ${esc(f.acreage.officialText)}, while the screening references ${esc(density)}. Confirm legal lot status and density exceptions with the county.</span></p>` : '';
    return `<section class="page p3"><div class="page-body">${pageHead('Zoning & records', f)}
${sec('Zoning', `${zoningBlock(f, S)}${densityWarning}`)}
${sec('Overlays', overlayBlock(f, S))}
${sec('Assessor record', assessorBlock(f, S, data))}
${listingBlock(data)}
</div>${footer(3, f.pages, f.brand)}</section>`;
  }

  function page4(data, f, S, notes) {
    const c = f.cost;
    const intro = c ? `<p class="c-intro">The total is the sum of ${c.lines.length} lines: ${esc(c.lines.map(l => String(l.label).replace(/\s*\(.*\)$/, '').toLowerCase()).join(', '))}. ${c.local ? 'Local prices where sourced.' : 'Generic regional ranges.'}${c.missingNote ? ` ${esc(c.missingNote)}` : ''}</p>` : '';
    return `<section class="page p4"><div class="page-body">${pageHead('Costs & next steps', f)}
${sec('Site development cost', `${intro}${costBlock(f, S, notes)}`)}
${sec('Before you buy', checklist(data, f))}
</div>${footer(4, f.pages, f.brand)}</section>`;
  }

  function assumptionsPage(f, notes) {
    return `<section class="page p5"><div class="page-body">${pageHead('Cost assumptions', f)}
${sec('How each cost line was estimated', `<p class="muted">The formula, inputs and assumptions behind each line of the cost table on page ${PAGE_NO.costs}. Bracketed numbers refer to the sources on page ${f.pages}. Screening estimate, not a quote.</p><ol class="notes">${notes.join('')}</ol>`)}
</div>${footer(PAGE_NO.assumptions, f.pages, f.brand)}</section>`;
  }

  function sourcesPage(f, S) {
    const sources = sourceItems(S);
    return `<section class="page p${f.pages}"><div class="page-body">${pageHead('Sources', f)}
${sec('Sources', `<p class="muted src-note">Map and record layers were read when this report was generated (${esc(today())}); cost sources show their effective date.</p>${sources ? `<ol class="sources">${sources}</ol>` : '<p class="muted">No sources recorded.</p>'}`, 'small')}
${sec('About this report', `${f.coverage ? `<p class="coverage cov-${esc(f.coverage.tier)}"><b>${esc(f.coverage.label)}.</b> ${esc(f.coverage.summary)}</p>` : ''}<p class="limits"><strong>Preliminary screening only.</strong> ${LIMITS}</p>`)}
</div>${footer(f.pages, f.pages, f.brand)}</section>`;
  }

  // ---- Document

  // Tokens (text colors pass WCAG AA on white and on --tint: ink 12.6:1, ink-2 6.2:1,
  // ink-3 4.9:1, accent 6.5:1, risk 5.5:1, caution 5.6:1). Status colors are used for small dots,
  // left ticks and tag text only, never as large fills.
  const CSS = `
@page{size:letter;margin:0}
:root{--ink:#2f3437;--ink-2:#5c6266;--ink-3:#6b7176;--rule:#e4e6e3;--rule-2:#d5d8d4;--tint:#f6f6f3;--accent:#466552;--risk:#a4513b;--caution:#7f6420;--good:#466552;--risk-dot:#b5644c;--caution-dot:#c0943a;--good-dot:#6f9a7e;--na-dot:#a7aca8;--fs-title:21pt;--fs-h2:12.5pt;--fs-body:10.5pt;--fs-small:9.5pt;--fs-cap:8.5pt;--gap:20px}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%;text-size-adjust:100%}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:#eceeeb;color:var(--ink);font:400 var(--fs-body)/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}
.toolbar{position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid var(--rule);padding:10px 24px;text-align:right}.toolbar button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 15px;font-weight:600;cursor:pointer}
.page{width:8.5in;height:11in;margin:18px auto;background:#fff;padding:.55in .65in .4in;display:flex;flex-direction:column;box-shadow:0 6px 24px #0001;break-after:page;page-break-after:always;overflow:hidden}
.page:last-child{break-after:auto;page-break-after:auto}
.page-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:var(--gap);font-size:var(--fs-body)}
.page.grow{height:auto;min-height:11in;overflow:visible}.page.grow .page-body{overflow:visible}
@media screen{.page{height:auto;min-height:11in;overflow:visible}.page-body{flex:1 0 auto;overflow:visible}}
.page.fit-measure{height:11in!important;min-height:0!important;overflow:hidden!important}.page.fit-measure .page-body{flex:1 1 auto!important;min-height:0!important;overflow:hidden!important}
h1,h2,h3,p{margin:0}
strong,b{font-weight:600}
.muted{color:var(--ink-2);font-size:var(--fs-small)}
sup.ref{font-size:6.5pt;color:var(--ink-3);margin-left:2px;font-weight:400}
.block{break-inside:avoid}
.c-sec>h2{font-size:var(--fs-h2);font-weight:600;color:var(--ink);line-height:1.3;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
.eyebrow{font-size:var(--fs-cap);font-weight:400;color:var(--ink-2);letter-spacing:.01em}
.dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--na-dot);vertical-align:1px}
.dot.risk,.dot.poor{background:var(--risk-dot)}.dot.verify,.dot.fair{background:var(--caution-dot)}.dot.good{background:var(--good-dot)}
/* Header and footer */
.c-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
.c-head .logo{height:22px;opacity:.9}
.c-head .agent{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
.c-head .agent-logo{max-height:30px;max-width:1.5in;object-fit:contain;flex:none}.agent-text{min-width:0}
.prepared{font-size:var(--fs-small);color:var(--ink);overflow-wrap:anywhere}
.agent-contact{font-size:var(--fs-cap);color:var(--ink-2);margin-top:1px;overflow-wrap:anywhere}
.agent-contact .ct{display:inline-block;max-width:100%}
.c-head-right{flex:none;display:flex;flex-direction:column;align-items:flex-end;font-size:var(--fs-cap);color:var(--ink-2);line-height:1.4}.c-head-right span:first-child{color:var(--ink)}
.powered{color:var(--ink-3)}
.mini-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
.logo-sm{height:16px;opacity:.9}.agent-logo-sm{max-height:20px;max-width:1.4in;object-fit:contain}.agent-mark{font-size:var(--fs-cap);color:var(--ink-2);max-width:3.6in;overflow-wrap:anywhere}
.mini-title{text-align:right;font-size:var(--fs-cap);color:var(--ink-2);line-height:1.4}.mini-title .eyebrow{font-size:var(--fs-small);color:var(--ink);font-weight:600}
.foot{flex:none;display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--rule);padding-top:8px;margin-top:14px;font-size:7.5pt;line-height:1.4;color:var(--ink-3)}
.foot.branded{align-items:flex-start}.foot-agent{flex:1;min-width:0}.foot-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.foot-right{flex:none;text-align:right;white-space:nowrap}
/* Page 1 */
.c-title h1{font-size:var(--fs-title);font-weight:600;line-height:1.15;letter-spacing:-.005em;color:var(--ink);margin-bottom:4px}
.c-meta{font-size:var(--fs-body);color:var(--ink-2)}.c-sub{font-size:var(--fs-small);color:var(--ink-3);margin-top:1px}.sep{color:var(--rule-2);margin:0 3px}
.acreage-note{color:var(--caution)}
.map{position:relative;margin:0;width:100%;aspect-ratio:800/330;border-radius:6px;overflow:hidden;background:#e9ece8;flex:none}
.map-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.map-svg,.map-deco{position:absolute;inset:0;width:100%;height:100%}
.map-svg polygon{fill:rgba(255,255,255,.06);stroke:#fbf7ec;stroke-width:2.5;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.map-tag{position:absolute;left:70px;top:12px;background:#ffffffeb;border-radius:5px;padding:4px 8px;font-size:7pt;font-weight:400;color:var(--ink)}
.map-tag i{display:inline-block;width:9px;height:7px;border-radius:2px;margin:0 3px 0 6px;vertical-align:0}.map-tag i.k{background:rgba(111,154,126,.75)}.map-tag i.c{background:repeating-linear-gradient(135deg,#b05e46 0 2px,#ecd3ca 2px 4px)}.map-tag i.b{background:repeating-linear-gradient(45deg,#c0943a 0 2px,#f1e3c4 2px 4px)}
.inset{position:absolute;right:10px;top:10px;width:1.45in;height:1.09in;border:2px solid #fff;border-radius:5px;overflow:hidden;box-shadow:0 1px 5px #0003;background:#eef0ed}
.inset img{width:100%;height:100%;object-fit:cover;display:block}.inset-dot{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--risk-dot);border:2px solid #fff;box-shadow:0 0 0 1px #0004}
.inset-label{position:absolute;left:4px;bottom:3px;font-size:6.5pt;background:#ffffffe0;border-radius:3px;padding:1px 4px}
.inset.img-error img{display:none}
.map-credit{position:absolute;right:6px;bottom:5px;background:#ffffffe0;border-radius:4px;padding:2px 5px;font-size:6pt;color:#444}
.map-error{display:none;position:absolute;inset:0;place-items:center;color:var(--ink-2)}.map.img-error .map-error{display:grid}.map.img-error .map-img{display:none}
.map-missing{display:grid;place-items:center;color:var(--ink-2);aspect-ratio:3/1;background:var(--tint)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.tile{background:var(--tint);border-radius:8px;padding:12px 16px 13px;min-width:0}
.tile h3{font-size:var(--fs-small);font-weight:400;color:var(--ink-2);margin-bottom:6px}
.t-num{font-size:24pt;font-weight:600;line-height:1.1;color:var(--ink);letter-spacing:-.01em}.t-num small{font-size:var(--fs-body);font-weight:400;color:var(--ink-2);margin-left:2px;letter-spacing:0}
.t-num.t-range{font-size:15.5pt;line-height:1.35;white-space:nowrap}.t-num.t-na{font-size:15pt;color:var(--ink-2)}
.t-label{display:flex;align-items:center;gap:7px;font-size:var(--fs-body);color:var(--ink);margin-top:4px}
.t-flag{font-size:var(--fs-cap);color:var(--caution);margin-top:3px}
.t-why{font-size:var(--fs-cap);line-height:1.45;color:var(--ink-2);margin-top:6px}
.kf,.c-list{list-style:none;margin:0;padding:0}
.kf li,.c-list li{display:flex;gap:10px;align-items:baseline;padding:4px 0}.kf li+li{border-top:1px solid var(--rule)}
.kf .dot,.c-list .dot{transform:translateY(-1px)}
.kf strong{font-weight:600;color:var(--ink)}.kf-d{color:var(--ink-2);font-size:var(--fs-small)}
.disclaimer{font-size:var(--fs-cap);color:var(--ink-3);margin-top:auto}
/* Page 2 */
.c-lead{font-size:var(--fs-body);color:var(--ink);margin-bottom:2px}.c-lead strong{font-size:13pt}
.c-flag{color:var(--caution)}
.c-cap{font-size:var(--fs-cap);color:var(--ink-2);margin:8px 0 0}
.c-list li{padding:3px 0}.drivers{display:grid;grid-template-columns:1fr 1fr;column-gap:24px}
.coverage{font-size:var(--fs-small);color:var(--ink-2);margin-bottom:8px}.coverage b{font-weight:600;color:var(--ink)}
.buildable .b-row{display:flex;align-items:center;gap:14px;margin-bottom:6px}.b-num{font-size:var(--fs-body);font-weight:600;white-space:nowrap}
.b-bar{flex:1;display:flex;height:6px;border-radius:999px;overflow:hidden;background:var(--rule)}.b-bar .k{background:var(--good-dot)}.b-bar .c{background:repeating-linear-gradient(135deg,#c98a74 0 3px,#efd9d0 3px 6px)}
.b-pct{font-size:var(--fs-small);color:var(--ink-2)}
.b-list,.b-maybe{font-size:var(--fs-small);color:var(--ink-2);line-height:1.5}.b-list b{font-weight:600;color:var(--ink)}.b-maybe{margin-top:3px}.b-maybe b{font-weight:600;color:var(--caution)}
.b-note{font-size:var(--fs-cap);color:var(--ink-3);margin-top:4px}
.sites{display:block}
.site{display:grid;grid-template-columns:1.75in 1fr;column-gap:18px;padding:7px 0;border-top:1px solid var(--rule);break-inside:avoid}.site:first-child{border-top:0;padding-top:0}
.site-top{grid-column:1;grid-row:1 / span 3;display:flex;flex-direction:column;gap:2px}
.site h3{font-size:var(--fs-body);font-weight:600;color:var(--ink)}
.site p{grid-column:2;font-size:var(--fs-small);color:var(--ink);line-height:1.5}.site p+p{color:var(--ink-2);margin-top:1px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-cap);color:var(--ink-2);font-weight:400;white-space:nowrap}
.chip:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--na-dot)}
.chip.good:before{background:var(--good-dot)}.chip.verify:before{background:var(--caution-dot)}.chip.risk:before{background:var(--risk-dot)}.chip.risk{color:var(--risk)}
/* Page 3 */
.zone-head{display:flex;gap:16px;align-items:baseline;margin-bottom:8px}
.zone-code{font-size:15pt;font-weight:600;color:var(--accent);min-width:0}
.zone-head strong{font-size:var(--fs-body);font-weight:600}.zone-head span{display:block;font-size:var(--fs-small);color:var(--ink-2)}
.plain{font-size:var(--fs-body);margin-bottom:10px}
table{border-collapse:collapse;width:100%}
.uses td{padding:4px 8px 4px 0;border-bottom:1px solid var(--rule);font-size:var(--fs-small)}.uses td.st{color:var(--ink-2);font-size:var(--fs-cap);padding-right:18px;white-space:nowrap}
.uses i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px;background:var(--na-dot)}.uses i.permitted{background:var(--good-dot)}.uses i.limited,.uses i.conditional{background:var(--caution-dot)}.uses i.not_permitted{background:var(--risk-dot)}
.overlays{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
.overlays li{font-size:var(--fs-small);padding:6px 0;border-bottom:1px solid var(--rule);break-inside:avoid}.overlays strong{font-weight:600}.overlays em{font-style:normal;color:var(--caution)}.overlays span{display:block;font-size:var(--fs-cap);color:var(--ink-2)}
.assessor{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:6px}
.assessor>div{display:grid;grid-template-columns:1.35in 1fr;column-gap:12px;padding:6px 0;border-bottom:1px solid var(--rule)}
.assessor span{grid-column:1;font-size:var(--fs-small);color:var(--ink-2)}.assessor strong{grid-column:2;font-size:var(--fs-body);font-weight:600}.assessor small{grid-column:2;font-size:var(--fs-cap);color:var(--ink-3)}
.listing strong{display:block;font-weight:600}.listing span{display:block;font-size:var(--fs-small);color:var(--ink-2)}
.warn-note{display:flex;gap:10px;align-items:baseline;margin-top:10px;font-size:var(--fs-small);color:var(--ink)}
/* Page 4 */
.c-intro{font-size:var(--fs-small);color:var(--ink-2);margin-bottom:10px}
.costs th{font-size:var(--fs-cap);font-weight:400;color:var(--ink-2);text-align:left;border-bottom:1px solid var(--rule-2);padding:4px 8px 6px 0}
.costs td{padding:7px 8px 7px 0;border-bottom:1px solid var(--rule);font-size:var(--fs-body);vertical-align:top}
.costs td strong{font-weight:400}
.costs .amt{text-align:right;white-space:nowrap;padding-right:0}.costs td.amt{font-weight:600;color:var(--ink)}
.costs tfoot td{border-top:1px solid var(--rule-2);border-bottom:0;font-weight:600;padding-top:9px}.costs tfoot td.amt{font-size:11.5pt}
.costs tr{break-inside:avoid}.costs tr.alt td{font-size:var(--fs-cap);color:var(--ink-2);padding-top:0}
.listing-note{font-size:var(--fs-small);color:var(--caution);margin:8px 0 0}
.costs+p,.costs~p.muted{margin-top:10px}
.tag{font-size:var(--fs-cap);color:var(--ink-2);white-space:nowrap}.tag.estimate{color:var(--caution)}.tag.fee,.tag.local{color:var(--accent)}
.pointer{font-size:var(--fs-small);color:var(--accent);margin-top:6px}
.checklist{margin:0;padding:0;list-style:none;counter-reset:c}
.checklist li{counter-increment:c;display:flex;gap:12px;font-size:var(--fs-small);line-height:1.5;padding:6px 0;border-top:1px solid var(--rule);break-inside:avoid}.checklist li:first-child{border-top:0;padding-top:0}
.checklist li:before{content:counter(c);flex:none;width:16px;color:var(--accent);font-weight:600}
.checklist strong{font-weight:600;color:var(--ink)}
/* Page 5 */
.notes{margin:0;padding:0;list-style:none}.notes li{break-inside:avoid;border-bottom:1px solid var(--rule);padding:9px 0}.notes li:last-child{border-bottom:0}
.notes li strong{font-size:var(--fs-body);font-weight:600}.notes .amt-note{float:right;font-weight:600}.notes p{font-size:var(--fs-small);line-height:1.5;color:var(--ink-2);margin-top:3px}
.c-sec .muted+.notes{margin-top:8px}
.small .sources{margin:0;padding-left:18px;font-size:var(--fs-cap);line-height:1.45;color:var(--ink-2);columns:2;column-gap:24px}.src-note{font-size:var(--fs-cap);margin-bottom:6px}
.sources li{break-inside:avoid;margin-bottom:2px}.sources .url{color:var(--ink-3);white-space:nowrap}
.limits{font-size:var(--fs-small);color:var(--ink-2)}.limits strong{color:var(--ink-2)}
/* Fit steps: tighten spacing first, then text, before a page is allowed to grow. */
.d1 .page-body{--gap:16px}.d1 .site{padding:6px 0}.d1 .checklist li{padding:4px 0}.d1 .notes li{padding:7px 0}.d1 .c-sec>h2{margin-bottom:8px}
.d2 .page-body{--gap:13px;--fs-body:10pt;--fs-small:9pt;--fs-cap:8pt}.d2 .site{padding:5px 0}.d2 .uses td{padding:3px 8px 3px 0}.d2 .costs td{padding:5px 8px 5px 0}
.d3 .page-body{--gap:11px;--fs-body:9.5pt;--fs-small:8.6pt;--fs-cap:7.6pt}.d3 .site{padding:4px 0}.d3 .kf li{padding:2px 0}.d3 .site p,.d3 .notes p{line-height:1.42}.d3 .c-sec>h2{margin-bottom:6px;padding-bottom:4px}
.p1 .page-body{--gap:16px}.p1 .kf li{padding:3.5px 0}.p1.d1 .page-body{--gap:14px}.p1.d1 .tile{padding:10px 14px}.p1.d1 .kf li{padding:3px 0}
.p1.d2 .c-title h1{font-size:18pt}.p1.d2 .t-num{font-size:21pt}.p1.d2 .t-num.t-range{font-size:14pt}.p1.d2 .c-head .agent-logo{max-height:26px}
.p1.d3 .c-title h1{font-size:16pt}.p1.d3 .tile{padding:10px 12px}.p1.d3 .kf li{padding:3px 0}
@media print{body{background:#fff;-webkit-text-size-adjust:100%;text-size-adjust:100%}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}.toolbar{display:none}.page{margin:0;box-shadow:none;zoom:1!important}}
`;
  // Pages have a fixed Letter height; a page whose content would overflow is tightened in steps
  // (d1-d3), and if it still overflows it grows instead of clipping (no overlap, no cut-off).
  // The fit is measured in the fixed Letter box (.fit-measure, added only while measuring). On
  // screen the pages are never clipped (@media screen: height auto, min-height Letter), so content
  // that gets taller after the fit (late fonts, images, iOS text inflation) pushes the page longer
  // instead of being cut off; print keeps the fixed Letter pages and the fit steps.
  // text-size-adjust:100% stops iOS Safari's text autosizing, which inflated single paragraphs on
  // the zoomed Letter pages (owner iPhone screenshot 2026-11-16: the buildable-area line at ~3x).
  // Page 1 has its own steps (padding, title and score sizes; never the map, whose overlay is drawn
  // for its fixed aspect ratio), so a branded header, a reference and a long brokerage still fit.
  const FIT = `(function(){function fit(){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('d1','d2','d3','grow');var b=p.querySelector('.page-body');if(!b)return;p.classList.add('fit-measure');var over=function(){return b.scrollHeight>b.clientHeight+1};var steps=['d1','d2','d3'];for(var i=0;i<steps.length&&over();i++)p.classList.add(steps[i]);if(over())p.classList.add('grow');p.classList.remove('fit-measure')})}window.__acresxFit=fit;window.addEventListener('load',fit);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);window.addEventListener('beforeprint',fit);if(document.readyState!=='loading')fit();else document.addEventListener('DOMContentLoaded',fit)})();`;

  // The report is built in two steps so a saved account report or a shared link (/r/<token>)
  // renders with this same code from JSON, never from stored HTML:
  //   buildModel(name, data) -> { name, data, f, score } from the live page (window.AcresX* modules)
  //   snapshot(model)        -> the JSON kept for a saved report: the computed facts plus the few
  //                             `data` fields the page renderers read (snapshotData). A renderer
  //                             that starts reading another `data` field adds it there.
  //   renderHtml(model, { brand, date }) -> the report document
  function buildModel(name, data = reportState() || {}) {
    const f = gatherFacts(data);
    const score = scoreInfo(data, f);
    return { name, data, f, score };
  }

  const geometryOnly = g => (g && typeof g === 'object' && g.type && g.coordinates ? { type: g.type, coordinates: g.coordinates } : null);
  const pick = (o, keys) => { const out = {}; if (o && typeof o === 'object') for (const k of keys) if (o[k] !== undefined) out[k] = o[k]; return out; };
  function snapshotData(data) {
    const ex = data.existingWell || {};
    const exMatch = m => (m ? { evidence: pick(m.evidence, ['insideParcel', 'distanceToParcelFt']) } : undefined);
    const listing = data.resoListings || data.listingContext || {};
    const rec = listing.best || listing.match || null;
    const b = data.buildableArea;
    return {
      parcel: data.parcel?.geometry ? { type: 'Feature', properties: {}, geometry: geometryOnly(data.parcel.geometry) } : null,
      buildableArea: b && typeof b === 'object' ? { ...b, geometry: geometryOnly(b.geometry), removedGeometry: geometryOnly(b.removedGeometry), bufferGeometry: geometryOnly(b.bufferGeometry) } : null,
      existingWell: { available: ex.available, confidence: ex.confidence, match: exMatch(ex.match), best: exMatch(ex.best) },
      publicUtilities: data.publicUtilities || null,
      flood: pick(data.flood, ['available', 'sharePct', 'share', 'source']),
      wetlands: pick(data.wetlands, ['available', 'types']),
      land: { landCover: data.land?.landCover || null },
      resoListings: rec ? { best: pick(rec, ['status', 'standardStatus', 'StandardStatus', 'listPrice', 'daysOnMarket', 'listingId']) } : null,
      // Page 2 tax line (taxCell, rendered with window.AcresXPropertyTax from public/property-tax.js).
      propertyTax: data.propertyTax || null
    };
  }
  function snapshot(model) {
    const { brand, pages, ...f } = model.f || {};
    return JSON.parse(JSON.stringify({ v: 1, name: model.name, generatedAt: model.generatedAt || new Date().toISOString(), f, score: model.score, data: snapshotData(model.data || {}) }));
  }

  function renderHtml(model, { brand, date } = {}) {
    const data = model.data || {};
    const f = { ...model.f };
    const hasNotes = Boolean(f.cost?.lines?.some(l => l.basis));
    // Five pages, six with the cost-assumptions page (sources are always last). Every footer says
    // "of N".
    f.pages = hasNotes ? 6 : 5;
    f.appendixPage = hasNotes ? PAGE_NO.assumptions : 0;
    f.brand = brand === undefined ? brandParts() : brand;
    const score = model.score;
    renderDate = date || null;
    try {
      const S = sourceList();
      const notes = [];
      // In page order: sources are numbered as pages 2-4 cite them; page 4 fills `notes`.
      const p1 = page1(data, f, score, model.name);
      const p2 = page2(data, f, score, S);
      const p3 = page3(data, f, S);
      const p4 = page4(data, f, S, notes);
      const pages = [p1, p2, p3, p4, notes.length ? assumptionsPage(f, notes) : '', sourcesPage(f, S)].filter(Boolean);
      const docTitle = `${f.address || `Parcel ${f.pid}`} — AcresX Property Report`;
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title><style>${CSS}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
${pages.join('\n')}
<script>${FIT}</script></body></html>`;
    } finally { renderDate = null; }
  }

  // ---- In-page report view (owner bug 2026-11-15: "I can't save/print reports on mobile")
  //
  // The report used to go window.prompt() -> window.open('', '_blank') -> document.write(). In
  // iPhone in-app browsers (WKWebView without the JavaScript-panel and new-window delegates)
  // prompt() returns null at once and window.open() returns null, so a tap on Generate report did
  // nothing at all, and the "allow pop-ups" alert() was suppressed too. Now the report opens in a
  // full-screen view on this page (no popup, no prompt):
  // - Generate report opens the view at once, in the tap, with an inline reference field
  //   (prefilled with the address) and Create report / Cancel. Create builds the report exactly as
  //   before (renderHtml) and saves it to the account when signed in (accounts.js reportGenerated).
  // - The pages render into a shadow root, so the report CSS and the app CSS cannot touch each
  //   other; the markup is renderHtml's body without its toolbar and inline script.
  // - "Download PDF" (primary, first) saves a real PDF file built in the browser
  //   (public/report-pdf.js, owner bug 2026-11-16: on a real iPhone window.print() did nothing).
  //   The PDF is generated in the background as soon as the report is shown; the tap then hands
  //   the ready file to the share sheet (phones) or downloads it, with nothing awaited first.
  // - "Print" (secondary, desktop only: phones use Download PDF, so nothing there depends on
  //   window.print) calls window.print() straight from the tap. While the view is open, @media
  //   print hides everything on the page but the report, and @page sets US Letter with no margin,
  //   so the print is the same Letter pages as before. The page-fit step (FIT above) runs here on
  //   open, when images load and before printing.
  // - "Share" shows only when the view was given a share link and the browser has navigator.share.
  // - While the view is open the page title is the report's title (the saved PDF's file name);
  //   beta-labels.js does not overwrite it then (html.arv-open), and Close restores it.
  // - Phones see the Letter pages scaled to the screen width (CSS zoom, reset for printing).
  // - iPhone/iPad get a hint: Download PDF, then Save to Files in the share sheet.
  // - iPhone/iPad Home Screen app (standalone mode, public/deep-link.js needsBrowser): it cannot
  //   save files, so "Open in Safari to save PDF" (a target=_blank link to the full https deep
  //   link that reopens this report) is the primary action, with "Copy link" and a short
  //   explanation; Download PDF stays, secondary. Owner finding 2026-11-16.
  // Saved account reports (accounts.js viewReport) open in the same view; /r/<token> pages keep
  // their own page (shared-report.js).
  const VIEW_ID = 'acresxReportView';
  const viewCss = css => css.replace('@page{size:letter;margin:0}\n', '').replace(':root{', ':host{display:block;-webkit-text-size-adjust:100%;text-size-adjust:100%;').replace('\nbody{', '\n.rv-doc{').replace('@media print{body{', '@media print{.rv-doc{') +
    '.rv-doc{padding:1px 0 24px;min-height:100%;-webkit-text-size-adjust:100%;text-size-adjust:100%}@media print{.rv-doc{padding:0}.page{zoom:1!important}}\n';
  const VIEW_CSS = viewCss(CSS);
  const PAGE_CSS = '@page{size:letter;margin:0}';
  const UI_CSS = `
#generateReportBtn{-webkit-tap-highlight-color:transparent}
#${VIEW_ID}{position:fixed;inset:0;z-index:99995;display:none;flex-direction:column;background:rgba(13,30,20,.45);font-family:Arial,Helvetica,sans-serif;color:#17231c;-webkit-text-size-adjust:100%;text-size-adjust:100%}
#${VIEW_ID}.open{display:flex}#${VIEW_ID}.showing{background:#e6ece8}
html.arv-open,html.arv-open body{overflow:hidden}
#${VIEW_ID} .arv-bar{flex:none;background:#174f34;color:#fff;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));box-shadow:0 2px 12px #0003}
#${VIEW_ID} .arv-ask,#${VIEW_ID} .arv-actions{max-width:8.5in;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
#${VIEW_ID} .arv-ask label{flex:1 1 100%;font-size:13px;font-weight:800}
#${VIEW_ID} .arv-ask input{flex:1 1 220px;min-width:0;min-height:44px;border:0;border-radius:9px;padding:0 12px;font:16px Arial,Helvetica,sans-serif;color:#17231c;background:#fff}
#${VIEW_ID} .arv-sub{flex:1 1 100%;margin:0;font-size:12px;opacity:.85}
#${VIEW_ID} .arv-title{flex:1 1 160px;min-width:0;font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${VIEW_ID} button{min-height:44px;border:1px solid #ffffff80;border-radius:9px;padding:0 14px;background:transparent;color:#fff;font:800 14px Arial,Helvetica,sans-serif;cursor:pointer}
#${VIEW_ID} button.arv-primary{background:#fff;color:#174f34;border-color:#fff}
#${VIEW_ID} button:disabled{opacity:.7;cursor:progress}
#${VIEW_ID} a.arv-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;border:1px solid #fff;border-radius:9px;padding:0 14px;background:#fff;color:#174f34;font:800 14px Arial,Helvetica,sans-serif;text-decoration:none;-webkit-tap-highlight-color:transparent}
#${VIEW_ID} .arv-hint{flex:1 1 100%;margin:0;font-size:12px;line-height:1.4;opacity:.9}
#${VIEW_ID} [hidden]{display:none!important}
#${VIEW_ID} .arv-status{margin:24px auto;max-width:480px;background:#fff;border-radius:12px;padding:18px 20px;font-size:15px}
#${VIEW_ID} .arv-pages{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
@media(max-width:600px){#${VIEW_ID} .arv-bar{padding-left:12px;padding-right:12px}#${VIEW_ID} .arv-actions a.arv-link{flex:1 1 100%}#${VIEW_ID} .arv-actions button,#${VIEW_ID} .arv-ask button{flex:1 1 auto;padding:0 10px}#${VIEW_ID} .arv-ask input{flex-basis:100%}#${VIEW_ID} .arv-title{flex-basis:100%}}
@media print{
html.arv-open body>*:not(#${VIEW_ID}){display:none!important}
html.arv-open,html.arv-open body{overflow:visible!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;background:#fff!important;display:block!important}
#${VIEW_ID}.open{position:static!important;display:block!important;background:#fff!important}
#${VIEW_ID} .arv-bar,#${VIEW_ID} .arv-status{display:none!important}
#${VIEW_ID} .arv-pages{overflow:visible!important;height:auto!important}
}`;
  const unesc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  // renderHtml's document -> what the view shows: the report body without the toolbar and script.
  function viewMarkup(html) {
    const body = String(html).split('<body>')[1] || '';
    const pages = body.split('<script>')[0].replace(/^<div class="toolbar">[\s\S]*?<\/div>\n?/, '');
    return `<style>${VIEW_CSS}</style><div class="rv-doc">${pages}</div>`;
  }
  const isIOS = () => { try { const n = window.navigator || {}; return /iP(hone|ad|od)/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); } catch { return false; } };
  const canPrint = () => typeof window.print === 'function';
  const canShare = () => { try { return typeof window.navigator?.share === 'function'; } catch { return false; } };
  const isPhone = () => { try { return isIOS() || /Android/i.test(window.navigator?.userAgent || ''); } catch { return false; } };
  const pdfTools = () => window.AcresXReportPdf || null;
  const deepLink = () => window.AcresXDeepLink || null;
  const needsBrowser = () => { try { return Boolean(deepLink()?.needsBrowser?.()); } catch { return false; } };
  const STANDALONE_TEXT = "Home Screen apps on iPhone can't save files. Open in Safari reopens this report there; tap Download PDF in Safari. Report branding saved in this Home Screen app may need re-entering in Safari";
  function standaloneText(hasLink) {
    let signedIn = false;
    try { signedIn = Boolean(window.AcresXAccounts?.state?.signedIn); } catch {}
    const branding = signedIn ? ' (sign in there too and it follows your account).' : '.';
    return hasLink ? `${STANDALONE_TEXT}${branding}` : "Home Screen apps on iPhone can't save files. Open AcresX in Safari to save this report as a PDF.";
  }

  function node(tag, props = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'id' || k === 'hidden' || k === 'type' || k === 'value') n[k] = v;
      else n.setAttribute(k, v);
    }
    kids.forEach(k => n.appendChild(k));
    return n;
  }

  // Added when the button is bound (so the tap-highlight rule applies to the first tap) and
  // again, if needed, when the view is first built.
  function addViewStyles() {
    if (!$('acresxReportViewStyles')) document.head.appendChild(node('style', { id: 'acresxReportViewStyles', text: UI_CSS }));
  }
  let view = null;
  let viewSeq = 0; // bumped on every open/close; a slow saved-report load checks it (showLoading)
  function ensureView() {
    if (view) return view;
    addViewStyles();
    const v = {};
    v.name = node('input', { id: 'acresxReportName', type: 'text', maxlength: '120', autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'acresxReportNameHelp' });
    v.create = node('button', { id: 'acresxReportCreate', type: 'button', class: 'arv-primary', text: 'Create report' });
    v.cancel = node('button', { id: 'acresxReportCancel', type: 'button', text: 'Cancel' });
    v.ask = node('div', { id: 'acresxReportAsk', class: 'arv-ask' }, [
      node('label', { for: 'acresxReportName', text: 'Reference on the report (optional)' }), v.name, v.create, v.cancel,
      node('p', { id: 'acresxReportNameHelp', class: 'arv-sub', text: 'Property name, client name or reference ID. It prints on page 1.' })
    ]);
    v.title = node('span', { id: 'acresxReportTitle', class: 'arv-title' });
    v.pdf = node('button', { id: 'acresxReportPdf', type: 'button', class: 'arv-primary', text: 'Preparing PDF…' });
    v.print = node('button', { id: 'acresxReportPrint', type: 'button', text: 'Print' });
    v.share = node('button', { id: 'acresxReportShare', type: 'button', text: 'Share', hidden: true });
    v.close = node('button', { id: 'acresxReportClose', type: 'button', text: 'Close' });
    v.safari = node('a', { id: 'acresxReportSafari', class: 'arv-link', href: '/', target: '_blank', rel: 'noopener', hidden: true, text: 'Open in Safari to save PDF' });
    v.copy = node('button', { id: 'acresxReportCopy', type: 'button', text: 'Copy link', hidden: true });
    v.hint = node('p', { id: 'acresxReportHint', class: 'arv-hint', hidden: true });
    v.pdfNote = node('p', { id: 'acresxReportPdfNote', class: 'arv-hint arv-pdf-note', hidden: true });
    v.copyNote = node('p', { id: 'acresxReportCopyNote', class: 'arv-hint', role: 'status', hidden: true });
    v.actions = node('div', { id: 'acresxReportActions', class: 'arv-actions', hidden: true }, [v.title, v.safari, v.copy, v.pdf, v.print, v.share, v.close, v.pdfNote, v.copyNote, v.hint]);
    v.status = node('div', { id: 'acresxReportStatus', class: 'arv-status', role: 'status', hidden: true });
    v.pages = node('div', { id: 'acresxReportPages', class: 'arv-pages' });
    v.root = node('div', { id: VIEW_ID, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Property report' }, [node('div', { class: 'arv-bar' }, [v.ask, v.actions]), v.status, v.pages]);
    document.body.appendChild(v.root);
    v.shadow = typeof v.pages.attachShadow === 'function' ? v.pages.attachShadow({ mode: 'open' }) : v.pages;
    v.pdfCtl = pdfTools()?.controller?.({ button: v.pdf, note: v.pdfNote }) || null;

    v.cancel.addEventListener('click', () => closeReport());
    v.close.addEventListener('click', () => closeReport());
    v.create.addEventListener('click', () => { const cb = v.onCreate; v.onCreate = null; if (cb) cb(String(v.name.value || '').trim()); });
    v.name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault?.(); v.create.click?.(); } });
    // Straight from the tap: the PDF already exists, so share/download runs with nothing awaited.
    v.pdf.addEventListener('click', () => { v.pdfCtl?.tap(); });
    // Straight from the tap: no await, no timer between the tap and window.print().
    v.print.addEventListener('click', () => {
      if (v.docTitle) document.title = v.docTitle; // the saved PDF's file name
      fitPages();
      try { window.print(); } catch { showHint(true); }
    });
    v.copy.addEventListener('click', () => copyLink(v));
    v.share.addEventListener('click', () => {
      try { const p = window.navigator.share({ title: v.docTitle || 'AcresX property report', url: v.shareUrl }); p?.catch?.(() => {}); } catch {}
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && v.root.classList.contains('open')) closeReport(); });
    window.addEventListener?.('beforeprint', () => { if (!v.root.classList.contains('showing')) return; if (v.docTitle) document.title = v.docTitle; fitPages(); });
    window.addEventListener?.('resize', () => { if (v.root.classList.contains('showing')) scalePages(); });
    view = v;
    return v;
  }
  function setState(state) {
    const v = ensureView();
    v.ask.hidden = state !== 'ask';
    v.actions.hidden = state !== 'report' && state !== 'message';
    v.pdf.hidden = state !== 'report' || !v.pdfCtl;
    v.print.hidden = state !== 'report' || !canPrint() || isPhone();
    if (v.pdf.hidden) v.pdfNote.hidden = true;
    v.share.hidden = !(state === 'report' && v.shareUrl && canShare());
    // Home Screen app on iPhone: Open in Safari first, Download PDF second.
    const toSafari = state === 'report' && Boolean(v.browserUrl) && needsBrowser();
    v.safari.hidden = !toSafari;
    v.copy.hidden = !toSafari;
    if (toSafari) v.safari.setAttribute('href', v.browserUrl);
    v.pdf.className = toSafari ? '' : 'arv-primary';
    if (!toSafari) v.copyNote.hidden = true;
    v.status.hidden = state !== 'loading' && state !== 'message';
    v.root.classList.add('open');
    v.root.classList.toggle('showing', state === 'report' || state === 'loading');
    document.documentElement?.classList?.add('arv-open');
    return v;
  }
  function showHint(printFailed) {
    const v = ensureView();
    let text = '';
    if (printFailed) text = 'This browser cannot print from here. Use Download PDF to save the report.';
    else if (!v.pdfCtl && !canPrint()) text = 'This browser cannot print or save a PDF from here. Open AcresX in Safari or Chrome to save this report.';
    else if (needsBrowser()) text = standaloneText(!v.safari.hidden);
    else if (isIOS() && v.pdfCtl) text = 'On iPhone or iPad: tap Download PDF, then choose Save to Files (or Mail, Messages) to keep the PDF.';
    v.hint.textContent = text;
    v.hint.hidden = !text;
  }
  // Copy link: the clipboard when it is allowed; otherwise the link is shown to copy by hand.
  function copyLink(v) {
    const url = v.browserUrl;
    if (!url) return;
    const say = text => { v.copyNote.textContent = text; v.copyNote.hidden = false; };
    const manual = () => say(`Copy this link and open it in Safari: ${url}`);
    try {
      const p = window.navigator?.clipboard?.writeText?.(url);
      if (!p) { manual(); return; }
      Promise.resolve(p).then(() => say('Link copied. Paste it into Safari to save the PDF.'), manual);
    } catch { manual(); }
  }
  function clearPages(v) {
    try { v.pdfCtl?.cancel(); } catch {}
    v.docTitle = '';
    v.shadow.innerHTML = '';
    v.pages.scrollTop = 0;
  }
  function pageNodes() { return view ? [...(view.shadow.querySelectorAll?.('.page') || [])] : []; }
  // The report's page-fit step (FIT above), on the pages in the view (fitPages) or on the PDF's
  // offscreen copy of them (report-pdf.js calls fitNodes).
  // Measured at full size in the fixed Letter box (.fit-measure): the phone zoom rounds heights and
  // would tighten pages that fit. On screen the pages are never clipped either way (see FIT).
  function fitPages() { fitNodes(pageNodes()); }
  function fitNodes(nodes) {
    [...(nodes || [])].forEach(p => {
      const zoom = p.style.zoom;
      p.style.zoom = '';
      p.classList.remove('d1', 'd2', 'd3', 'grow');
      const b = p.querySelector('.page-body');
      if (b) {
        p.classList.add('fit-measure');
        const over = () => b.scrollHeight > b.clientHeight + 1;
        for (const step of ['d1', 'd2', 'd3']) { if (!over()) break; p.classList.add(step); }
        if (over()) p.classList.add('grow');
        p.classList.remove('fit-measure');
      }
      p.style.zoom = zoom;
    });
  }
  // Fit again once layout settles: after the scaling, when web fonts and images have loaded.
  let refitQueued = false;
  function refitSoon() {
    if (refitQueued) return;
    refitQueued = true;
    const run = () => { refitQueued = false; fitPages(); };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run); else setTimeout(run, 16);
  }
  // Phones: Letter-width pages scaled to the screen (print resets the zoom, see VIEW_CSS).
  function scalePages() {
    const pageWidth = 8.5 * 96 + 16;
    const width = view?.pages.clientWidth || window.innerWidth || pageWidth;
    const k = Math.min(1, width / pageWidth);
    pageNodes().forEach(p => { p.style.zoom = k < 1 ? String(Math.floor(k * 1000) / 1000) : ''; });
  }

  // Generate report: the view with the reference field. onCreate(name) runs on Create report.
  function askName(suggested, onCreate) {
    const v = setState('ask');
    preloadPdf();
    viewSeq++;
    clearPages(v);
    v.onCreate = onCreate;
    v.name.value = suggested || '';
    v.name.setAttribute('placeholder', suggested || 'e.g. Smith parcel, Client 1042');
    try { v.name.focus(); } catch {}
    return v;
  }
  // A saved report being fetched: the view opens at once (in the tap) and says so. Returns a
  // ticket; openReport(html, { ticket }) shows the report only if the view was not closed since.
  function showLoading(message = 'Loading report…') {
    const v = setState('loading');
    preloadPdf();
    clearPages(v);
    v.status.textContent = message;
    return ++viewSeq;
  }
  function showMessage(message) {
    const v = ensureView();
    v.shareUrl = '';
    setState('message');
    clearPages(v);
    v.title.textContent = '';
    v.hint.hidden = true;
    v.status.textContent = message;
    viewSeq++;
    try { v.close.focus(); } catch {}
  }
  // The PDF libraries load when a report view opens, not with the app (report-pdf.js preload).
  function preloadPdf() { try { pdfTools()?.preload?.(); } catch {} }
  // Shows a renderHtml() document in the view. options.shareUrl: a /r/<token> link for Share.
  // options.browserUrl: the full https deep link that reopens this report (Open in Safari).
  // Anything else is ignored (http is accepted on localhost only, for `wrangler dev`).
  function openReport(html, { shareUrl = '', ticket, browserUrl = '' } = {}) {
    if (ticket !== undefined && ticket !== viewSeq) return false;
    const v = ensureView();
    v.shareUrl = shareUrl;
    v.browserUrl = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(browserUrl || '') ? browserUrl : ''; // http only for local dev
    v.docTitle = unesc((/<title>([\s\S]*?)<\/title>/.exec(String(html)) || [])[1] || 'AcresX Property Report');
    if (v.prevTitle === undefined) v.prevTitle = document.title;
    document.title = v.docTitle; // the saved PDF's file name
    if (!$('acresxReportPageCss')) document.head.appendChild(node('style', { id: 'acresxReportPageCss', text: PAGE_CSS }));
    setState('report');
    v.title.textContent = v.docTitle;
    showHint(false);
    v.shadow.innerHTML = viewMarkup(html);
    v.pages.scrollTop = 0;
    (v.shadow.querySelectorAll?.('img') || []).forEach(img => { img.addEventListener('load', refitSoon); img.addEventListener('error', refitSoon); });
    fitPages();
    scalePages();
    refitSoon();
    try { document.fonts?.ready?.then(refitSoon); } catch {}
    // The PDF starts now, in the background, so it is ready by the time the button is tapped.
    try { v.pdfCtl?.start(html, { title: v.docTitle }); } catch (error) { console.warn('Report PDF not started', error); }
    try { (v.print.hidden ? v.close : v.print).focus(); } catch {} // Download PDF is disabled until ready
    return true;
  }
  // closeReport(ticket) closes only the loading view that ticket belongs to.
  function closeReport(ticket) {
    if (typeof ticket === 'number' && ticket !== viewSeq) return;
    viewSeq++;
    if (!view) return;
    const v = view;
    v.onCreate = null;
    v.root.classList.remove('open', 'showing');
    document.documentElement?.classList?.remove('arv-open');
    clearPages(v);
    $('acresxReportPageCss')?.remove();
    if (v.prevTitle !== undefined) { document.title = v.prevTitle; v.prevTitle = undefined; }
    // beta-labels.js leaves the title alone while the view is open; bring it up to date now.
    try { window.AcresXBetaLabel?.apply?.(); } catch {}
    try { $('generateReportBtn')?.focus(); } catch {}
  }

  // options.save false: not saved to the account (a deep link reopening a report made elsewhere).
  function makeReport(name, { save = true } = {}) {
    const model = buildModel(name);
    model.generatedAt = new Date().toISOString();
    let browserUrl = '';
    try { browserUrl = deepLink()?.reportLink?.(name) || ''; } catch {}
    if (!openReport(renderHtml(model), { browserUrl })) return;
    if (!save) return;
    // Signed in (public/accounts.js): the report is also saved to the account. Signed out: nothing.
    try { window.AcresXAccounts?.reportGenerated?.(model, snapshot); } catch (error) { console.warn('Report not saved to the account', error); }
  }
  // The report for the analyzed property with reference `ref` (or the suggested one), straight to
  // the report view: public/deep-link.js, for report=1 links.
  function createReport(ref, { save = true } = {}) {
    const data = reportState();
    if (!data?.parcel) { showMessage('Analyze a property first, then tap Generate report.'); return false; }
    const id = identity(data);
    const suggested = id.address || (id.pid ? `Parcel ${id.pid}` : 'Property');
    preloadPdf();
    makeReport(String(ref || '').trim() || suggested, { save });
    return true;
  }

  function askAndGenerate() {
    const data = reportState();
    if (!data?.parcel) { showMessage('Analyze a property first, then tap Generate report.'); return; }
    const id = identity(data);
    const suggested = id.address || (id.pid ? `Parcel ${id.pid}` : 'Property');
    askName(suggested, name => makeReport(name || suggested));
  }
  function bind() {
    const old = $('generateReportBtn') || document.querySelector('.top-actions button:nth-child(2)');
    if (!old) return;
    const b = old.cloneNode(true);
    b.id = 'generateReportBtn';
    b.disabled = false;
    old.replaceWith(b);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); askAndGenerate(); });
    try { addViewStyles(); } catch {}
  }
  function bindWhenReady() {
    let tries = 0;
    const attempt = () => { if ($('generateReportBtn') || document.querySelector('.top-actions button:nth-child(2)')) return bind(); if (++tries < 40) setTimeout(attempt, 50); };
    attempt();
  }
  window.AcresXReport = { gatherFacts, costEstimate, costTag, range, titleCase, makeReport, createReport, assessment, buildModel, snapshot, renderHtml, openReport, showLoading, closeReport, viewMarkup, fitNodes };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindWhenReady);
  else bindWhenReady();
})();
