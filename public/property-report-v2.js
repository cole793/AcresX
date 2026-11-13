// Printable property report (owner redesign 2026-11-13: "too crowded" -> 3 US Letter pages, plus
// an appendix page with the cost assumptions when the cost lines carry them).
//
//   Page 1  Summary: header (address, parcel, county/state, acres, date), parcel map with scale bar,
//           north arrow and location inset, buildability score with its top 3 drivers, the cost
//           range, and 4-6 color-coded key findings.
//   Page 2  Site & zoning: zoning in plain words + permitted uses, overlays, site cards (water,
//           septic, public water/sewer, power, access, flood, wetlands, terrain), assessor values,
//           and a listing only when one matched.
//   Page 3  Costs & next steps: cost table (line, range, confidence tag) with a total equal to the
//           page-1 range, a "before you buy" checklist, numbered sources with dates.
//   Page 4  Appendix: how each cost line was estimated (the cost model's basis text), with the
//           same source numbers as page 3.
//
// One source per number:
// - Score: the dashboard's (#scoreMetric, painted by screening-refinements.js); drivers from the
//   same factors (window.AcresXScore.calculate()).
// - Costs: window.AcresXCostModel.estimate() (local-cost-model.js; generic counties get their generic
//   estimate through it). Both pages show the sum of the lines the table lists.
// - Flood / wetlands / public utilities: window.AcresXFlood, AcresXWetlands, AcresXUtilities.
// Listing data is shown only when a listing matched, as unverified context; it never feeds the score.
// No owner names are read or shown.
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
  const today = () => new Date().toISOString().slice(0, 10);

  function reportState() { try { return window.__acresxLast || (typeof last !== 'undefined' ? last : null); } catch { return window.__acresxLast || null; } }

  // ---- Sources: one numbered list for the whole report (page 3).
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
    try { const s = S?.wellStats?.(); if (s) { const d = s.median ?? s.fallbackMedian; return d == null ? null : { depth: d, count: s.count || s.total || 0 }; } } catch {}
    const v = (Array.isArray(data.wells) ? data.wells : []).slice(0, 5).map(w => Number(w?.properties?.CompletedDepth)).filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return { depth: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, count: v.length };
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
    const band = n == null ? 'na' : n >= 7 ? 'good' : n >= 5.5 ? 'fair' : 'poor';
    const rating = n == null ? '' : n >= 8.5 ? 'Excellent' : n >= 7 ? 'Good' : n >= 5.5 ? 'Moderate' : 'Challenging';
    let drivers = [];
    if (calc) {
      // Impact on the score: weight x distance from a neutral 70. Largest three, either direction.
      drivers = Object.entries(calc.factors).map(([key, f]) => ({ key, score: f.score, impact: (f.score - 70) * (calc.weights?.[key] ?? 10) }))
        .filter(d => d.impact !== 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3)
        .map(d => ({ good: d.score >= 70, text: driverText(d.key, d.score >= 70, data, facts) })).filter(d => d.text);
    }
    if (!drivers.length) drivers = facts.findings.slice(0, 3).map(f => ({ good: f.level === 'good', text: f.title }));
    return { value, band, rating, drivers };
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
      case 'zoning': return good ? `Official zoning mapped (${f.zoneCode || 'zone found'})` : 'Zoning not confirmed from an official map';
      default: return '';
    }
  }

  // ---- Facts shared by the pages

  function powerFacts(data) {
    const list = (Array.isArray(data.utility) ? data.utility : []).map(titleCase).filter(Boolean);
    const pi = data.powerIntelligence || {};
    const primary = titleCase(pi.provider) || list[0] || '';
    const others = list.filter(x => x.toLowerCase() !== primary.toLowerCase());
    const d = num(pi.distribution?.estimatedDistanceFt);
    return { primary, others, distanceFt: d, lookupFailed: Boolean(data.utility?.lookupFailed) };
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
    return { lines, low, high, local: Boolean(e.local), note: e.coverageNote || (e.local ? '' : 'Generic regional ranges; local prices not yet sourced for this county.') };
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
    const ra = data.costContext?.roadAccess;
    const sfd = (Array.isArray(zdp.uses) ? zdp.uses : []).find(u => /single[- ]family|dwelling, single|^residence$/i.test(u.label || ''));
    const f = {
      ...id, zp, zdp, zoneCode: zoneCode && zoneCode !== 'Not configured' ? zoneCode : '', zoneName,
      flood, wet, well: wellDepth(data), power: powerFacts(data), road: ra,
      water: PU?.water(data) || null, sewer: PU?.sewer(data) || null, puChecked: Boolean(data.publicUtilities?.available),
      soil: data.land?.soil || {}, terrain: data.land?.terrain || {}, sfd,
      assess: assessment(data), cost: costEstimate(data)
    };
    f.findings = findings(data, f);
    return f;
  }

  // ---- Page 1: key findings (red: risk, amber: verify, green: good)

  function findings(data, f) {
    const red = [], amber = [], green = [];
    const overlays = Array.isArray(f.zp.overlays) ? f.zp.overlays : [];
    if (f.flood.category === 'high') red.push({ title: 'High-risk flood zone on the parcel', detail: f.flood.detail });
    else if (['moderate', 'undetermined', 'not_mapped', 'limited'].includes(f.flood.category)) amber.push({ title: `Flood: ${f.flood.label.toLowerCase()}`, detail: f.flood.detail });
    if (f.wet.category === 'present' || f.wet.category === 'unmeasured') red.push({ title: 'Mapped wetland on the parcel', detail: f.wet.detail });
    else if (overlays.some(o => o.type === 'wetland')) red.push({ title: 'County-mapped wetland on the parcel', detail: overlays.find(o => o.type === 'wetland').name });
    if (f.road?.available && f.road.status === 'found' && f.road.road?.public === false) amber.push({ title: 'Access is by a private road', detail: `Nearest road ${f.road.road.name || ''} is private; confirm a recorded easement.` });
    else if (f.road?.status === 'none_within') amber.push({ title: 'No mapped road nearby', detail: 'Confirm legal access before buying.' });
    if (f.power.others.length) amber.push({ title: 'Overlapping power territories', detail: `${f.power.primary} · also listed: ${f.power.others.join(', ')}` });
    else if (!f.power.primary) amber.push({ title: 'Power provider not identified', detail: 'Ask the local utilities which one serves the parcel.' });
    if (f.puChecked && !f.sewer) amber.push({ title: 'No public sewer found', detail: 'Plan for a septic system and a soil evaluation.' });
    if (!f.water && f.well && f.well.depth > 400) amber.push({ title: 'Deep wells nearby', detail: `About ${Math.round(f.well.depth)} ft median depth of nearby wells` });
    if (!f.water && !f.well) amber.push({ title: 'No nearby well depths', detail: 'Ask a local driller about expected depth and yield.' });
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
    const risks = [...red.map(tag('risk')), ...amber.map(tag('verify'))];
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
  function parcelMap(parcel) {
    const r = ring(parcel);
    if (!r) return `<div class="map map-missing">Parcel outline not available for a map</div>`;
    const W = 800, H = 400;
    const xs = r.map(p => +p[0]), ys = r.map(p => +p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, k = Math.cos(cy * Math.PI / 180) || 1;
    // Work in ground-proportional units (longitude x cos(lat)) so the image is not stretched.
    // At least about 0.0016 deg (580 ft) tall: Esri's export refuses requests past its finest zoom.
    let bw = Math.max((maxX - minX) * k * 1.4, 0.0032), bh = Math.max((maxY - minY) * 1.4, 0.0016);
    if (bw / bh < W / H) bw = bh * W / H; else bh = bw * H / W;
    const b = [cx - bw / k / 2, cy - bh / 2, cx + bw / k / 2, cy + bh / 2];
    const pts = r.map(p => `${((p[0] - b[0]) / (b[2] - b[0]) * W).toFixed(1)},${((b[3] - p[1]) / (b[3] - b[1]) * H).toFixed(1)}`).join(' ');
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${b.join(',')}&bboxSR=4326&imageSR=4326&size=1000,500&format=jpg&f=image`;
    const ftPerPx = bw * 364000 / W; // 1 degree of latitude is about 364,000 ft
    const s = niceScale(ftPerPx, 150);
    const insetW = 0.36, insetH = insetW * 120 / 160; // degrees of latitude, about 25 x 19 miles
    const ib = [cx - insetW / k / 2, cy - insetH / 2, cx + insetW / k / 2, cy + insetH / 2];
    const insetUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?bbox=${ib.join(',')}&bboxSR=4326&imageSR=4326&size=320,240&format=png&f=image`;
    return `<figure class="map"><img class="map-img" src="${url}" alt="Satellite image of the parcel" onerror="this.closest('.map').classList.add('img-error')">
<svg class="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${pts}"/></svg>
<svg class="map-deco" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
<g transform="translate(36,38)"><circle r="21" fill="#fff" fill-opacity=".92"/><path d="M0,-16 L6,2 L0,-1 L-6,2 Z" fill="#17231c"/><text y="15" text-anchor="middle" font-size="10" font-weight="800" fill="#17231c">N</text></g>
<g transform="translate(18,${H - 30})"><rect x="-6" y="-9" width="${(s.px + 60).toFixed(0)}" height="22" rx="5" fill="#fff" fill-opacity=".92"/><rect x="0" y="0" width="${(s.px / 2).toFixed(1)}" height="5" fill="#17231c"/><rect x="${(s.px / 2).toFixed(1)}" y="0" width="${(s.px / 2).toFixed(1)}" height="5" fill="#fff" stroke="#17231c" stroke-width="1"/><text x="${(s.px + 6).toFixed(1)}" y="6" font-size="12" font-weight="700" fill="#17231c">${esc(s.label)}</text></g>
</svg>
<div class="map-tag">Parcel boundary approximate</div>
<div class="inset"><img src="${insetUrl}" alt="Location map" onerror="this.parentElement.classList.add('img-error')"><span class="inset-dot"></span><span class="inset-label">Location</span></div>
<figcaption class="map-credit">Imagery © Esri and contributors · Inset © Esri, OpenStreetMap contributors</figcaption>
<div class="map-error">Aerial imagery could not be loaded</div></figure>`;
  }

  // ---- Shared bits

  const eyebrow = t => `<div class="eyebrow">${esc(t)}</div>`;
  const chip = (level, text) => `<span class="chip ${level}">${esc(text)}</span>`;
  const pageHead = (title, f) => `<header class="mini-head"><img class="logo-sm" src="/assets/acresx-logo.png" alt="AcresX"><div class="mini-title">${eyebrow(title)}<span>${esc(f.address || 'No situs address')} · Parcel ${esc(f.pid || NA)}</span></div></header>`;
  const footer = (n, total) => `<footer class="foot"><span>AcresX · Preliminary property intelligence · Verify material findings</span><span>Page ${n} of ${total}</span></footer>`;

  // ---- Page 1

  function page1(data, f, score, name) {
    const parcel = data.parcel || {};
    const cost = f.cost;
    const refName = name && ![f.address, `Parcel ${f.pid}`, f.pid, 'Property'].includes(name) ? name : '';
    const drivers = score.drivers.length
      ? `<ul class="drivers">${score.drivers.map(d => `<li class="${d.good ? 'good' : 'risk'}"><b>${d.good ? '✓' : '⚠'}</b>${esc(d.text)}</li>`).join('')}</ul>`
      : `<p class="muted">Score drivers not available.</p>`;
    const flags = f.findings.length
      ? `<div class="flags">${f.findings.map(x => `<div class="flag ${x.level}"><b>${x.level === 'good' ? '✓' : x.level === 'risk' ? '!' : '?'}</b><div><strong>${esc(x.title)}</strong>${x.detail ? `<span>${esc(x.detail)}</span>` : ''}</div></div>`).join('')}</div>`
      : `<p class="muted">Key findings not available.</p>`;
    return `<section class="page p1"><div class="page-body">
<header class="head"><img class="logo" src="/assets/acresx-logo.png" alt="AcresX"><div class="head-right">${eyebrow('Property report')}<span>Generated ${esc(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</span></div></header>
<div class="title">
<h1>${esc(f.address || 'No situs address')}</h1>
<div class="facts">
<div><span>Parcel</span><strong>${esc(f.pid || NA)}</strong></div>
<div><span>Location</span><strong>${esc([f.county ? `${f.county} County` : '', f.stateName].filter(Boolean).join(', ') || NA)}</strong>${f.place ? `<small>${esc(f.place)}</small>` : ''}</div>
<div class="fact-size"><span>Parcel size</span><strong>${esc(f.acreage.text || NA)}</strong>${f.acreage.note ? `<small class="acreage-note">${esc(f.acreage.note)}</small>` : ''}</div>
${refName ? `<div><span>Reference</span><strong>${esc(refName)}</strong></div>` : ''}
</div></div>
${parcelMap(parcel)}
<div class="hero">
<article class="score-card band-${score.band}">${eyebrow('Buildability score')}<div class="score-row"><div class="score-num">${esc(score.value || '—')}<small>${score.value ? '/10' : ''}</small></div><div class="score-rating">${esc(score.rating || NA)}</div></div>${drivers}</article>
<article class="cost-card">${eyebrow('Site development cost')}<div class="cost-num">${cost ? esc(range(cost.low, cost.high)) : NA}</div><p>${cost ? `Midpoint about ${esc(kRange((cost.low + cost.high) / 2, (cost.low + cost.high) / 2))}. Sum of ${cost.lines.length} lines: ${esc(cost.lines.map(l => String(l.label).replace(/\s*\(.*\)$/, '').toLowerCase()).join(', '))} (page 3). ${cost.local ? 'Local prices where sourced.' : 'Generic regional ranges.'} ` : 'Cost inputs were not available when this report was generated. '}Screening estimate, not a quote.</p></article>
</div>
<section class="block">${eyebrow('Key findings')}${flags}</section>
<p class="disclaimer">Screening information from public records. Verify material findings with the responsible agency, utility or licensed professional before relying on them.</p>
</div>${footer(1, f.pages)}</section>`;
  }

  // ---- Page 2

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
    const depthLine = f.well ? `Nearby wells: about ${Math.round(f.well.depth)} ft median depth${f.well.count ? ` (${f.well.count} record${f.well.count === 1 ? '' : 's'})` : ''}` : 'No nearby well depths on record';
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
    else card('Septic / soil', !soil.available ? 'verify' : soil.feasibility === 'favorable' ? 'good' : soil.feasibility === 'limited' ? 'risk' : 'verify', !soil.available ? NA : soil.feasibility === 'favorable' ? 'Favorable' : soil.feasibility === 'limited' ? 'Limited' : 'Moderate', [soilLine, 'USDA screening only; a site evaluation sets the system type'], [sref]);
    // Public water / sewer
    if (PU && data.publicUtilities) {
      const both = f.water && f.sewer, any = f.water || f.sewer;
      const srcs = (data.publicUtilities.sources || []).filter(s => s.ok !== false).slice(0, 2).map(s => S.add(s.name, { url: s.url, date: '' }));
      card('Public water / sewer', both ? 'good' : 'verify', both ? 'Both likely' : any ? 'One likely' : data.publicUtilities.available ? 'Not found' : NA, [PU.line('water', data), PU.line('sewer', data)], srcs);
    } else card('Public water / sewer', 'verify', NA, ['Public water and sewer maps were not checked for this report']);
    // Power
    const p = f.power;
    if (p.primary) card('Power', p.others.length ? 'verify' : 'good', p.others.length ? 'Overlapping territories' : 'Provider mapped', [`${p.primary}${p.others.length ? ` · also listed: ${p.others.join(', ')}` : ''}`, p.distanceFt != null ? `Mapped line about ${Math.round(p.distanceFt).toLocaleString('en-US')} ft away; the utility confirms the route` : 'Territory does not confirm a service connection; the utility confirms the route'], [S.add('Utility service territory maps (HIFLD / utility published maps)', { date: '' })]);
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
      share != null ? `Flood zone covers about ${share.toFixed(share < 10 ? 1 : 0)}% of the parcel` : fOverlay ? `County overlay: ${fOverlay.name}${num(fOverlay.share) != null ? ` on ${Math.round(fOverlay.share * 100)}% of the parcel` : ''}` : f.flood.category === 'high' ? 'Mapped share of the parcel not measured; check where the zone falls relative to a homesite' : ''
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

  function assessorBlock(f, S) {
    const a = f.assess;
    if (!a) return `<p class="muted">Assessor values not available for this parcel.</p>`;
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
    return `<div class="assessor">${cells.join('')}</div><p class="muted">${esc(a.source || 'County assessor')}${ref}</p>`;
  }

  function listingBlock(data) {
    const listing = data.resoListings || data.listingContext || {};
    const rec = listing.best || listing.match || null;
    if (!rec) return '';
    const bits = [rec.status || rec.standardStatus || rec.StandardStatus, num(rec.listPrice) != null ? `List ${usd(rec.listPrice)}` : '', num(rec.daysOnMarket) != null ? `${rec.daysOnMarket} days on market` : '', rec.listingId ? `MLS ${rec.listingId}` : ''].filter(Boolean);
    return `<section class="block">${eyebrow('Listing')}<p class="listing"><strong>${esc(bits.join(' · ') || 'Listing match')}</strong><span>Listing claims are unverified context and do not affect the buildability score.</span></p></section>`;
  }

  function page2(data, f, S) {
    const z = f.zdp;
    const acres = f.acreage.official;
    const density = String(z.density || '');
    const densityWarning = Number.isFinite(acres) && /10 acres?/i.test(density) && acres < 10
      ? `<p class="warn-note"><strong>County verification recommended:</strong> Parcel area is ${esc(f.acreage.officialText)}, while the screening references ${esc(density)}. Confirm legal lot status and density exceptions with the county.</p>` : '';
    return `<section class="page p2"><div class="page-body">${pageHead('Site & zoning', f)}
<section class="block">${eyebrow('Zoning')}${zoningBlock(f, S)}${densityWarning}</section>
<section class="block">${eyebrow('Overlays')}${overlayBlock(f, S)}</section>
<section class="block">${eyebrow('Site conditions')}${siteCards(data, f, S)}</section>
<section class="block">${eyebrow('Assessor record')}${assessorBlock(f, S)}</section>
${listingBlock(data)}
</div>${footer(2, f.pages)}</section>`;
  }

  // ---- Page 3

  function costBlock(f, S, notes) {
    const c = f.cost;
    if (!c) return `<p class="muted">Cost inputs were not available when this report was generated.</p>`;
    const rows = c.lines.map((l, i) => {
      const tag = costTag(l);
      const refs = (l.sources || []).filter(s => s.name).map(s => S.add(s.name, { url: s.url, date: !s.asOf ? '' : /^undated$/i.test(s.asOf) ? 'undated' : `as of ${s.asOf}`, verified: s.verified }));
      if (l.basis) notes.push(`<li><strong>${esc(l.label)}</strong>${S.mark(refs)}<span class="amt-note">${esc(range(l.low, l.high))}</span><p>${esc(l.basis)}</p></li>`);
      return `<tr><td><strong>${esc(l.label)}</strong>${S.mark(refs)}</td><td><span class="tag ${tag.cls}">${esc(tag.text)}</span></td><td class="amt">${esc(range(l.low, l.high))}</td></tr>`;
    }).join('');
    return `<table class="costs"><thead><tr><th>Line</th><th>Confidence</th><th class="amt">Range</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total (matches page 1)</td><td class="amt">${esc(range(c.low, c.high))}</td></tr></tfoot></table>
<p class="muted">Screening estimate, not a quote. ${esc(c.note || '')} Midpoint about ${esc(kRange((c.low + c.high) / 2, (c.low + c.high) / 2))}. Exact fees are used where an official schedule was found; everything else is a labeled planning range.</p>${f.pages > 3 ? `<p class="pointer">How each line was estimated: appendix, page ${f.pages}.</p>` : ''}`;
  }

  function checklist(data, f) {
    const items = [];
    const juris = f.zp.permitJurisdiction?.name || f.zp.jurisdiction || (f.county ? `${f.county} County` : 'the jurisdiction');
    items.push(['Zoning and use', `Confirm with ${juris} that a home is allowed${f.zoneCode ? ` in ${f.zoneCode}` : ''}${f.zdp.density ? ` (${f.zdp.density.replace(/^Maximum/, 'maximum')})` : ''}, and check setbacks, overlays and legal lot status.`]);
    const fw = [];
    if (f.flood.category === 'high' || f.flood.category === 'moderate') fw.push('a floodplain determination');
    if (f.wet.category === 'present' || f.wet.category === 'unmeasured' || (f.zp.overlays || []).some(o => /wetland/.test(o.type || ''))) fw.push('a wetland delineation');
    items.push(['Flood and wetlands', fw.length ? `Get ${fw.join(' and ')} before choosing a homesite; buffers can move where you can build.` : 'Confirm with the county that no flood or critical-area permit applies to your homesite.']);
    items.push(['Water', f.water ? `Confirm water connection availability, capacity and fees with ${f.water.provider || 'the city/district'}.` : 'Review nearby well logs and ask a licensed driller about depth, yield and water quality.']);
    items.push(['Sewer or septic', f.sewer ? `Confirm sewer connection availability and fees with ${f.sewer.provider || 'the city/district'}.` : 'Order a soil and site evaluation from the local health district for a septic permit.']);
    items.push(['Power', f.power.primary ? `Request a line-extension estimate from ${f.power.primary}${f.power.others.length ? `, and confirm whether ${f.power.others.join(' or ')} serves the parcel instead` : ''}.` : 'Ask the local utilities which one serves the parcel and request a line-extension estimate.']);
    const priv = f.road?.status === 'found' && f.road.road?.public === false;
    items.push(['Access', priv ? `Confirm legal access over ${f.road.road.name || 'the private road'}: a recorded easement and any road maintenance agreement.` : 'Confirm legal access and the driveway approach permit with the road authority.']);
    items.push(['Title', 'Order a title report to review easements, covenants, CC&Rs and other recorded restrictions.']);
    return `<ol class="checklist">${items.slice(0, 7).map(([h, t]) => `<li><p><strong>${esc(h)}.</strong> ${esc(t)}</p></li>`).join('')}</ol>`;
  }

  function page3(data, f, S, notes) {
    const costs = costBlock(f, S, notes);
    const host = u => { try { return new URL(u).host; } catch { return ''; } };
    const sources = S.list.map((s, i) => `<li value="${i + 1}">${esc(s.name)}${s.date ? `, ${esc(s.date)}` : ''}${s.verified === false ? ' (unverified)' : ''}${host(s.url) ? ` <span class="url">${esc(host(s.url))}</span>` : ''}</li>`).join('');
    return `<section class="page p3"><div class="page-body">${pageHead('Costs & next steps', f)}
<section class="block">${eyebrow('Site development cost')}${costs}</section>
<section class="block">${eyebrow('Before you buy')}${checklist(data, f)}</section>
<section class="small">${eyebrow('Sources')}<p class="muted src-note">Map and record layers were read when this report was generated (${esc(today())}); cost sources show their effective date.</p>${sources ? `<ol class="sources">${sources}</ol>` : '<p class="muted">No sources recorded.</p>'}
<p class="limits"><strong>Preliminary screening only.</strong> AcresX compiles public records and third-party data. It is not a survey, appraisal, title report, wetland delineation, septic design, utility availability confirmation, zoning determination or engineering analysis, and does not guarantee development approval. Parcel boundaries and mapped features are approximate. Cost estimates are planning ranges, not bids. Verify material findings with the responsible agency, utility, licensed professional and title provider.</p></section>
</div>${footer(3, f.pages)}</section>`;
  }

  // ---- Page 4 (appendix): how each cost line was estimated. Source numbers match page 3.
  function appendix(f, notes) {
    return `<section class="page p4"><div class="page-body">${pageHead('Appendix: cost assumptions', f)}
<section>${eyebrow('How each cost line was estimated')}<p class="muted">The formula, inputs and assumptions behind each line of the cost table on page 3. Bracketed numbers refer to the sources on page 3. Screening estimate, not a quote.</p></section>
<ol class="notes">${notes.join('')}</ol>
</div>${footer(4, f.pages)}</section>`;
  }

  // ---- Document

  const CSS = `
@page{size:letter;margin:0}
:root{--g:#174f34;--g2:#1f7a45;--gold:#e5a823;--ink:#17231c;--mut:#5a6a60;--line:#dbe4de;--pale:#f2f6f3;--amber:#9b6411;--amberbg:#fff4de;--red:#a3322a;--redbg:#fdeceb;--greenbg:#e8f4ec}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#e6ece8;color:var(--ink);font:9pt/1.38 Arial,Helvetica,sans-serif}
.toolbar{position:sticky;top:0;z-index:9;background:var(--g);padding:10px 24px;text-align:right}.toolbar button{background:#fff;color:var(--g);border:0;border-radius:8px;padding:9px 15px;font-weight:800;cursor:pointer}
.page{width:8.5in;height:11in;margin:18px auto;background:#fff;padding:.45in .5in .3in;display:flex;flex-direction:column;box-shadow:0 10px 32px #0002;break-after:page;page-break-after:always;overflow:hidden}
.page:last-child{break-after:auto;page-break-after:auto}
.page-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:12px}
.page.grow{height:auto;min-height:11in;overflow:visible}.page.grow .page-body{overflow:visible}
.foot{flex:none;display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;margin-top:8px;font-size:7pt;color:var(--mut)}
.eyebrow{font-size:7pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--g);display:flex;align-items:center;gap:6px;margin-bottom:6px}.eyebrow:before{content:"";width:14px;height:3px;border-radius:2px;background:var(--gold)}
.eyebrow.sub{margin-top:8px}
h1,h2,h3,p{margin:0}
.muted{color:var(--mut);font-size:7.5pt}
sup.ref{font-size:6pt;color:var(--mut);margin-left:2px;font-weight:400}
.block{break-inside:avoid}
.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid var(--g);padding-bottom:8px}
.logo{height:30px}.head-right{text-align:right;font-size:8pt;color:var(--mut)}.head-right .eyebrow{justify-content:flex-end;margin-bottom:2px}
.title h1{font-size:20pt;line-height:1.1;letter-spacing:-.01em;color:var(--ink);margin-bottom:8px}
.facts{display:flex;gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.facts>div{flex:1;padding:7px 12px;border-left:1px solid var(--line)}.facts>div:first-child{padding-left:0;border-left:0}
.facts span,.assessor span{display:block;font-size:6.5pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
.facts strong{display:block;font-size:10pt;margin-top:2px}.facts small,.assessor small{display:block;font-size:7pt;color:var(--mut);margin-top:1px}
.facts .acreage-note{color:var(--amber)}
.map{position:relative;margin:0;width:100%;aspect-ratio:2/1;border-radius:10px;overflow:hidden;background:#dfe7e1;border:1px solid var(--line);flex:none}
.map-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.map-svg,.map-deco{position:absolute;inset:0;width:100%;height:100%}
.map-svg polygon{fill:rgba(229,168,35,.16);stroke:var(--gold);stroke-width:3.5;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.map-tag{position:absolute;left:70px;top:12px;background:#ffffffeb;border-radius:6px;padding:4px 7px;font-size:6.5pt;font-weight:800;color:var(--ink)}
.inset{position:absolute;right:10px;top:10px;width:1.55in;height:1.16in;border:2px solid #fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px #0004;background:#eef2ee}
.inset img{width:100%;height:100%;object-fit:cover;display:block}.inset-dot{position:absolute;left:50%;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#d0362b;border:2px solid #fff;box-shadow:0 0 0 1px #0005}
.inset-label{position:absolute;left:4px;bottom:3px;font-size:6pt;font-weight:800;background:#ffffffe0;border-radius:3px;padding:1px 4px}
.inset.img-error img{display:none}
.map-credit{position:absolute;right:6px;bottom:5px;background:#ffffffe0;border-radius:4px;padding:2px 5px;font-size:5.8pt;color:#333}
.map-error{display:none;position:absolute;inset:0;place-items:center;color:var(--mut)}.map.img-error .map-error{display:grid}.map.img-error .map-img{display:none}
.map-missing{display:grid;place-items:center;color:var(--mut);aspect-ratio:3/1}
.hero{display:grid;grid-template-columns:1.25fr 1fr;gap:12px}
.score-card,.cost-card{border-radius:10px;padding:12px 14px;border:1px solid var(--line);background:var(--pale)}
.score-row{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.score-num{font-size:30pt;font-weight:900;line-height:1;letter-spacing:-.02em}.score-num small{font-size:11pt;font-weight:700;margin-left:2px;color:var(--mut)}
.score-rating{font-size:11pt;font-weight:800}
.band-good{background:var(--greenbg);border-color:#b9dcc6}.band-good .score-num,.band-good .score-rating{color:var(--g2)}
.band-fair{background:var(--amberbg);border-color:#efd6a6}.band-fair .score-num,.band-fair .score-rating{color:var(--amber)}
.band-poor{background:var(--redbg);border-color:#efc3bf}.band-poor .score-num,.band-poor .score-rating{color:var(--red)}
.drivers{list-style:none;margin:0;padding:0}.drivers li{display:flex;gap:7px;padding:3px 0;font-size:8.5pt;font-weight:600;color:var(--ink)}
.drivers b{width:12px;flex:none;text-align:center}.drivers li.good b{color:var(--g2)}.drivers li.risk b{color:var(--red)}
.cost-card{background:#fff;border:1px solid var(--line);border-top:4px solid var(--gold)}
.cost-num{font-size:20pt;font-weight:900;color:var(--g);line-height:1.1;margin:2px 0 6px;letter-spacing:-.01em}
.cost-card p{font-size:8pt;color:var(--mut)}
.flags{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.flag{display:flex;gap:9px;align-items:flex-start;border-radius:8px;padding:8px 10px;border-left:4px solid}
.flag b{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:9pt}
.flag strong{display:block;font-size:9pt}.flag span{display:block;font-size:7.5pt;color:var(--mut);margin-top:1px}
.flag.risk{background:var(--redbg);border-color:var(--red)}.flag.risk b{background:var(--red)}
.flag.verify{background:var(--amberbg);border-color:#d39a2a}.flag.verify b{background:#c98a17}
.flag.good{background:var(--greenbg);border-color:var(--g2)}.flag.good b{background:var(--g2)}
.disclaimer{font-size:7.5pt;color:var(--mut);margin-top:auto}
.mini-head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--g);padding-bottom:7px}
.logo-sm{height:20px}.mini-title{text-align:right;font-size:8pt;color:var(--mut)}.mini-title .eyebrow{justify-content:flex-end;margin-bottom:1px;font-size:8pt}
.zone-head{display:flex;gap:12px;align-items:center;margin-bottom:6px}
.zone-code{background:var(--g);color:#fff;font-weight:900;font-size:13pt;border-radius:8px;padding:6px 11px;min-width:56px;text-align:center}
.zone-head strong{font-size:12pt;color:var(--ink)}.zone-head span{display:block;font-size:8pt;color:var(--mut)}
.plain{font-size:9pt;margin-bottom:6px}
table{border-collapse:collapse;width:100%}
.uses td{padding:3px 6px 3px 0;border-bottom:1px solid var(--line);font-size:8pt}.uses td.st{color:var(--mut);font-size:7.5pt;padding-right:14px;white-space:nowrap}
.uses i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:#a9b2ac}.uses i.permitted{background:var(--g2)}.uses i.limited,.uses i.conditional{background:#d08b25}.uses i.not_permitted{background:var(--red)}
.overlays{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px}
.overlays li{font-size:8pt;padding:3px 0;border-bottom:1px solid var(--line);break-inside:avoid}.overlays em{font-style:normal;font-weight:700;color:var(--amber)}.overlays span{display:block;font-size:7.3pt;color:var(--mut)}
.sites{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.site{border:1px solid var(--line);border-radius:8px;padding:7px 10px;break-inside:avoid;background:#fff}
.site-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px}.site h3{font-size:9pt;color:var(--g)}
.site p{font-size:7.8pt;color:#33443a;line-height:1.35}
.chip{font-size:6.8pt;font-weight:800;border-radius:999px;padding:2px 8px;white-space:nowrap}
.chip.good{background:var(--greenbg);color:var(--g2)}.chip.verify{background:var(--amberbg);color:var(--amber)}.chip.risk{background:var(--redbg);color:var(--red)}
.assessor{display:grid;grid-template-columns:repeat(auto-fit,minmax(1.3in,1fr));gap:7px;margin-bottom:4px}
.assessor>div{background:var(--pale);border-radius:8px;padding:7px 10px}.assessor strong{display:block;font-size:10.5pt;margin-top:2px;color:var(--ink)}
.listing strong{display:block;font-size:9pt}.listing span{display:block;font-size:7.5pt;color:var(--mut)}
.warn-note{margin-top:6px;background:var(--amberbg);border-left:3px solid #d39a2a;border-radius:4px;padding:6px 9px;font-size:8pt}
.costs th{font-size:6.8pt;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);text-align:left;border-bottom:2px solid var(--g);padding:4px 6px 4px 0}
.costs td{padding:5px 6px 5px 0;border-bottom:1px solid var(--line);font-size:9pt;vertical-align:top}
.costs .amt{text-align:right;white-space:nowrap;padding-right:0}.costs td.amt{font-weight:800;color:var(--g)}
.costs tfoot td{border-top:2px solid var(--g);border-bottom:0;font-weight:900;font-size:10.5pt;padding-top:7px}.costs tfoot td.amt{color:var(--g);font-size:11pt}
.costs tr{break-inside:avoid}
.tag{font-size:7pt;font-weight:800;border-radius:999px;padding:2px 8px;white-space:nowrap}.tag.fee{background:var(--greenbg);color:var(--g2)}.tag.local{background:#e7eef8;color:#2b5283}.tag.estimate{background:var(--amberbg);color:var(--amber)}
.checklist{margin:0;padding:0;list-style:none;counter-reset:c;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.checklist li{counter-increment:c;display:flex;gap:8px;font-size:8pt;line-height:1.33;break-inside:avoid;color:#33443a}.checklist li:before{content:counter(c);flex:none;width:17px;height:17px;border-radius:4px;border:1.5px solid var(--g);color:var(--g);font-weight:800;font-size:7.5pt;display:grid;place-items:center}
.checklist strong{color:var(--g)}
.small .sources{margin:0;padding-left:16px;font-size:6.6pt;line-height:1.32;color:#3d4c43;columns:2;column-gap:18px}.src-note{font-size:6.5pt;margin-bottom:3px}
.sources li{break-inside:avoid;margin-bottom:1px}
.pointer{font-size:8pt;font-weight:700;color:var(--g);margin-top:4px}
.notes{margin:0;padding:0;list-style:none}.notes li{break-inside:avoid;border-bottom:1px solid var(--line);padding:8px 0}
.notes li strong{font-size:9.5pt;color:var(--g)}.notes .amt-note{float:right;font-weight:800;color:var(--g)}.notes p{font-size:8pt;line-height:1.45;color:#33443a;margin-top:3px}.sources .url{color:var(--mut);white-space:nowrap}
.limits{font-size:6.5pt;color:var(--mut);margin-top:8px;border-top:1px solid var(--line);padding-top:6px}
.d1 .page-body{gap:9px}.d1 .checklist li{font-size:7.6pt}.d1 .costs td{padding:4px 6px 4px 0}.d1 .site p,.d1 .uses td{font-size:7.4pt}.d1 .small .sources{font-size:6.3pt}.d1 .notes p{font-size:7.6pt}
.d2 .page-body{gap:7px}.d2 .checklist li{font-size:7.3pt}.d2 .checklist{gap:4px 14px}.d2 .site{padding:5px 8px}.d2 .uses td{padding:2px 6px 2px 0}.d2 .small .sources{font-size:6pt}.d2 .notes p{font-size:7.2pt}.d2 .notes li{padding:6px 0}.d2 .flag{padding:6px 9px}
.d3 .site p,.d3 .uses td,.d3 .overlays li{font-size:7pt}.d3 .small .sources{font-size:5.7pt}.d3 .notes p{font-size:6.8pt}.d3 .costs td{padding:4px 6px 4px 0}
@media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none}}
`;
  // Pages have a fixed Letter height; a page whose content would overflow is tightened in steps
  // (d1-d3), and if it still overflows it grows instead of clipping (no overlap, no cut-off).
  const FIT = `(function(){function fit(){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('d1','d2','d3','grow');var b=p.querySelector('.page-body');var over=function(){return b.scrollHeight>b.clientHeight+1};var steps=['d1','d2','d3'];for(var i=0;i<steps.length&&over();i++)p.classList.add(steps[i]);if(over())p.classList.add('grow')})}window.__acresxFit=fit;window.addEventListener('load',fit);window.addEventListener('beforeprint',fit);if(document.readyState!=='loading')fit();else document.addEventListener('DOMContentLoaded',fit)})();`;

  function makeReport(name) {
    const data = reportState() || {};
    const f = gatherFacts(data);
    // A fourth page (appendix) when the cost lines carry their assumptions; every footer says "of N".
    f.pages = f.cost?.lines.some(l => l.basis) ? 4 : 3;
    const S = sourceList();
    const score = scoreInfo(data, f);
    const p1 = page1(data, f, score, name);
    const p2 = page2(data, f, S);
    const notes = [];
    const p3 = page3(data, f, S, notes);
    const p4 = f.pages > 3 ? appendix(f, notes) : '';
    const docTitle = `${f.address || `Parcel ${f.pid}`} — AcresX Property Report`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title><style>${CSS}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
${p1}
${p2}
${p3}
${p4}
<script>${FIT}</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to generate the report.'); return; }
    w.document.write(html);
    w.document.close();
  }

  function askAndGenerate() {
    const data = reportState();
    if (!data?.parcel) { alert('Analyze a property first.'); return; }
    const id = identity(data);
    const suggested = id.address || (id.pid ? `Parcel ${id.pid}` : 'Property');
    const name = window.prompt('Property name, client name, or reference ID:', suggested);
    if (name === null) return;
    makeReport(name.trim() || suggested);
  }
  function bind() {
    const old = $('generateReportBtn') || document.querySelector('.top-actions button:nth-child(2)');
    if (!old) return;
    const b = old.cloneNode(true);
    b.id = 'generateReportBtn';
    b.disabled = false;
    old.replaceWith(b);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); askAndGenerate(); });
  }
  function bindWhenReady() {
    let tries = 0;
    const attempt = () => { if ($('generateReportBtn') || document.querySelector('.top-actions button:nth-child(2)')) return bind(); if (++tries < 40) setTimeout(attempt, 50); };
    attempt();
  }
  window.AcresXReport = { gatherFacts, costEstimate, costTag, range, titleCase, makeReport };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindWhenReady);
  else bindWhenReady();
})();
