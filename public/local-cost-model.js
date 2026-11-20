// Local development-cost model (owner request 2026-11-12). Replaces the earlier partial
// Spokane-only cost model (removed 2026-11-13). Prices: public/cost-tables.js (window.AcresXCostTables).
//
// window.AcresXCostModel.estimate(last) is the one cost estimate the dashboard card, the cost
// details and the printable report (property-report-v2.js) read.
// - Spokane, WA, Kootenai, ID, Yellowstone and Gallatin, MT ("local" counties): one formula per
//   line from this parcel's facts
//   and the county's sourced prices. Every line is
//     { low, high, label, basis, sources: [{ name, url, asOf, verified }], quoteRecommended, confidence }
// - Every other county: the existing generic estimate (screening-refinements.js, unchanged),
//   marked "generic regional ranges; local prices not yet sourced for this county".
//
// Most likely + likely range (owner request 2026-11-20: "the range is too wide, mostly from power and
// wells"). Every line also carries `central` (most likely) and may carry `tail` ({ value, what,
// text }: a worst case stated in words, e.g. "Could reach ~$88k if drilling to 1,370 ft"). Power and
// well lines price a central quantity x the central rate and take their likely range from the main
// unknown only (no more low quantity x low rate to high quantity x high rate); the other lines'
// central is the midpoint of their range for now. The estimate's `central` is the sum of the
// lines' central values, low/high the sum of their likely ranges, and `tails` the worst-case notes
// (never added). Rules and parameters: power() / powerRun(), wellPlan(), PLANNING.likely.
//
// Lines (local counties):
// - electric: one likely run (mapped line, existing improvements, the road distance, or a planning
//   assumption) and one likely design (underground for a short run, else overhead), priced with
//   Avista Schedule 51 (WA or ID, minus the residential allowance), Inland Power's recorded
//   estimator (that design's curve), or the AcresX planning rate: Kootenai Electric: $750
//   engineering fee floor; NorthWestern Energy (MT): Rule 6, minus the $400 residential allowance;
//   Montana co-ops: their published deposit/fee; other providers: "no published tariff found".
// - well: a water connection fee when public water is served and the provider publishes one; else
//   the generic connection range (public-utilities.js); else a private well (depth range + exact
//   start-card/permit fee). Public water only "likely" (2026-11-15): the private well stays the
//   line, and the connection (published fee or generic range) rides along as `alternative`, shown
//   under the line and never added to the total.
// - septic: the same for sewer; else a private septic system (soil range + exact permit fees).
// - permits: the building permit for an assumed 2,000 sf home with a 500 sf attached garage. Montana
//   county land: no building permit; DLI electrical + plumbing, the county approach permit and the
//   county zoning permit (only inside a mapped county zoning district). In Montana the building-
//   permit side follows the city limits (last.publicUtilities.cityLimits, the county city-limits
//   layer; 2026-11-15), not the zoning jurisdiction: a parcel under a city's extraterritorial
//   zoning (Billings RR3 outside the Billings limits) gets the county/state permits, with "City
//   of Billings zoning applies; confirm any zoning permit with the City" and no county zoning fee.
// - driveway: road-access length (/api/cost-context) x local $/ft from state DOT low bids.
// - sitework: slope tiers as pad earthwork volume x local excavation $/cy + a base allowance.
// The buildability score never reads this estimate. Listing/MLS data never feeds it.
(function (root) {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = n => Math.round(Number(n) || 0);
  const usd = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const usd0 = n => `$${round(n).toLocaleString('en-US')}`;
  const money = n => `$${Math.round(Number(n || 0) / 1000)}k`;
  // Whole dollars, as the printable report prints the same total (property-report-v2.js).
  const usdRange = (lo, hi) => (round(lo) === round(hi) ? usd0(lo) : `${usd0(lo)}–${usd0(hi)}`);
  const current = l => (l !== undefined ? l : typeof last !== 'undefined' ? last : root.__acresxLast);
  const tables = () => root.AcresXCostTables;
  const STATE_OF = { spokane: 'WA', stevens: 'WA', kootenai: 'ID', gallatin: 'MT', yellowstone: 'MT' };
  const GENERIC_NOTE = 'Generic regional ranges; local prices not yet sourced for this county.';
  const SCREENING = 'Screening estimate, not a quote.';

  function where(l) {
    const p = current(l)?.parcel?.properties || {};
    const county = String(p._countyDisplay || p.COUNTY_NM || (typeof document !== 'undefined' ? document.getElementById('county')?.value : '') || '').replace(/\s+County$/i, '').trim();
    const state = String(p._stateCode || STATE_OF[county.toLowerCase()] || 'WA').toUpperCase();
    return { county, state, key: `${state}:${county.toLowerCase()}` };
  }
  function profile(l) { const T = tables(); return T ? T.COUNTIES[where(l).key] || null : null; }

  const ref = (entry, extra = {}) => ({ name: entry.source?.name || '', url: entry.source?.url || '', asOf: entry.asOf || '', verified: Boolean(entry.verified), ...extra });
  const refs = entry => (entry.sources || [entry.source]).map(s => ({ name: s.name, url: s.url, asOf: entry.asOf || '', verified: Boolean(entry.verified) }));
  const planningRef = () => ({ name: tables().SOURCES.ACRESX.name, url: '', asOf: '', verified: false });
  // central: the line's most likely value (2026-11-20; power and well lines set it from their
  // central quantity x central rate, every other line is the midpoint of its range for now), kept
  // inside [low, high]. tail: { value, what, text } a worst case stated in words, never in the range.
  function line(key, low, high, label, basis, sources, { quote = true, confidence = 'Moderate', central, tail = null, ...extra } = {}) {
    const lo = round(low), hi = round(Math.max(low, high));
    const c = Math.min(hi, Math.max(lo, round(central ?? (lo + hi) / 2)));
    return { key, low: lo, high: hi, central: c, label, basis, sources: dedupe(sources), quoteRecommended: Boolean(quote), confidence, tail: tail && tail.value > hi ? tail : null, ...extra };
  }
  function dedupe(list) {
    const seen = new Set();
    return (list || []).filter(s => { const k = `${s.name}|${s.asOf}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---- Parcel facts

  // The one nearby-well-depth definition (screening-inputs.js), the estimate the dashboard and the
  // report show. The drilling line prices its most likely depth (wellPlan below).
  function wellDepth(l) {
    const WD = root.AcresXWellDepth;
    const s = WD?.stats(l);
    if (s?.depth == null) return null;
    return { median: s.depth, count: s.count, lowFt: s.lowFt ?? s.depth, highFt: s.planningDepth ?? s.highFt ?? s.depth, confidence: s.confidence, basis: WD.basis(s), stats: s };
  }
  function slopeBand(l) {
    const t = l?.land?.terrain || {};
    if (!t.available || !Number.isFinite(Number(t.gradePct))) return { band: 'unknown', grade: null };
    const g = Number(t.gradePct);
    return { band: g <= 5 ? 'flat' : g <= 10 ? 'rolling' : g <= 15 ? 'steep' : 'verySteep', grade: g };
  }
  function soilBand(l) {
    const s = l?.land?.soil || {};
    const f = String(s.feasibility || '').toLowerCase();
    return !s.available ? 'unknown' : f === 'favorable' ? 'favorable' : f === 'limited' ? 'limited' : 'moderate';
  }
  function powerFacts(l) {
    const pi = l?.powerIntelligence || {};
    const provider = String(pi.provider || (Array.isArray(l?.utility) ? l.utility[0] : '') || '').trim();
    const d = Number(pi.distribution?.estimatedDistanceFt);
    // usableForCost === false: an OpenStreetMap distance too far or too uncertain to price
    // (src/services/power-intelligence.js osmDistribution); the "not mapped" range is used instead.
    const known = pi.distribution && Number.isFinite(d) && d >= 0 && pi.distribution.estimatedDistanceFt !== null && pi.distribution.usableForCost !== false;
    const status = pi.distribution?.status || '';
    // Utility-published maps: Avista's (src/utilities/avista.js) or another utility's (src/utilities/published-lines.js).
    const label = String(pi.distribution?.sourceLabel || '');
    const from = status === 'utility_published_proximity' ? (label && !/avista/i.test(label) ? `the ${label.replace(/ map$/i, '')} published line map` : "Avista's published distribution line map") : status === 'osm_mapped_proximity' ? 'a line or pole mapped in OpenStreetMap' : 'mapped power data';
    // OpenStreetMap distances are "mapped lines only": said in the basis, with the OSM attribution.
    const osm = known && status === 'osm_mapped_proximity';
    const osmNote = osm ? ' Distance from mapped lines only: OSM maps few local lines here, so the actual nearest line may be closer; the utility confirms the route. Line data \u00a9 OpenStreetMap contributors.' : '';
    // A far or uncertain OSM line (not priced): the "not mapped" range, and the basis says why.
    const unconfirmed = !known && (status === 'osm_distance_not_confirmed' || pi.distribution?.usableForCost === false || (pi.nearestLine?.mappedOnly === true && pi.nearestLine.usableForCost === false));
    return { provider, distanceFt: known ? Math.round(d) : null, status, from, osmNote, unconfirmed, sourceUrl: pi.distribution?.sourceUrl || '' };
  }
  function jurisdiction(l) {
    const z = l?.zoningPermits || {};
    return String(z.permitJurisdiction?.name || z.jurisdiction || '').trim();
  }

  // ---- Power
  //
  // "Most likely" power (owner request 2026-11-20). One likely service run and ONE likely design,
  // priced at the central rate; the likely range comes from the main unknown only (where the line
  // really is); the dearer design and a farther line are notes, never in the total.
  //
  // Likely run (feet from the nearest facility to the meter at the homesite), first that applies:
  //   1. a utility-published line distance (Avista, Flathead Electric) or an OpenStreetMap pole /
  //      line / transformer within 1,000 ft (power-intelligence.js; transmission never counts):
  //      that distance plus the assumed service drop; range +/- likely.power.mappedBandPct (utility)
  //      or osmBandPct (OSM) of the central cost.
  //   2. the assessor lists improvements on the parcel (coverage-trust.js existingStructure):
  //      service is likely already on or next to the site, structureRunFt (or the road distance if
  //      shorter).
  //   3. the road-access answer (/api/cost-context: parcel interior point, the assumed homesite, to
  //      the nearest mapped road; the driveway line uses the same number): distribution usually
  //      follows roads, so the run is that distance. Range: 75%-150% of it (at least +200 ft), the
  //      line may sit across the road or a few spans along it.
  //   4. otherwise unknownRunFt, range unknownBandFt.
  // Likely design: an underground service for a run of shortRunFt or less, else overhead from the
  // road/line (the usual rural design under ~1,000 ft, and the usual long rural extension).
  // "Could exceed": for a mapped line, the dearest design at that distance; otherwise the dearest
  // design for a line extended twice the likely run (at least tailMinFt, at most tailMaxFt).
  const fmtFt = n => Math.round(n).toLocaleString('en-US');
  const midOf = r => (r.low + r.high) / 2;
  const NOT_CONFIRMED = 'the nearest line mapped in OpenStreetMap is too far or too uncertain to price; OSM maps few local lines here';
  function powerRun(l, f, P) {
    const L = P.likely.power, s = P.serviceDropFt;
    if (f.distanceFt != null) {
      const osm = f.status === 'osm_mapped_proximity';
      return { kind: osm ? 'osm' : 'mapped', mapped: true, lineFt: f.distanceFt, runFt: f.distanceFt + s, bandPct: osm ? L.osmBandPct : L.mappedBandPct,
        from: osm ? 'a line or pole mapped in OpenStreetMap' : `the nearest line on ${f.from}`, text: `${fmtFt(f.distanceFt)} ft from ${f.from} to the parcel plus an assumed ${s} ft service` };
    }
    const ra = l?.costContext?.roadAccess;
    const roadFt = ra?.available && ra.status === 'found' && Number.isFinite(Number(ra.distanceFt)) ? Math.max(0, Number(ra.distanceFt)) : null;
    let structure = null;
    try { structure = root.AcresXCoverage?.existingStructure?.(l) || null; } catch { structure = null; }
    const tail = R => Math.min(L.tailMaxFt, Math.max(L.tailMinFt, 2 * R));
    const band = R => [Math.max(L.minRunFt, R * L.roadBand.lowPct), Math.max(R * L.roadBand.highPct, R + L.roadBand.minExtraFt)];
    const why = f.unconfirmed ? ` (${NOT_CONFIRMED})` : '';
    if (Number(structure?.improvements) > 0) {
      const R = Math.max(L.minRunFt, roadFt != null ? Math.min(roadFt, L.structureRunFt) : L.structureRunFt);
      return { kind: 'structure', runFt: R, bandFt: band(R), tailFt: tail(Math.max(R, roadFt ?? 0)), from: 'existing improvements on the parcel',
        text: `No mapped line distance${why}; the assessor lists improvements on the parcel (${usd0(structure.improvements)}), so service is likely already on or next to the site: an assumed ~${fmtFt(R)} ft run (range ${fmtFt(band(R)[0])}-${fmtFt(band(R)[1])} ft)` };
    }
    if (roadFt != null && roadFt <= L.tailMaxFt) {
      const R = Math.max(L.minRunFt, roadFt);
      const road = ra.road?.name || 'the nearest road';
      return { kind: 'road', runFt: R, bandFt: band(R), tailFt: tail(R), from: road,
        text: `No mapped line distance${why}; distribution usually follows roads, so the likely run is the ${fmtFt(roadFt)} ft from the assumed homesite (parcel interior point) to ${road} on the county road map (range ${fmtFt(band(R)[0])}-${fmtFt(band(R)[1])} ft: the line may sit across the road or a few spans along it)` };
    }
    const R = L.unknownRunFt;
    return { kind: 'unknown', runFt: R, bandFt: [...L.unknownBandFt], tailFt: L.tailMaxFt, from: 'no mapped line or measured road (planning assumption)',
      text: `Line distance not ${f.unconfirmed ? `confirmed (${NOT_CONFIRMED})` : 'mapped'} and no road distance measured: an assumed ~${fmtFt(R)} ft run (range ${fmtFt(L.unknownBandFt[0])}-${fmtFt(L.unknownBandFt[1])} ft)` };
  }
  const likelyDesign = (run, P) => (run.runFt <= P.likely.power.shortRunFt ? 'underground' : 'overhead');
  const DESIGN_TEXT = { underground: 'an underground service from the nearest pole or transformer (short run)', overhead: 'overhead from the road or line' };
  // The likely range for a design priced by run length: +/- bandPct of the central cost for a
  // mapped distance, else the cost at the two ends of the run band.
  function band(run, central, at) {
    if (run.mapped) return [central * (1 - run.bandPct), central * (1 + run.bandPct)];
    const [a, b] = run.bandFt;
    return [Math.min(central, at(a)), Math.max(central, at(b))];
  }
  // "Power ~$X (likely $A–$B) — based on ~N ft from <source>; could exceed $C if ..." (owner wording).
  function powerSummary(run, c, lo, hi, tail) {
    const t = tail > hi ? `; could exceed ${usd0(tail)} ${run.mapped ? "if the utility's design needs underground or extra equipment" : `if the utility must extend a line farther (~${fmtFt(run.tailFt)} ft)`}` : '';
    return `Power ~${usd0(c)} (likely ${usdRange(lo, hi)}) — based on ~${fmtFt(run.runFt)} ft from ${run.from}${t}.`;
  }
  function powerLine(label, run, design, c, lo, hi, tail, detail, sources, extra) {
    const alt = extra.alternativeCost != null ? ` Alternative design: ${design === 'overhead' ? 'underground' : 'overhead'} ~${usd0(extra.alternativeCost)} (not in the total).` : '';
    const tailText = tail > hi ? ` Could exceed ${usd0(tail)} ${run.mapped ? "if the utility's design needs underground or extra equipment at this distance" : `if the utility must extend a line ~${fmtFt(run.tailFt)} ft`} (not in the total).` : '';
    const summary = powerSummary(run, c, lo, hi, tail);
    return line('electric', lo, hi, label, `${summary} ${run.text}. Likely design: ${DESIGN_TEXT[design]}.${alt}${tailText} ${detail}`, sources,
      { ...extra, central: c, summary, design, runFt: Math.round(run.runFt), runSource: run.kind, tail: tail > hi ? { value: round(tail), what: 'power extension', text: tailText.trim().replace(/ \(not in the total\)\.$/, '.') } : null });
  }

  // Avista Schedule 51, one single-phase home: primary (fixed + per ft), transformer and a service
  // circuit. A secondary circuit is used only when Avista's design runs one between the transformer
  // and the service (overhead: fixed; underground: fixed + per ft over an assumed run); it is in
  // the "could exceed" note only. Extension cost = max(0, basic - allowance) (the allowance is the
  // lesser of the cost and the cap); a $150 design fee, if one was paid, is credited on top.
  function avistaCost(T, d, s, sec = 0) {
    const oh = T.ohPrimaryFixed.value + T.ohPrimaryPerFt.value * d + T.ohTransformer.value + T.ohServicePerFt.value * s;
    const ug = T.ugPrimaryFixed.value + T.ugPrimaryPerFt.value * d + T.padTransformer.value + T.ugServicePerFt.value * s;
    const ohSec = oh + (T.ohSecondaryFixed?.value || 0);
    const ugSec = ug + (T.ugSecondaryFixed?.value || 0) + (T.ugSecondaryPerFt?.value || 0) * sec;
    const a = T.allowance.value;
    const cost = basic => ({ basic, cost: Math.max(0, basic - a) });
    return { oh: cost(oh), ug: cost(ug), ohSec: cost(ohSec), ugSec: cost(ugSec), allowance: a };
  }
  const avistaHigh = c => Math.max(c.oh.cost, c.ug.cost, c.ohSec.cost, c.ugSec.cost);
  // Inland Power estimator outputs recorded at a few distances (cost-tables.js power.inland.points).
  // inlandRange: at each recorded distance the cheapest and dearest design it offered (the "could
  // exceed" note uses the dearest); inlandAt: ONE design's recorded curve, linear between recorded
  // distances, the nearest recorded distance outside them.
  function inlandRange(points, ft, transformer) {
    const at = {};
    for (const p of points) {
      // Long designs do not ask whether the nearest facility is a transformer (null): both answers.
      if ((p.nearestIsTransformer != null && p.nearestIsTransformer !== transformer) || !Number.isFinite(p.cost)) continue;
      const e = at[p.ft] || (at[p.ft] = { ft: p.ft, low: Infinity, high: -Infinity, designs: [] });
      e.low = Math.min(e.low, p.cost); e.high = Math.max(e.high, p.cost); e.designs.push(p.design);
    }
    const env = Object.values(at).sort((a, b) => a.ft - b.ft);
    if (!env.length) return { low: 0, high: 0, designs: [] };
    if (ft <= env[0].ft) return { ...env[0] };
    if (ft >= env[env.length - 1].ft) return { ...env[env.length - 1] };
    const j = env.findIndex(e => e.ft >= ft), a = env[j - 1], b = env[j], t = (ft - a.ft) / (b.ft - a.ft);
    return { low: a.low + (b.low - a.low) * t, high: a.high + (b.high - a.high) * t, designs: [...new Set([...a.designs, ...b.designs])] };
  }
  function inlandAt(points, design, ft, transformer = 'No') {
    const pts = points.filter(p => p.design === design && (p.nearestIsTransformer == null || p.nearestIsTransformer === transformer) && Number.isFinite(p.cost)).sort((a, b) => a.ft - b.ft);
    if (!pts.length) return null;
    if (ft <= pts[0].ft) return pts[0].cost;
    if (ft >= pts[pts.length - 1].ft) return pts[pts.length - 1].cost;
    const j = pts.findIndex(p => p.ft >= ft), a = pts[j - 1], b = pts[j];
    return a.cost + (b.cost - a.cost) * (ft - a.ft) / (b.ft - a.ft);
  }
  // Inland's design names for the likely design: short runs (<= shortRunFt) use the short designs
  // (recorded at 100 ft), longer runs the long ones (recorded from 200 ft).
  const INLAND_DESIGNS = { short: { underground: 'Short Underground from Overhead', overhead: 'Short Overhead' }, long: { underground: 'Long Underground', overhead: 'Long Overhead' } };
  // No published per-foot rate: the AcresX planning rate. Central: the midpoint base + run x the
  // midpoint $/ft; "could exceed": the high base + run x the high $/ft.
  const genericAt = (P, ft) => midOf(P.powerBase) + Math.max(P.likely.power.minRunFt, ft) * midOf(P.powerPerFt);
  const genericTail = (P, ft) => P.powerBase.high + Math.max(P.likely.power.minRunFt, ft) * P.powerPerFt.high;
  function genericRun(l, f, P) {
    const run = powerRun(l, f, P);
    // Generic per-foot planning rates are "to mapped power" (no separate service drop), as before.
    if (run.mapped) return { ...run, runFt: Math.max(P.likely.power.minRunFt, run.lineFt), bandPct: P.likely.power.genericMappedBandPct, text: `${fmtFt(run.lineFt)} ft from ${f.from} to the parcel${f.osmNote ? `.${f.osmNote.replace(/\.$/, '')}` : ''}` };
    return run;
  }
  // { c, lo, hi, tail, rateText } for the generic planning rate, before any utility allowance/fee.
  function genericPrice(P, run) {
    const c = genericAt(P, run.runFt);
    const [lo, hi] = band(run, c, ft => genericAt(P, ft));
    const tail = genericTail(P, run.mapped ? run.runFt : run.tailFt);
    return { c, lo, hi, tail, rateText: `AcresX planning rate: $${midOf(P.powerBase).toLocaleString('en-US')} + $${midOf(P.powerPerFt)}/ft (midpoints of $${P.powerBase.low.toLocaleString('en-US')}-$${P.powerBase.high.toLocaleString('en-US')} and $${P.powerPerFt.low}-$${P.powerPerFt.high}/ft); the "could exceed" figure uses $${P.powerBase.high.toLocaleString('en-US')} + $${P.powerPerFt.high}/ft` };
  }
  function power(l, C, P) {
    const f = powerFacts(l);
    const name = f.provider || 'the serving utility';
    if (/\bavista\b/i.test(f.provider) && C.power.avista) {
      const T = C.power.avista, s = P.serviceDropFt, sec = P.secondaryFt;
      const stateName = C.state === 'WA' ? 'Washington' : 'Idaho';
      const src = [ref(T.ohPrimaryFixed), ref(T.allowance), ...(T.order ? [ref(T.order)] : [])];
      const run = powerRun(l, f, P);
      const design = likelyDesign(run, P);
      // Primary feet and service feet for a run: a mapped distance is the primary (plus the assumed
      // service); an estimated run includes the service.
      const split = R => (run.mapped ? [run.lineFt, s] : [Math.max(0, R - s), Math.min(R, s)]);
      const costAt = (R, d = design) => { const [p, sv] = split(R); const c = avistaCost(T, p, sv, sec); return d === 'overhead' ? c.oh.cost : c.ug.cost; };
      const [p0, s0] = split(run.runFt);
      const c0 = avistaCost(T, p0, s0, sec);
      const c = costAt(run.runFt);
      const [lo, hi] = band(run, c, R => costAt(R));
      const [pt, st] = split(run.mapped ? run.runFt : run.tailFt);
      const tail = avistaHigh(avistaCost(T, pt, st, sec));
      const secText = `A secondary circuit, used only if Avista's design needs one (overhead ${usd0(T.ohSecondaryFixed.value)}; underground ${usd0(T.ugSecondaryFixed.value)} + $${T.ugSecondaryPerFt.value}/ft over an assumed ${sec} ft), is in the "could exceed" figure only.`;
      const tailNote = `Allowance ${usd0(T.allowance.value)} (effective ${T.allowance.asOf}) applies to homes meeting Avista's usage conditions (${T.allowance.condition}). A $${T.designFeeCredit.value} design fee, if Avista charged one up front, is credited against this cost. Excludes exceptional costs (rock, easements, boring), a share of a primary line built in the last 5 years, and any trench or conduit you supply. Avista confirms the route and price.`;
      const detail = `Avista ${stateName} Schedule 51 (rates effective ${T.ohPrimaryFixed.asOf}): ${fmtFt(p0)} ft of new primary plus ${fmtFt(s0)} ft of service${f.osmNote}. Overhead ${usd0(c0.oh.basic)} - allowance = ${usd0(c0.oh.cost)}; underground ${usd0(c0.ug.basic)} - allowance = ${usd0(c0.ug.cost)}. ${run.mapped ? `Likely range +/- ${Math.round(run.bandPct * 100)}% (route, rock and design details).` : 'Likely range: the same design priced at the two ends of the run range.'} ${secText} ${tailNote}`;
      return powerLine('Power (Avista line extension)', run, design, c, lo, hi, tail, detail, src,
        { confidence: run.mapped ? 'Moderate' : 'Low', formula: 'avista', allowance: c0.allowance, alternativeCost: round(design === 'overhead' ? c0.ug.cost : c0.oh.cost) });
    }
    if (/inland power/i.test(f.provider) && C.power.inland) {
      const I = C.power.inland;
      const run = powerRun(l, f, P);
      const design = likelyDesign(run, P);
      const cap = ft => Math.min(ft, I.maxFt);
      const pick = ft => (ft <= P.likely.power.shortRunFt ? INLAND_DESIGNS.short : INLAND_DESIGNS.long);
      const costAt = (ft, d = design) => inlandAt(I.points, pick(ft)[d], cap(ft));
      const c = costAt(run.runFt);
      const [lo, hi] = band(run, c, ft => costAt(ft));
      const tail = inlandRange(I.points, cap(run.mapped ? run.runFt : run.tailFt), 'No').high;
      const short = run.runFt <= P.likely.power.shortRunFt;
      const yes = short ? inlandAt(I.points, INLAND_DESIGNS.short[design], 100, 'Yes') : null;
      const over = (run.mapped ? run.runFt : run.bandFt[1]) > I.maxFt ? ` Beyond the estimator's ${fmtFt(I.maxFt)} ft limit Inland quotes each job; the ${fmtFt(I.maxFt)} ft value is used.` : '';
      const detail = `Inland Power online estimator, recorded ${I.recorded}: "${pick(run.runFt)[design]}" at ~${fmtFt(cap(run.runFt))} ft to the meter, nearest facility not a transformer${yes != null ? ` (if it is a transformer: ${usd0(yes)})` : ''}.${f.osmNote}${over} ${run.mapped ? `Likely range +/- ${Math.round(run.bandPct * 100)}%.` : 'Likely range: the same design at the two ends of the run range.'} The "could exceed" figure is the dearest design the estimator offered at that distance. Ballpark only: Inland's estimate excludes trenching, conduit and vaults for underground service (the applicant's cost), rock and easements. Get an Inland Power estimate.`;
      return powerLine('Power (Inland Power line extension)', run, design, c, lo, hi, tail, detail,
        [{ name: I.source.name, url: I.source.url, asOf: I.recorded, verified: true }], { confidence: run.mapped ? 'Moderate' : 'Low', formula: 'inland', alternativeCost: round(costAt(run.runFt, design === 'overhead' ? 'underground' : 'overhead')) });
    }
    const run = genericRun(l, f, P);
    const design = likelyDesign(run, P);
    const g = genericPrice(P, run);
    const bandText = run.mapped ? `likely range +/- ${Math.round(run.bandPct * 100)}%` : 'likely range: the same rate at the two ends of the run range';
    if (/northwestern/i.test(f.provider) && C.power.northwestern) {
      const a = C.power.northwestern.allowance;
      const net = v => Math.max(0, v - a.value);
      return powerLine('Power (NorthWestern Energy line extension)', run, design, net(g.c), net(g.lo), net(g.hi), net(g.tail),
        `NorthWestern Energy Rule No. 6 (effective ${a.asOf}): the applicant advances the actual construction cost minus a ${usd0(a.value)} residential allowance (${a.note}), plus a surcharge whose rate the rule does not state; part may be refunded if others connect within 120 months. NWE publishes no per-foot rate, so this is an ${g.rateText}, minus ${usd0(a.value)}; ${bandText}. NWE does one cost estimate a year free; get an NWE estimate.`,
        [ref(a), planningRef()], { confidence: 'Low', formula: 'nwe-rule6', allowance: a.value });
    }
    const coop = (C.power.coops || []).find(c => c.match.test(f.provider));
    if (coop) {
      const fee = coop.fee;
      const adj = v => (fee ? (fee.credited ? Math.max(fee.value, v) : v + fee.value) : v);
      const feeText = fee ? ` Published: ${usd0(fee.value)} ${fee.label}${fee.credited ? '' : ', added'}.` : '';
      const policyText = coop.policy ? ` ${coop.policy.text.charAt(0).toUpperCase()}${coop.policy.text.slice(1)}.` : '';
      return powerLine(`Power (${coop.name})`, run, design, adj(g.c), adj(g.lo), adj(g.hi), adj(g.tail),
        `${coop.short} prices each job and publishes no per-foot rate; get a ${coop.short} estimate.${feeText}${policyText} The figures are an ${g.rateText}, not a ${coop.short} number; ${bandText}.`,
        [...(fee ? [ref(fee)] : []), ...(coop.policy?.source ? [ref(coop.policy)] : []), planningRef()], { confidence: 'Low', formula: 'coop' });
    }
    if (/kootenai electric/i.test(f.provider) && C.power.kec) {
      const fee = C.power.kec.engineeringFee;
      const adj = v => Math.max(fee.value, v);
      return powerLine('Power (Kootenai Electric)', run, design, adj(g.c), adj(g.lo), adj(g.hi), adj(g.tail),
        `KEC prices each job; get a KEC estimate. Its only published amount is the ${usd0(fee.value)} engineering fee (applied toward the project). The figures are an ${g.rateText}, not a KEC number; ${bandText}.`,
        [ref(fee), planningRef()], { confidence: 'Low', formula: 'kec' });
    }
    return powerLine('Power', run, design, g.c, g.lo, g.hi, g.tail,
      `${f.provider ? `${f.provider}: no published line-extension tariff found` : 'Serving utility not identified'}. ${g.rateText}; ${bandText}. Contact ${name} for an extension estimate.`,
      [planningRef()], { confidence: 'Low', formula: 'generic' });
  }

  // ---- Water / sewer

  function connectionFor(C, provider, service) {
    return (C.connections || []).find(c => c[service] && c.match.test(String(provider || ''))) || null;
  }
  // The connection line for a served or likely finding f: the provider's published fee where
  // cost-tables.js has one, else the generic connection range (public-utilities.js).
  function connection(service, f, C, P) {
    const PU = root.AcresXUtilities;
    if (!PU || !f) return null;
    const noun = service === 'water' ? 'water' : 'sewer';
    const phrase = f.status === 'served' ? 'likely available' : 'may be available';
    const fee = connectionFor(C, f.provider, service);
    const allowance = service === 'water' ? P.waterServiceLine : P.sideSewer;
    const allowanceText = service === 'water' ? 'water service line from the main' : 'side sewer from the main';
    if (fee) {
      const e = fee[service];
      const hook = service === 'water' ? fee.waterHookup : null;
      const low = e.value + allowance.low;
      const high = e.value + Math.max(allowance.high, hook ? hook.value : 0);
      const parts = [`${fee.provider} ${noun} fee ${usd0(e.value)} (${e.unit}, effective ${e.asOf}${e.note ? `; ${e.note}` : ''})`];
      if (hook) parts.push(`or ${usd0(hook.value)} if the City installs the service (${hook.note})`);
      return line(service === 'water' ? 'well' : 'septic', low, high, `${service === 'water' ? 'Water' : 'Sewer'} connection (${fee.provider})`,
        `Public ${noun} ${phrase} (${f.provider || fee.provider}). ${parts.join('; ')}, plus an AcresX allowance of ${usd0(allowance.low)}-${usd0(allowance.high)} for the ${allowanceText} (unsourced; get a contractor quote). Excludes any main extension. Verify with the city/district.`,
        [ref(e), ...(hook ? [ref(hook)] : []), planningRef()], { confidence: 'Moderate', publicUtility: f.status, feeProvider: fee.provider });
    }
    const r = service === 'water' ? PU.WATER_COST : PU.SEWER_COST;
    return line(service === 'water' ? 'well' : 'septic', r.low, r.high, `${service === 'water' ? 'Water' : 'Sewer'} connection`,
      `Public ${noun} ${phrase}${f.provider ? ` (${f.provider})` : ''}: ${f.basis}. Replaces the private ${service === 'water' ? 'well' : 'septic'} allowance; ${PU.FEE_BASIS}. Planning range, not a quote — verify with the city/district. Generic connection range: no published fee sourced for ${f.provider || 'this provider'}.`,
      [planningRef()], { confidence: 'Low', publicUtility: f.status });
  }
  // Served: the connection is the line. Likely: the private line, with the connection attached as
  // `alternative` (public-utilities.js wording; not in the total).
  function waterSewerLine(service, l, C, P, privateLine) {
    const PU = root.AcresXUtilities;
    const served = PU ? (service === 'water' ? PU.water(l) : PU.sewer(l)) : null;
    if (served) return connection(service, served, C, P);
    const base = privateLine();
    const maybe = PU?.likely ? PU.likely(service, l) : null;
    if (!maybe) return base;
    const c = connection(service, maybe, C, P);
    const alt = PU.alternative(service, l, { low: c.low, high: c.high }, { sources: c.sources, feeProvider: c.feeProvider || null, connectionBasis: c.basis });
    return alt ? { ...base, alternative: alt } : base;
  }

  function well(l, C, P) {
    const ex = l?.existingWell || {};
    const start = C.wellPermit.start, extra = C.wellPermit.extra, also = C.wellPermit.also || [];
    const both = [start, ...also];
    const fixed = both.reduce((a, x) => a + x.value, 0);
    const fees = `${both.map(x => `${x.label} ${usd(x.value)}`).join(' + ')}${extra ? `; ${extra.label} ${usd(extra.value)}` : ''}`;
    // Montana answers say whether the well is on the parcel (evidence.onParcel; their score stays
    // under 55 otherwise). Spokane answers keep the score >= 55 rule.
    const ev = ex.match?.evidence || {};
    const recorded = ex.available && ex.match && (typeof ev.onParcel === 'boolean' ? ev.onParcel : Number(ex.score || 0) >= 55);
    if (recorded) {
      const a = P.existingWellDueDiligence;
      const onParcel = typeof ev.onParcel === 'boolean' ? ev.onParcel : Boolean(ev.insideParcel || ev.ownerMatch);
      const m = ex.match;
      const ids = m.source === 'gwic' ? [`GWIC #${m.gwicId}`, m.completedDepth ? `${Math.round(m.completedDepth)} ft` : '', m.completionYear || ''].filter(Boolean)
        : m.source === 'dnrc_water_right' ? [`DNRC water right ${m.waterRightNumber}`] : [];
      const what = onParcel
        ? `Existing well recorded${ids.length ? ` (${ids.join(', ')})` : ''} — drilling may not be needed; verify condition/yield.`
        : `Existing well association detected (${ex.confidence || 'screening'} confidence).`;
      return line('well', a.low, a.high, 'Existing well (due diligence)',
        `${what} AcresX allowance for a well inspection, pump check, flow and water-quality testing instead of a new well (unsourced; get a well inspector's quote).`,
        [planningRef()], { confidence: 'Moderate', existingWell: onParcel });
    }
    const d = wellDepth(l);
    const ws = l?.costContext?.watershed;
    const w = ws?.available && ws.number != null && C.wellPermit.wria ? C.wellPermit.wria[ws.number] : null;
    const wLow = w ? w.surcharge.value + w.certificate.low : 0, wHigh = w ? w.surcharge.value + w.certificate.high : 0;
    const wText = w ? ` WRIA ${ws.number} (${ws.name}): ${w.surcharge.label} ${usd0(w.surcharge.value)} + ${w.certificate.label} (the county schedule does not say which package applies; the most likely figure uses the midpoint).`
      : C.wellPermit.wria && ws && !ws.available ? ' Watershed (WRIA) not checked: the Ecology layer did not answer; parcels in WRIA 55 add a $500 surcharge and a $3,000-$5,000 mitigation certificate.' : '';
    const sources = [...both.map(x => ref(x)), ...(extra ? [ref(extra)] : []), ...(w ? [ref(w.surcharge), { name: ws.source?.name || 'WA Ecology WRIA', url: ws.source?.url || '', asOf: '', verified: true }] : []), planningRef()];
    const feeText = `Exact fees: ${fees}${extra ? ' (high end only)' : ''}.${wText}`;
    const opts = { confidence: d && d.confidence === 'moderate' ? 'Moderate' : 'Low', wria: ws?.number ?? null };
    if (!d) {
      return line('well', P.wellNoDepth.low + fixed + wLow, P.wellNoDepth.high + fixed + (extra ? extra.value : 0) + wHigh, 'Well',
        `${feeText} Drilling: no usable nearby well depth; AcresX allowance for a typical private well, ${usd0(P.wellNoDepth.low)}-${usd0(P.wellNoDepth.high)} (no official source; driller quote recommended).`, sources, opts);
    }
    // "Most likely" well (owner request 2026-11-20): the central depth (wellPlan) x the central
    // $/ft + the central pump package; the likely range is the likely depth range x the same rate
    // (depth is the main unknown); the deep-well case is a "could reach" note outside the range,
    // priced at the high $/ft and pump package.
    const plan = wellPlan(d.stats, P);
    const rate = midOf(P.wellPerFt), pump = midOf(P.wellFixed);
    const drill = ft => ft * rate + pump;
    const c = drill(plan.centralFt) + fixed + (wLow + wHigh) / 2;
    const lo = drill(plan.lowFt) + fixed + wLow;
    const hi = drill(plan.highFt) + fixed + (extra ? extra.value : 0) + wHigh;
    const tailCost = plan.tailFt != null ? plan.tailFt * P.wellPerFt.high + P.wellFixed.high + fixed + (extra ? extra.value : 0) + wHigh : null;
    const tail = tailCost != null && tailCost > hi ? { value: round(tailCost), what: 'deep well', text: `Could reach ~${money(tailCost)} if drilling to ${fmtFt(plan.tailFt)} ft (${plan.tailWhy}; $${P.wellPerFt.high}/ft + ${usd0(P.wellFixed.high)} pump package).` } : null;
    const summary = `Well ~${usd0(c)} (likely ${usdRange(lo, hi)}) — ${fmtFt(plan.centralFt)} ft most likely depth${tail ? `; could reach ~${money(tailCost)} if drilling to ${fmtFt(plan.tailFt)} ft` : ''}.`;
    return line('well', lo, hi, 'Well',
      `${summary} ${feeText} Depth: ${d.basis}. Priced at ${fmtFt(plan.centralFt)} ft (${plan.rule}), likely ${fmtFt(plan.lowFt)}-${fmtFt(plan.highFt)} ft, x $${rate}/ft + ${usd0(pump)} pump, tank and wiring (midpoints of the $${P.wellPerFt.low}-$${P.wellPerFt.high}/ft and ${usd0(P.wellFixed.low)}-${usd0(P.wellFixed.high)} AcresX planning rates, no official source; driller quote recommended).${tail ? ` ${tail.text} Not in the total.` : ''}`,
      sources, { ...opts, central: c, summary, tail, depthPlan: plan });
  }

  // The well line's depths (owner request 2026-11-20), from AcresXWellDepth.stats (screening-inputs.js):
  // - moderate confidence (3+ wells at similar elevation): central = their median; likely range =
  //   their 25th-75th percentile (comparableP25Ft/P75Ft: never raised by deep wells; a cached
  //   answer without them uses lowFt/highFt, or +/- bandPct when deep wells raised the high end).
  // - low confidence: central = the midpoint of the depth range, weighted toward the evidence:
  //   the midpoint counts twice and each comparable well (up to 2, at their median) once, and the depth
  //   is at least waterPenetrationFt below the static water level at the homesite when wells record
  //   one; kept inside the range and rounded to 10 ft. Likely range = central +/- bandPct, inside
  //   the depth range. The elevation-not-checked fallback (method 'nearest') uses the same rule.
  // - tail ("could reach"): the top of the depth range (planningDepth: one deep well, or the
  //   low-confidence widening) or a deep well named at moderate confidence, when deeper than the
  //   likely range.
  function wellPlan(s, P) {
    const W = P.likely.well;
    const r10 = v => Math.round(v / 10) * 10;
    const lowFt = Number(s.lowFt ?? s.depth), highFt = Number(s.planningDepth ?? s.highFt ?? s.depth);
    const raised = Boolean(s.deepWells?.raisedHigh);
    let centralFt, lo, hi, rule;
    if (s.confidence === 'moderate') {
      centralFt = Number(s.depth);
      const p25 = s.comparableP25Ft ?? (raised ? null : s.lowFt), p75 = s.comparableP75Ft ?? (raised ? null : s.highFt);
      if (p25 != null && p75 != null) { lo = Math.min(centralFt, p25); hi = Math.max(centralFt, p75); rule = `median of ${s.comparable} comparable wells; likely range their 25th-75th percentile`; }
      else { lo = r10(centralFt * (1 - W.bandPct)); hi = r10(centralFt * (1 + W.bandPct)); rule = `median of ${s.comparable} comparable wells; likely range +/- ${W.bandPct * 100}%`; }
    } else {
      const mid = (lowFt + highFt) / 2;
      const n = s.method === 'terrain' && s.comparableMedianFt != null ? Math.max(0, Math.min(2, Number(s.comparable) || 0)) : 0;
      let c = (2 * mid + n * (n ? Number(s.comparableMedianFt) : 0)) / (2 + n);
      const why = [`midpoint of the ${fmtFt(lowFt)}-${fmtFt(highFt)} ft low-confidence range`];
      if (n) why.push(`weighted toward ${n} well${n > 1 ? 's' : ''} at similar elevation (${fmtFt(s.comparableMedianFt)} ft)`);
      const wl = s.method === 'terrain' && s.waterLevelWells ? Number(s.waterLevelDepthFt) : NaN;
      if (Number.isFinite(wl) && wl + W.waterPenetrationFt > c) { c = wl + W.waterPenetrationFt; why.push(`at least ${W.waterPenetrationFt} ft below the ~${fmtFt(wl)} ft static water level`); }
      centralFt = r10(Math.min(highFt, Math.max(lowFt, c)));
      lo = Math.max(lowFt, r10(centralFt * (1 - W.bandPct)));
      hi = Math.min(highFt, r10(centralFt * (1 + W.bandPct)));
      lo = Math.min(lo, centralFt); hi = Math.max(hi, centralFt);
      rule = `${why.join(', ')}; likely range +/- ${W.bandPct * 100}%`;
    }
    const single = s.method === 'terrain' ? s.deepWells?.single : null;
    let tailFt = null, tailWhy = '';
    if (highFt > hi) { tailFt = highFt; tailWhy = raised && single ? `one well ${single.distanceMi != null ? `${single.distanceMi.toFixed(1)} mi away ` : ''}went to ${fmtFt(single.depthFt)} ft` : raised ? 'deep wells nearby' : 'the top of the low-confidence depth range'; }
    if (single && single.depthFt > Math.max(hi, tailFt ?? 0)) { tailFt = single.depthFt; tailWhy = `one nearby well went to ${fmtFt(single.depthFt)} ft`; }
    return { centralFt, lowFt: lo, highFt: hi, tailFt, tailWhy, rule };
  }

  function septic(l, C, P) {
    const band = soilBand(l);
    const s = P.septicInstall[band];
    const sp = C.septicPermits;
    const highItems = sp.highItems || [];
    const fee = sp.items.reduce((a, i) => a + i.value, 0);
    const feeHigh = fee + highItems.reduce((a, i) => a + i.value, 0);
    const highText = highItems.length ? ` The high end adds ${highItems.map(i => `${i.label} ${usd0(i.value)}`).join(' and ')} (${usd0(feeHigh)}).` : '';
    const feeText = sp.items.length ? `Exact ${sp.agency} fees ${usd0(fee)} (${sp.items.map(i => `${i.label} ${usd0(i.value)}`).join(' + ')}).${highText} ${sp.note}` : sp.note;
    const soilText = band === 'unknown' ? 'soil suitability not resolved' : `${band} USDA soil screening`;
    return line('septic', s.low + fee, s.high + feeHigh, 'Septic',
      `${feeText} Installed system: ${usd0(s.low)}-${usd0(s.high)} for ${soilText} (no official installed-cost source; get installer quotes).`,
      [...sp.items.map(i => ref(i)), ...highItems.map(i => ref(i)), planningRef()], { confidence: band === 'unknown' ? 'Low' : 'Moderate', septicPermitFees: fee });
  }

  // ---- Permits

  function kootenaiPermit(rule, home) {
    const valuation = rule.valuation.livingPerSf * home.livingSf + rule.valuation.garagePerSf * home.garageSf;
    const b = rule.brackets.find(x => valuation > x.over && valuation <= x.upTo) || rule.brackets[0];
    const permit = b.base + b.perThousand * Math.ceil((valuation - b.over) / 1000);
    const total = permit * (1 + rule.planReviewPct) + rule.applicationFee + rule.zoningReview;
    return { valuation, permit, total };
  }
  // Gallatin County Land Use Permit: the greater of the minimum or pct x market value of
  // construction (at least $/sf finished and unfinished; the garage counts as unfinished), capped.
  // Low: that minimum market value; high: the assumed high valuation if it is larger.
  function gallatinLup(z, home) {
    const minValue = z.finishedPerSf * home.livingSf + z.unfinishedPerSf * home.garageSf;
    const fee = v => Math.min(z.max, Math.max(z.min, z.pct * v));
    return { minValue, low: fee(minValue), high: fee(Math.max(minValue, home.valuationHigh)), highValue: Math.max(minValue, home.valuationHigh) };
  }
  function montanaCountyPermit(l, rule, home, { cityZoning = '' } = {}) {
    const zp = l?.zoningPermits || {};
    const status = String(zp.zoning?.status || '');
    // Under a city's zoning outside its limits: the city's zoning, not a county zoning district.
    const zoned = status === 'gis_match' && !cityZoning;
    const z = rule.zoning;
    const zfee = z.kind === 'lup' ? gallatinLup(z, home) : { low: z.value, high: z.value };
    const zText = z.kind === 'lup'
      ? `${z.label}: the greater of ${usd0(z.min)} or ${z.pct * 100}% of the market value of construction (at least $${z.finishedPerSf}/sf finished, $${z.unfinishedPerSf}/sf unfinished; garage counted as unfinished), capped at ${usd0(z.max)}: ${usd0(zfee.low)} at ${usd0(zfee.minValue)}${zfee.high !== zfee.low ? ` to ${usd0(zfee.high)} at ${usd0(zfee.highValue)}` : ''} (effective ${z.asOf})`
      : `${z.label} ${usd0(z.value)}${z.dated ? ` (${z.dated})` : ''}`;
    const zoneName = zp.zoning?.code ? ` (${zp.zoning.code})` : '';
    const zoningText = cityZoning ? `${cityZoning} zoning applies${zoneName}; confirm any zoning permit with the City (no fee added; the county zoning permit does not apply).`
      : zoned ? `Inside ${z.where}${zoneName}: ${zText}.`
      : status === 'unzoned' ? `Mapped unzoned, so no county zoning permit is added. If county zoning did apply: ${zText}.`
        : `County zoning not resolved for this parcel; not added. Inside ${z.where}: ${zText}.`;
    const e = rule.electrical, pl = rule.plumbing, a = rule.approach, nb = rule.noBuildingPermit;
    const low = e.low + pl.value + a.value + (zoned ? zfee.low : 0);
    const high = e.high + pl.value + a.value + (zoned ? zfee.high : 0);
    return { low, high, conf: 'Moderate', label: 'Permits (state electrical, plumbing + approach)',
      text: `${rule.jurisdiction}: ${nb.label} (${nb.note}). ${e.label}. ${pl.label} = ${usd0(pl.value)} (${pl.note}). ${zoningText} ${a.label}: ${usd0(a.value)}, if the driveway meets a county road (a state highway approach is an MDT permit, not sourced).`,
      src: [ref(nb), ref(e), ref(pl), ref(z), ref(a)] };
  }
  const isCityName = name => /^(city|town) of /i.test(String(name || ''));
  // Montana building permits follow the city limits, not the zoning jurisdiction (the zoning
  // adapter's permitJurisdiction is the zoning jurisdiction, e.g. Billings' extraterritorial zoning).
  // { juris, cityZoning, note }: the permit jurisdiction to price and why.
  function permitJurisdiction(l, C) {
    const juris = jurisdiction(l);
    const county = (C.permits || []).find(r => r.kind === 'mt-county');
    const limits = l?.publicUtilities?.cityLimits;
    if (!county || !limits || limits.status === 'unknown') return { juris, cityZoning: '', note: '' };
    const zoningJuris = String(l?.zoningPermits?.jurisdiction || juris || '').trim();
    if (limits.status === 'outside' && isCityName(juris)) {
      return { juris: county.jurisdiction.replace(/\s*\(.*\)$/, ''), cityZoning: isCityName(zoningJuris) ? zoningJuris : '', rule: county,
        note: `Outside ${juris} limits on the county city-limits map, so ${juris} building permits do not apply.` };
    }
    if (limits.status === 'inside' && limits.city && !isCityName(juris)) return { juris: limits.city, cityZoning: '', note: `Inside ${limits.city} limits on the county city-limits map.` };
    return { juris, cityZoning: '', note: '' };
  }
  function permits(l, C, P, privateSeptic) {
    const pj = permitJurisdiction(l, C);
    const juris = pj.juris;
    const home = P.home;
    const homeText = `Assumes a ${home.livingSf.toLocaleString('en-US')} sf home with a ${home.garageSf} sf attached garage (an assumption; your plans set the real valuation).`;
    const rule = pj.rule || (C.permits || []).find(r => r.match.test(juris));
    const impact = (C.impactFees || []).find(r => r.match.test(juris));
    const impactLine = impact ? { low: impact.value, high: impact.value, text: ` Plus ${impact.label}: ${usd0(impact.value)}.`, src: [ref(impact)] } : { low: 0, high: 0, text: '', src: [] };
    let out;
    if (rule?.kind === 'mt-county') {
      out = montanaCountyPermit(l, rule, home, { cityZoning: pj.cityZoning });
    } else if (rule?.kind === 'kootenai-ubc') {
      const k = kootenaiPermit(rule, home);
      const a = rule.approach;
      out = { low: k.total + a.value, high: k.total + rule.siteDisturbance + a.value, conf: 'Moderate',
        text: `Kootenai County fee resolution (${rule.asOf}): valuation ${usd0(k.valuation)} ($${rule.valuation.livingPerSf}/sf living, $${rule.valuation.garagePerSf}/sf garage) gives a permit fee of ${usd(k.permit.toFixed(2))}, + ${Math.round(rule.planReviewPct * 100)}% plan review + ${usd0(rule.applicationFee)} application + ${usd0(rule.zoningReview)} zoning review = ${usd(k.total.toFixed(2))}; high end adds the ${usd0(rule.siteDisturbance)} site-disturbance review. ${a.label}: ${usd0(a.value)} (effective ${a.asOf}).`,
        src: [ref(rule), ref(a)] };
    } else if (rule?.kind === 'table') {
      const a = rule.approach;
      out = { low: rule.low.value + a.value, high: rule.high.value + a.value, conf: 'Moderate',
        text: `${rule.jurisdiction} 2025 new-home fee table: ${usd(rule.low.value)} at a $${(rule.low.valuation / 1000)}k valuation to ${usd(rule.high.value)} at $${(rule.high.valuation / 1000)}k. ${rule.note} ${a.label}: ${usd(a.value)} (2026 schedule).`,
        src: [ref(rule), ref(a)] };
    } else if (rule?.kind === 'spokane-county') {
      const b = rule.building;
      const sf = home.livingSf + home.garageSf;
      const inspection = Math.max(b.inspectionMin, b.inspectionPerSf * sf);
      const building = b.processing + b.planReview + inspection + b.stateSurcharge;
      const uga = Boolean(l?.zoningPermits?.urbanGrowthArea?.intersects);
      const plan = uga ? rule.planningUga : rule.planningRural;
      const septicFees = privateSeptic ? [rule.septicReview, rule.septicReviewProcessing] : [];
      const items = [rule.plumbing, rule.mechanical, plan, ...septicFees];
      const total = building + items.reduce((a, x) => a + x.value, 0);
      const types = new Set((Array.isArray(l?.zoningPermits?.overlays) ? l.zoningPermits.overlays : []).map(o => String(o?.type || '')));
      const info = [types.has('shoreline') ? `${rule.info.shoreline.label} ${usd(rule.info.shoreline.value)} (${rule.info.shoreline.note})` : '', types.has('wetland_buffer') ? `${rule.info.buffer.label} ${usd(rule.info.buffer.value)}` : ''].filter(Boolean);
      out = { low: total, high: total, conf: 'Moderate',
        text: `Spokane County fees (cost-based, not valuation-based): building permit ${usd(building.toFixed(2))} (processing ${usd(b.processing)} + plan review ${usd(b.planReview)} + inspection ${usd(inspection.toFixed(2))} [$${b.inspectionPerSf}/sf, ${usd(b.inspectionMin)} minimum, garage counted] + state surcharge ${usd(b.stateSurcharge)}); ${items.map(x => `${x.label} ${usd(x.value)}`).join('; ')}; total ${usd(total.toFixed(2))}. ${uga ? 'Inside' : 'Outside'} the mapped Urban Growth Area. A manufactured home instead: ${rule.manufactured.label} = ${usd(rule.manufactured.value)}. ${rule.note}${info.length ? ` Mapped overlay, information only (not added): ${info.join('; ')}.` : ''}`,
        src: [ref(b), ref(plan)] };
    } else {
      out = { low: P.permitGeneric.low, high: P.permitGeneric.high, conf: 'Low',
        text: `${juris || 'Permit jurisdiction not resolved'}: building permit fee schedule not sourced. Generic range ${usd0(P.permitGeneric.low)}-${usd0(P.permitGeneric.high)} (spans the sourced City of Spokane and Kootenai County schedules). Approach permit fee not sourced.${C.cityPermitNote ? ` ${C.cityPermitNote}` : ''}`,
        src: [planningRef()] };
    }
    return line('permits', out.low + impactLine.low, out.high + impactLine.high, out.label || 'Permits (building + approach)', `${homeText}${pj.note ? ` ${pj.note}` : ''} ${out.text}${impactLine.text}`, [...out.src, ...impactLine.src], { confidence: out.conf, jurisdiction: juris });
  }

  // ---- Driveway and site work

  // Crushed base is priced per ton (WSDOT, ITD) or per cubic yard (MDT, aggregatePerCy).
  const aggregate = D => (D.aggregatePerCy ? { ...D.aggregatePerCy, unit: 'cy' } : { ...D.aggregatePerTon, unit: 'ton' });
  const bidLabel = (C, short) => C.driveway.bidLabel || (C.state === 'WA' ? (short ? 'WSDOT' : 'WSDOT Eastern Region') : 'ITD');
  function drivewayRate(C, P) {
    const d = P.driveway, D = C.driveway, g = aggregate(D);
    const baseCyPerFt = d.widthFt * d.baseDepthFt / 27;
    const perFt = g.unit === 'cy' ? baseCyPerFt : baseCyPerFt * d.tonsPerCy;
    const cyPerFt = d.widthFt * d.excavationDepthFt / 27;
    return { low: perFt * g.low + cyPerFt * D.excavationPerCy.low, high: perFt * g.high + cyPerFt * D.excavationPerCy.high };
  }
  function driveway(l, C, P) {
    const D = C.driveway, d = P.driveway;
    const r = drivewayRate(C, P);
    const ra = l?.costContext?.roadAccess;
    const g = aggregate(D);
    const rate = `$${r.low.toFixed(2)}-$${r.high.toFixed(2)}/ft (${d.widthFt} ft wide, 6 in crushed base at $${g.low}-$${g.high}/${g.unit}, 6 in excavation at $${D.excavationPerCy.low}-$${D.excavationPerCy.high}/cy; ${bidLabel(C)} low bids)`;
    const tail = 'Materials at highway-bid prices; small jobs cost more. Culvert not included (not inferable from mapped data).';
    const srcs = [...refs(g), ...refs(D.excavationPerCy)];
    const fmt = n => Number(n).toLocaleString('en-US');
    const PRIVATE = 'a private road or easement likely serves this parcel; verify access';
    const roadSrc = { name: ra?.source?.name || 'County road centerlines', url: ra?.source?.url || '', asOf: '', verified: true };
    const range = (lo, hi, text, conf, lengthFt) => line('driveway', lo * r.low, hi * r.high, 'Driveway', `${text} x ${rate}. ${tail}`, [...srcs, roadSrc], { confidence: conf, lengthFt, lengthRangeFt: [lo, hi] });
    if (ra?.available && ra.status === 'found' && Number.isFinite(Number(ra.distanceFt))) {
      const L = Math.max(0, Number(ra.distanceFt));
      const road = ra.road || {};
      const isPrivate = road.public === false;
      // Not public: mapped as private, or (ownership 'unknown', Montana) its public status is not mapped.
      const notPublic = road.ownership === 'unknown' ? ` The nearest road's public status is not mapped: ${PRIVATE}.` : ` The nearest road is private: ${PRIVATE}.`;
      const pub = ra.nearestPublic;
      const named = `${road.name || 'the nearest road'}${road.kind ? ` (${road.kind})` : ''}`;
      const pubText = isPrivate ? (pub ? ` The nearest public road is ${pub.road?.name || 'unnamed'} at ${fmt(pub.distanceFt)} ft.` : ` No public road within ${fmt(ra.searchedFt || 0)} ft.`) : '';
      const where = `${fmt(L)} ft straight line from the parcel interior point (assumed homesite) to ${named} on the county's road centerline map.${pubText}`;
      if (L <= d.longFt) {
        const len = Math.max(L, d.minFt);
        const minText = len > L ? ` Driveway ${fmt(len)} ft (minimum allowance)` : ` Driveway ${fmt(len)} ft`;
        return range(len, len, `${where}${isPrivate ? notPublic : ''}${minText}`, 'Moderate', len);
      }
      const hi = Math.min(L, d.maxFt);
      const capped = L > d.maxFt ? ` Capped at ${fmt(d.maxFt)} ft: ${PRIVATE}.` : isPrivate ? notPublic : ' Verify the access route.';
      return range(d.unknownLengthFt.low, hi, `${where} That is long for a driveway, so the range is ${fmt(d.unknownLengthFt.low)} ft to ${fmt(hi)} ft.${capped}`, 'Low', null);
    }
    if (ra?.available && ra.status === 'none_within') {
      return range(d.unknownLengthFt.low, d.maxFt, `No mapped road within ${fmt(ra.searchedFt || 0)} ft of the parcel interior point: ${PRIVATE}. Range ${fmt(d.unknownLengthFt.low)} ft to ${fmt(d.maxFt)} ft (cap)`, 'Low', null);
    }
    const U = d.unknownLengthFt;
    const why = ra?.status === 'source_unavailable' ? 'The county road map did not answer' : ra?.status === 'not_configured' ? 'Driveway length not measured (no county road map is connected for this county yet)' : 'Driveway length not measured';
    return line('driveway', U.low * r.low, U.high * r.high, 'Driveway',
      `${why}; range for a ${U.low}-${U.high} ft driveway x ${rate}. ${tail}`, srcs, { confidence: 'Low', lengthFt: null, lengthRangeFt: [U.low, U.high] });
  }
  function sitework(l, C, P) {
    const { band, grade } = slopeBand(l);
    const e = C.driveway.excavationPerCy;
    const v = band === 'unknown' ? { low: P.padCy.flat.low, high: P.padCy.steep.high } : P.padCy[band];
    const low = P.siteBase.low + v.low * e.low, high = P.siteBase.high + v.high * e.high;
    const gradeText = grade == null ? 'Terrain not resolved (flat-to-steep range)' : `${grade.toFixed(1)}% mapped average grade (${band === 'verySteep' ? 'very steep' : band})`;
    return line('sitework', low, high, 'Site work',
      `${gradeText}: assumed ${v.low}-${v.high} cy of cut/fill on a 60 x 80 ft building pad x $${e.low}-$${e.high}/cy local excavation (${bidLabel(C, true)} low bids), plus ${usd0(P.siteBase.low)}-${usd0(P.siteBase.high)} clearing and erosion control (AcresX allowance). Highway-bid prices; small jobs cost more.`,
      [...refs(e), planningRef()], { confidence: grade == null ? 'Low' : 'Moderate' });
  }

  // ---- Estimate

  function localEstimate(l, C) {
    const P = tables().PLANNING;
    const electric = power(l, C, P);
    const water = waterSewerLine('water', l, C, P, () => well(l, C, P));
    const septicLine = waterSewerLine('sewer', l, C, P, () => septic(l, C, P));
    const sewer = Boolean(root.AcresXUtilities?.sewer?.(l));
    const components = { well: water, septic: septicLine, electric, driveway: driveway(l, C, P), sitework: sitework(l, C, P), permits: permits(l, C, P, !sewer) };
    const low = Object.values(components).reduce((a, x) => a + x.low, 0);
    const high = Object.values(components).reduce((a, x) => a + x.high, 0);
    const moderate = Object.values(components).filter(x => x.confidence === 'Moderate').length;
    return { local: true, county: C.label, researched: C.researched, low, high, ...mostLikely(components), confidence: moderate >= 4 ? 'Moderate' : 'Low', components, coverageNote: `Local prices for ${C.label} (sourced ${C.researched}).`, ...context(components, l) };
  }

  // Most likely total (owner request 2026-11-20): the sum of the lines' central values. The likely
  // range stays the sum of the lines' likely ranges; the worst-case notes ("could exceed ...") are
  // listed separately and never added. midpoint (older name, kept for callers) = central.
  // { central, midpoint, tails: [{ key, label, what, value, text }] }.
  function mostLikely(components) {
    const list = Object.values(components || {});
    const central = list.reduce((a, x) => a + round(x.central ?? (Number(x.low) + Number(x.high)) / 2), 0);
    const tails = Object.entries(components || {}).filter(([, x]) => x?.tail && x.tail.value > x.high).map(([key, x]) => ({ key, label: x.label, what: x.tail.what, value: x.tail.value, text: x.tail.text }));
    return { central, midpoint: central, tails };
  }
  // "Higher if: power extension, deep well." ('' when no line has a worst-case note).
  const tailsShort = e => (e?.tails?.length ? `Higher if: ${e.tails.map(t => t.what).join(', ')}.` : '');

  // Context shown with the estimate, never part of it (2026-11-15): the connection alternatives of
  // "likely" public water/sewer lines, and what a matched listing says about public water/sewer
  // (unverified; public-utilities.js listingNote).
  function context(components, l) {
    const alternatives = Object.values(components || {}).map(x => x?.alternative).filter(Boolean);
    let listingNote = '';
    try { listingNote = root.AcresXUtilities?.listingNote?.(l) || ''; } catch { listingNote = ''; }
    return { alternatives, listingNote };
  }

  // Soil / terrain inputs that did not load (2026-11-15). The range is kept (septic and site work
  // use their wider "not resolved" ranges), but the estimate says which inputs were missing.
  // Soil counts only while a private septic line is priced (no public sewer).
  function missingInputs(l) {
    let gaps = {};
    try { gaps = root.AcresXScore?.missingInputs?.(l) || {}; } catch { gaps = {}; }
    const out = [];
    if (!l?.land?.soil?.available && !root.AcresXUtilities?.sewer?.(l)) out.push({ key: 'soil', what: 'Soil', line: 'septic', reason: gaps.soil?.reason || "USDA soil service didn't answer" });
    if (!l?.land?.terrain?.available) out.push({ key: 'terrain', what: 'Terrain', line: 'site work', reason: gaps.terrain?.reason || "USGS elevation service didn't answer" });
    return out;
  }
  // "Soil and terrain not checked (USDA soil service didn't answer; USGS elevation service
  // didn't answer): the septic and site work lines use wider planning ranges." '' when none.
  function missingNote(list) {
    if (!list.length) return '';
    const and = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
    const what = and(list.map((m, i) => (i ? m.what.toLowerCase() : m.what)));
    return `${what} not checked (${list.map(m => m.reason).join('; ')}): the ${and(list.map(m => m.line))} line${list.length > 1 ? 's use' : ' uses'} wider planning ranges until ${list.length > 1 ? 'they load' : 'it loads'}.`;
  }

  function estimate(l) {
    l = current(l);
    if (!l?.parcel) return null;
    const C = profile(l);
    const missing = missingInputs(l);
    const extra = { missingInputs: missing, missingNote: missingNote(missing) };
    if (C) return { ...localEstimate(l, C), ...extra };
    const base = typeof root.__acresxScreeningCostEstimate === 'function' ? root.__acresxScreeningCostEstimate()
      : typeof root.__acresxGeneralCostEstimate === 'function' ? root.__acresxGeneralCostEstimate() : null;
    if (!base) return null;
    // Generic counties (screening-refinements.js buckets, unchanged): each line's central value is
    // the midpoint of its range, so the dashboard and the report show the same most likely total.
    const components = Object.fromEntries(Object.entries(base.components || {}).map(([k, x]) => [k, { ...x, central: x.central ?? round((Number(x.low) + Number(x.high)) / 2) }]));
    return { ...base, components, local: false, ...mostLikely(components), coverageNote: GENERIC_NOTE, ...context(components, l), ...extra };
  }

  // ---- Cost context: road access + watershed (/api/cost-context follow-up, local counties only;
  // all four have a county road centerline layer: src/counties/*-roads.js)

  let contextRequestId = 0;
  function parcelPoint(parcel) {
    try { if (typeof zoningPoint === 'function') return zoningPoint(parcel); } catch (_) {}
    try { if (typeof turf !== 'undefined') return turf.centroid(parcel).geometry.coordinates; } catch (_) {}
    return null;
  }
  function claimCostContext() {
    const l = current();
    if (!l?.parcel || !profile(l) || l.costContext) return null;
    const point = parcelPoint(l.parcel);
    if (!point) return null;
    const S = root.AcresXSections;
    if (S && !S.claim('costContext')) return null;
    const w = where(l);
    return { body: { state: w.state, county: w.county, lat: point[1], lon: point[0] }, searchId: S?.searchId };
  }
  async function loadCostContext(job) {
    if (!job) return;
    const S = root.AcresXSections;
    const id = ++contextRequestId;
    const stale = () => id !== contextRequestId || (S && !S.isCurrent(job.searchId)) || !current();
    let data;
    try {
      const response = await fetch('/api/cost-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body), signal: S?.timeoutSignal?.() });
      data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Cost context returned ${response.status}`);
    } catch (error) {
      const down = { available: false, status: 'source_unavailable', error: error?.message || 'Cost context lookup failed' };
      data = { roadAccess: down, watershed: { ...down } };
    }
    if (stale()) return;
    current().costContext = data;
    if (S) S.settle('costContext'); else render();
  }

  // ---- Display

  function addStyles() {
    if (typeof document === 'undefined' || document.getElementById('localCostStyles')) return;
    const s = document.createElement('style');
    s.id = 'localCostStyles';
    s.textContent = '.cost-sources{font-size:10px;color:var(--muted);margin-top:6px;line-height:1.5}.cost-sources a{color:var(--green)}.cost-quote-badge{display:inline-block;margin-left:6px;border-radius:999px;background:#fff4dd;color:#8a5a00;font-size:9px;font-weight:800;padding:3px 7px;vertical-align:middle}.cost-unverified{color:#8a5a00;font-weight:700}.cost-coverage{font-size:10px;font-weight:800;color:var(--green2);margin-top:6px}.cost-missing{font-size:10px;font-weight:800;color:#8a5a00;margin-top:6px}.cost-alt{font-size:10px;line-height:1.45;color:var(--muted);margin-top:6px}.cost-listing{font-size:10px;font-weight:700;color:#8a5a00;margin-top:6px}.cost-range{font-size:12px;font-weight:800;margin-top:2px}.cost-tail{font-size:10px;line-height:1.45;color:#8a5a00;margin-top:6px}';
    document.head?.appendChild(s);
  }
  function sourcesHtml(item) {
    const list = (item.sources || []).filter(s => s.name);
    if (!list.length) return '';
    return `<div class="cost-sources">${list.map(s => {
      const name = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : esc(s.name);
      return `${name}${s.asOf ? ` · as of ${esc(s.asOf)}` : ''}${s.verified ? '' : ' · <span class="cost-unverified">unverified</span>'}`;
    }).join('<br>')}</div>`;
  }
  function itemHtml(item) {
    const alt = item.alternative;
    const badge = item.central != null && item.low !== item.high ? `~${money(item.central)} (${money(item.low)}–${money(item.high)})` : `${money(item.low)}–${money(item.high)}`;
    return `<div class="result-item cost-line" data-cost-key="${esc(item.key)}"><div class="result-top"><h4>${esc(item.label)}${item.quoteRecommended ? '<span class="cost-quote-badge">Get a quote</span>' : ''}</h4><span class="badge">${badge}</span></div><div class="notice"><strong>${esc(item.confidence || 'Low')} confidence.</strong> ${esc(item.basis)}</div>${sourcesHtml(item)}${item.tail ? `<div class="cost-tail"><strong>Could be higher, not in the range:</strong> ${esc(item.tail.text)}</div>` : ''}${alt ? `<div class="cost-alt"><strong>Alternative, not in the total:</strong> ${esc(alt.text)}</div>` : ''}</div>`;
  }
  // Under the dashboard total and the details total: the connection alternatives and the listing note.
  function contextHtml(e) {
    return `${(e.alternatives || []).map(a => `<div class="cost-alt">${esc(a.text)}</div>`).join('')}${e.listingNote ? `<div class="cost-listing">${esc(e.listingNote)}</div>` : ''}`;
  }
  // The worst-case notes under the total: "Higher if: power extension, deep well." plus each note.
  function tailsHtml(e) {
    if (!e?.tails?.length) return '';
    return `<div class="cost-tail"><strong>${esc(tailsShort(e))}</strong> ${e.tails.map(t => esc(t.text)).join(' ')} Not in the likely range.</div>`;
  }
  function detailsHtml(e) {
    return `<div class="cost-detail-total"><span>${esc(e.coverageNote)} Most likely ~${money(e.central)}; likely range ${money(e.low)}–${money(e.high)}.</span>${tailsHtml(e)}${e.missingNote ? `<div class="cost-missing">${esc(e.missingNote)}</div>` : ''}${e.listingNote ? `<div class="cost-listing">${esc(e.listingNote)}</div>` : ''}<strong>~${money(e.central)} (${money(e.low)}–${money(e.high)})</strong></div>${Object.values(e.components).map(itemHtml).join('')}<div class="notice"><strong>${SCREENING}</strong><br>Exact fees are shown where an official schedule was found; everything else is a labeled planning range. Utility engineering, septic design, drilling, access and contractor pricing can change actual costs materially. Verify with the responsible agency, utility and contractors.</div>`;
  }
  function showDetails() {
    const e = estimate();
    const results = document.getElementById('results'), title = document.getElementById('resultsTitle'), detail = document.getElementById('detailCard');
    if (!e || !results || !detail) return;
    if (title) title.textContent = 'Preliminary Development Cost';
    results.innerHTML = detailsHtml(e);
    detail.classList.add('show');
    detail.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function render() {
    if (typeof document === 'undefined') return;
    const l = current();
    if (!l?.parcel) return;
    const card = document.getElementById('developmentCostCard');
    if (!card) return;
    // Wait while a cost input is still loading (progressive-loading.js shows "Updating…"). Not
    // ready('cost'): progressive-loading.js wraps renderSummary last and clears its "dirty" flag only
    // after this render, so ready() is false here even when every input has settled, and the card
    // kept the generic estimate ($41k-$101k for Spokane 23123.9051 instead of $45k-$90k).
    const S = root.AcresXSections;
    if (S && (typeof S.waitingFor === 'function' ? S.waitingFor('cost').length : !S.ready('cost'))) return;
    addStyles();
    if (!profile(l)) {
      // Generic counties: the card from score-cost.js / screening-refinements.js, plus the label.
      if (!card.querySelector('.cost-coverage')) { const n = document.createElement('div'); n.className = 'cost-coverage'; n.textContent = GENERIC_NOTE; card.appendChild(n); }
      const note = missingNote(missingInputs(l));
      let m = card.querySelector('.cost-missing');
      if (note && !m) { m = document.createElement('div'); m.className = 'cost-missing'; card.appendChild(m); }
      if (m) { if (note) m.textContent = note; else m.remove(); }
      return;
    }
    const e = estimate(l);
    // Owner wording 2026-11-20: "Most likely ~$X; likely range $A–$B; higher if: power extension, deep well".
    card.innerHTML = `<div class="cost-icon">$</div><div><div class="cost-kicker">Preliminary development estimate · most likely</div><div class="cost-value">~${money(e.central)}</div><div class="cost-range">Likely range ${usdRange(e.low, e.high)}</div>${e.tails.length ? `<div class="cost-tail">${esc(tailsShort(e))} ${e.tails.map(t => esc(t.text)).join(' ')} Not in the range.</div>` : ''}<div class="cost-note">${esc(e.confidence)} confidence. ${esc(e.coverageNote)} Uses this parcel's power distance, public utilities, wells, soils, terrain and road access. ${SCREENING}</div>${e.missingNote ? `<div class="cost-missing">${esc(e.missingNote)}</div>` : ''}${contextHtml(e)}<div class="cost-pill">View sources and assumptions →</div></div>`;
    card.onclick = showDetails;
    card.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault?.(); showDetails(); } };
  }

  const M = { estimate, missingInputs, missingNote, local: l => Boolean(profile(l)), profile, avistaCost, drivewayRate, kootenaiPermit, wellPlan, tailsShort, coverageNote: l => (profile(l) ? estimate(l)?.coverageNote || '' : GENERIC_NOTE), GENERIC_NOTE, render, showDetails, detailsHtml, claimCostContext, loadCostContext };
  root.AcresXCostModel = M;
  // Older callers (property-report-v2.js before this change, tests): the Spokane estimate.
  root.__acresxSpokaneCostEstimate = () => (where().key === 'WA:spokane' ? estimate() : null);

  if (typeof renderSummary === 'function') {
    const base = renderSummary;
    renderSummary = function (...args) {
      const result = base.apply(this, args);
      try {
        const job = claimCostContext();
        if (job) (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => loadCostContext(job));
        render();
      } catch (error) { console.error('AcresX local cost model failed', error); }
      return result;
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
