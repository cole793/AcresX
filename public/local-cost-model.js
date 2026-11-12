// Local development-cost model (owner request 2026-11-12). Replaces the partial
// public/spokane-cost-model.js. Prices: public/cost-tables.js (window.AcresXCostTables).
//
// window.AcresXCostModel.estimate(last) is the one cost estimate the dashboard card, the cost
// details and the printable report (property-report-v2.js) read.
// - Spokane, WA and Kootenai, ID ("local" counties): one formula per line from this parcel's facts
//   and the county's sourced prices. Every line is
//     { low, high, label, basis, sources: [{ name, url, asOf, verified }], quoteRecommended, confidence }
// - Every other county: the existing generic estimate (screening-refinements.js, unchanged),
//   marked "generic regional ranges; local prices not yet sourced for this county".
//
// Lines (local counties):
// - electric: Avista Schedule 51 (WA or ID) from the mapped line distance, overhead vs underground,
//   minus the residential allowance; Kootenai Electric: $750 engineering fee + generic range;
//   other providers: generic range, "no published tariff found".
// - well: a water connection fee when public water is served/likely and the provider publishes
//   one; else the generic connection range (public-utilities.js); else a private well (depth
//   range + exact start-card/permit fee).
// - septic: the same for sewer; else a private septic system (soil range + exact permit fees).
// - permits: the building permit for an assumed 2,000 sf home with a 500 sf attached garage.
// - driveway: road-access length (/api/cost-context) x local $/ft from state DOT low bids.
// - sitework: slope tiers as pad earthwork volume x local excavation $/cy + a base allowance.
// The buildability score never reads this estimate. Listing/MLS data never feeds it.
(function (root) {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = n => Math.round(Number(n) || 0);
  const usd = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const usd0 = n => `$${round(n).toLocaleString('en-US')}`;
  const money = n => `$${Math.round(Number(n || 0) / 1000)}k`;
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
  function line(key, low, high, label, basis, sources, { quote = true, confidence = 'Moderate', ...extra } = {}) {
    return { key, low: round(low), high: round(Math.max(low, high)), label, basis, sources: dedupe(sources), quoteRecommended: Boolean(quote), confidence, ...extra };
  }
  function dedupe(list) {
    const seen = new Set();
    return (list || []).filter(s => { const k = `${s.name}|${s.asOf}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---- Parcel facts

  function wellDepth(l) {
    const v = (Array.isArray(l?.wells) ? l.wells : []).slice(0, 7).map(w => Number(w?.properties?.CompletedDepth)).filter(x => Number.isFinite(x) && x >= 30 && x <= 1500).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return { median: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, count: v.length };
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
    const known = pi.distribution && Number.isFinite(d) && d >= 0 && pi.distribution.estimatedDistanceFt !== null;
    const status = pi.distribution?.status || '';
    const from = status === 'utility_published_proximity' ? "Avista's published distribution line map" : status === 'osm_mapped_proximity' ? 'OpenStreetMap power data' : 'mapped power data';
    return { provider, distanceFt: known ? Math.round(d) : null, from, sourceUrl: pi.distribution?.sourceUrl || '' };
  }
  function jurisdiction(l) {
    const z = l?.zoningPermits || {};
    return String(z.permitJurisdiction?.name || z.jurisdiction || '').trim();
  }

  // ---- Power

  // Avista Schedule 51, one single-phase home: primary (fixed + per ft), transformer and a service
  // circuit. No secondary circuit: for one customer the service runs from the transformer.
  // Extension cost = max(0, basic - allowance) (the allowance is the lesser of the cost and the cap).
  function avistaCost(T, d, s) {
    const oh = T.ohPrimaryFixed.value + T.ohPrimaryPerFt.value * d + T.ohTransformer.value + T.ohServicePerFt.value * s;
    const ug = T.ugPrimaryFixed.value + T.ugPrimaryPerFt.value * d + T.padTransformer.value + T.ugServicePerFt.value * s;
    const a = T.allowance.value;
    return { oh: { basic: oh, cost: Math.max(0, oh - a) }, ug: { basic: ug, cost: Math.max(0, ug - a) }, allowance: a };
  }
  // Inland Power estimator outputs recorded at a few distances (cost-tables.js power.inland.points):
  // at each recorded distance, the cheapest and dearest design it offered (the envelope); between
  // recorded distances, linear interpolation of that envelope; outside them, the nearest one.
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
  function genericPower(P, d) {
    if (Number.isFinite(d) && d <= 2640) {
      const ft = Math.max(50, d);
      return { low: P.powerBase.low + ft * P.powerPerFt.low, high: P.powerBase.high + ft * P.powerPerFt.high, text: `${d.toLocaleString('en-US')} ft to mapped power x an AcresX planning rate ($${P.powerPerFt.low}-$${P.powerPerFt.high}/ft plus $${P.powerBase.low.toLocaleString('en-US')}-$${P.powerBase.high.toLocaleString('en-US')})` };
    }
    return { low: P.powerUnknown.low, high: P.powerUnknown.high, text: 'line distance not mapped; AcresX planning allowance' };
  }
  function power(l, C, P) {
    const f = powerFacts(l);
    const name = f.provider || 'the serving utility';
    if (/\bavista\b/i.test(f.provider) && C.power.avista) {
      const T = C.power.avista, s = P.serviceDropFt;
      const stateName = C.state === 'WA' ? 'Washington' : 'Idaho';
      const src = [ref(T.ohPrimaryFixed), ref(T.allowance)];
      const tail = `Excludes exceptional costs (rock, easements, boring), a share of a primary line built in the last 5 years, and any trench or conduit you supply. Allowance ${usd0(T.allowance.value)} (effective ${T.allowance.asOf}). Avista confirms the route and price.`;
      if (f.distanceFt != null) {
        const c = avistaCost(T, f.distanceFt, s);
        const lo = Math.min(c.oh.cost, c.ug.cost), hi = Math.max(c.oh.cost, c.ug.cost);
        return line('electric', lo, hi, 'Power (Avista line extension)',
          `Avista ${stateName} Schedule 51 (rates effective ${T.ohPrimaryFixed.asOf}): ${f.distanceFt.toLocaleString('en-US')} ft of new primary (distance from ${f.from} to the parcel) plus an assumed ${s} ft service. Overhead ${usd0(c.oh.basic)} - allowance = ${usd0(c.oh.cost)}; underground ${usd0(c.ug.basic)} - allowance = ${usd0(c.ug.cost)}. ${tail}`,
          src, { confidence: 'Moderate', formula: 'avista', allowance: c.allowance });
      }
      const a = avistaCost(T, P.unknownLineFt.low, s), b = avistaCost(T, P.unknownLineFt.high, s);
      return line('electric', Math.min(a.oh.cost, a.ug.cost), Math.max(b.oh.cost, b.ug.cost), 'Power (Avista line extension)',
        `Distance to Avista's line not mapped: Avista ${stateName} Schedule 51 for ${P.unknownLineFt.low}-${P.unknownLineFt.high.toLocaleString('en-US')} ft of new primary plus an assumed ${s} ft service, overhead to underground, minus the allowance. ${tail}`,
        src, { confidence: 'Low', formula: 'avista', allowance: T.allowance.value });
    }
    if (/inland power/i.test(f.provider) && C.power.inland) {
      const I = C.power.inland, s = P.serviceDropFt;
      const known = f.distanceFt != null;
      const dLow = (known ? f.distanceFt : P.unknownLineFt.low) + s;
      const dHigh = (known ? f.distanceFt : P.unknownLineFt.high) + s;
      const lo = inlandRange(I.points, Math.min(dLow, I.maxFt), 'No');
      const hi = inlandRange(I.points, Math.min(dHigh, I.maxFt), 'No');
      const yes = inlandRange(I.points, Math.min(dLow, I.maxFt), 'Yes');
      const dText = known ? `${f.distanceFt.toLocaleString('en-US')} ft to mapped power (${f.from}) plus an assumed ${s} ft to the meter` : `distance to Inland's line not mapped; ${dLow.toLocaleString('en-US')}-${dHigh.toLocaleString('en-US')} ft to the meter`;
      const over = dHigh > I.maxFt ? ` Beyond the estimator's ${I.maxFt.toLocaleString('en-US')} ft limit Inland quotes each job; the ${I.maxFt.toLocaleString('en-US')} ft value is used.` : '';
      const designs = [...new Set([...lo.designs, ...hi.designs])].join(', ');
      return line('electric', lo.low, hi.high, 'Power (Inland Power line extension)',
        `Inland Power online estimator, recorded ${I.recorded}: ${dText}, across its ${designs} designs, nearest facility not a transformer${yes ? ` (if it is a transformer: ${usd0(yes.low)}-${usd0(yes.high)})` : ''}.${over} Ballpark only: Inland's estimate excludes trenching, conduit and vaults for underground service (the applicant's cost), rock and easements. Get an Inland Power estimate.`,
        [{ name: I.source.name, url: I.source.url, asOf: I.recorded, verified: true }], { confidence: known ? 'Moderate' : 'Low', formula: 'inland' });
    }
    const g = genericPower(P, f.distanceFt);
    if (/kootenai electric/i.test(f.provider) && C.power.kec) {
      const fee = C.power.kec.engineeringFee;
      return line('electric', Math.max(fee.value, g.low), Math.max(fee.value, g.high), 'Power (Kootenai Electric)',
        `KEC prices each job; get a KEC estimate. Its only published amount is the ${usd0(fee.value)} engineering fee (applied toward the project). The range is a generic AcresX allowance, not a KEC number: ${g.text}.`,
        [ref(fee), planningRef()], { confidence: 'Low', formula: 'kec' });
    }
    return line('electric', g.low, g.high, 'Power',
      `${f.provider ? `${f.provider}: no published line-extension tariff found` : 'Serving utility not identified'}. Generic range: ${g.text}. Contact ${name} for an extension estimate.`,
      [planningRef()], { confidence: 'Low', formula: 'generic' });
  }

  // ---- Water / sewer

  function connectionFor(C, provider, service) {
    return (C.connections || []).find(c => c[service] && c.match.test(String(provider || ''))) || null;
  }
  function connection(service, l, C, P, base) {
    const PU = root.AcresXUtilities;
    const f = PU ? (service === 'water' ? PU.water(l) : PU.sewer(l)) : null;
    if (!f) return null;
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
    const g = service === 'water' ? PU.waterCost(base, l) : PU.sewerCost(base, l);
    return { ...g, key: service === 'water' ? 'well' : 'septic', basis: `${g.basis} Generic connection range: no published fee sourced for ${f.provider || 'this provider'}.`, sources: [planningRef()], quoteRecommended: true, confidence: 'Low' };
  }

  function well(l, C, P) {
    const ex = l?.existingWell || {};
    const start = C.wellPermit.start, extra = C.wellPermit.extra;
    const fees = `${start.label} ${usd(start.value)}${extra ? `; ${extra.label} ${usd(extra.value)}` : ''}`;
    if (ex.available && ex.match && Number(ex.score || 0) >= 55) {
      const a = P.existingWellDueDiligence;
      return line('well', a.low, a.high, 'Existing well (due diligence)',
        `Existing well association detected (${ex.confidence || 'screening'} confidence). AcresX allowance for inspection, flow and water-quality testing instead of a new well (unsourced; get a well inspector's quote).`,
        [planningRef()], { confidence: 'Moderate' });
    }
    const d = wellDepth(l);
    const drill = d
      ? { low: d.median * P.wellPerFt.low + P.wellFixed.low, high: d.median * P.wellPerFt.high + P.wellFixed.high, text: `${Math.round(d.median)} ft median of ${d.count} nearby reported wells x $${P.wellPerFt.low}-$${P.wellPerFt.high}/ft plus $${P.wellFixed.low.toLocaleString('en-US')}-$${P.wellFixed.high.toLocaleString('en-US')} pump, tank and wiring` }
      : { low: P.wellNoDepth.low, high: P.wellNoDepth.high, text: 'no usable nearby well depth; AcresX allowance for a typical private well' };
    const ws = l?.costContext?.watershed;
    const w = ws?.available && ws.number != null && C.wellPermit.wria ? C.wellPermit.wria[ws.number] : null;
    const wLow = w ? w.surcharge.value + w.certificate.low : 0, wHigh = w ? w.surcharge.value + w.certificate.high : 0;
    const wText = w ? ` WRIA ${ws.number} (${ws.name}): ${w.surcharge.label} ${usd0(w.surcharge.value)} + ${w.certificate.label} (the county schedule does not say which package applies).`
      : C.wellPermit.wria && ws && !ws.available ? ' Watershed (WRIA) not checked: the Ecology layer did not answer; parcels in WRIA 55 add a $500 surcharge and a $3,000-$5,000 mitigation certificate.' : '';
    return line('well', drill.low + start.value + wLow, drill.high + start.value + (extra ? extra.value : 0) + wHigh, 'Well',
      `Exact fees: ${fees}${extra ? ' (high end only)' : ''}.${wText} Drilling: ${drill.text} (AcresX planning rate, no official source; driller quote recommended).`,
      [ref(start), ...(extra ? [ref(extra)] : []), ...(w ? [ref(w.surcharge), { name: ws.source?.name || 'WA Ecology WRIA', url: ws.source?.url || '', asOf: '', verified: true }] : []), planningRef()], { confidence: d && d.count >= 3 ? 'Moderate' : 'Low', wria: ws?.number ?? null });
  }

  function septic(l, C, P) {
    const band = soilBand(l);
    const s = P.septicInstall[band];
    const sp = C.septicPermits;
    const fee = sp.items.reduce((a, i) => a + i.value, 0);
    const feeText = sp.items.length ? `Exact ${sp.agency} fees ${usd0(fee)} (${sp.items.map(i => `${i.label} ${usd0(i.value)}`).join(' + ')}); ${sp.note}` : sp.note;
    const soilText = band === 'unknown' ? 'soil suitability not resolved' : `${band} USDA soil screening`;
    return line('septic', s.low + fee, s.high + fee, 'Septic',
      `${feeText} Installed system: ${usd0(s.low)}-${usd0(s.high)} for ${soilText} (no official installed-cost source; get installer quotes).`,
      [...sp.items.map(i => ref(i)), planningRef()], { confidence: band === 'unknown' ? 'Low' : 'Moderate', septicPermitFees: fee });
  }

  // ---- Permits

  function kootenaiPermit(rule, home) {
    const valuation = rule.valuation.livingPerSf * home.livingSf + rule.valuation.garagePerSf * home.garageSf;
    const b = rule.brackets.find(x => valuation > x.over && valuation <= x.upTo) || rule.brackets[0];
    const permit = b.base + b.perThousand * Math.ceil((valuation - b.over) / 1000);
    const total = permit * (1 + rule.planReviewPct) + rule.applicationFee + rule.zoningReview;
    return { valuation, permit, total };
  }
  function permits(l, C, P, privateSeptic) {
    const juris = jurisdiction(l);
    const home = P.home;
    const homeText = `Assumes a ${home.livingSf.toLocaleString('en-US')} sf home with a ${home.garageSf} sf attached garage (an assumption; your plans set the real valuation).`;
    const rule = (C.permits || []).find(r => r.match.test(juris));
    const impact = (C.impactFees || []).find(r => r.match.test(juris));
    const impactLine = impact ? { low: impact.value, high: impact.value, text: ` Plus ${impact.label}: ${usd0(impact.value)}.`, src: [ref(impact)] } : { low: 0, high: 0, text: '', src: [] };
    let out;
    if (rule?.kind === 'kootenai-ubc') {
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
        text: `${juris || 'Permit jurisdiction not resolved'}: building permit fee schedule not sourced. Generic range ${usd0(P.permitGeneric.low)}-${usd0(P.permitGeneric.high)} (spans the sourced City of Spokane and Kootenai County schedules). Approach permit fee not sourced.`,
        src: [planningRef()] };
    }
    return line('permits', out.low + impactLine.low, out.high + impactLine.high, 'Permits (building + approach)', `${homeText} ${out.text}${impactLine.text}`, [...out.src, ...impactLine.src], { confidence: out.conf, jurisdiction: juris });
  }

  // ---- Driveway and site work

  function drivewayRate(C, P) {
    const d = P.driveway, D = C.driveway;
    const tonsPerFt = d.widthFt * d.baseDepthFt / 27 * d.tonsPerCy;
    const cyPerFt = d.widthFt * d.excavationDepthFt / 27;
    return { low: tonsPerFt * D.aggregatePerTon.low + cyPerFt * D.excavationPerCy.low, high: tonsPerFt * D.aggregatePerTon.high + cyPerFt * D.excavationPerCy.high };
  }
  function driveway(l, C, P) {
    const D = C.driveway, d = P.driveway;
    const r = drivewayRate(C, P);
    const ra = l?.costContext?.roadAccess;
    const rate = `$${r.low.toFixed(2)}-$${r.high.toFixed(2)}/ft (${d.widthFt} ft wide, 6 in crushed base at $${D.aggregatePerTon.low}-$${D.aggregatePerTon.high}/ton, 6 in excavation at $${D.excavationPerCy.low}-$${D.excavationPerCy.high}/cy; ${C.state === 'WA' ? 'WSDOT Eastern Region' : 'ITD'} low bids)`;
    const tail = 'Materials at highway-bid prices; small jobs cost more. Culvert not included (not inferable from mapped data).';
    const srcs = [...refs(D.aggregatePerTon), ...refs(D.excavationPerCy)];
    const fmt = n => Number(n).toLocaleString('en-US');
    const PRIVATE = 'a private road or easement likely serves this parcel; verify access';
    const roadSrc = { name: ra?.source?.name || 'County road centerlines', url: ra?.source?.url || '', asOf: '', verified: true };
    const range = (lo, hi, text, conf, lengthFt) => line('driveway', lo * r.low, hi * r.high, 'Driveway', `${text} x ${rate}. ${tail}`, [...srcs, roadSrc], { confidence: conf, lengthFt, lengthRangeFt: [lo, hi] });
    if (ra?.available && ra.status === 'found' && Number.isFinite(Number(ra.distanceFt))) {
      const L = Math.max(0, Number(ra.distanceFt));
      const road = ra.road || {};
      const isPrivate = road.public === false;
      const pub = ra.nearestPublic;
      const named = `${road.name || 'the nearest road'}${road.kind ? ` (${road.kind})` : ''}`;
      const pubText = isPrivate ? (pub ? ` The nearest public road is ${pub.road?.name || 'unnamed'} at ${fmt(pub.distanceFt)} ft.` : ` No public road within ${fmt(ra.searchedFt || 0)} ft.`) : '';
      const where = `${fmt(L)} ft straight line from the parcel interior point (assumed homesite) to ${named} on the county's road centerline map.${pubText}`;
      if (L <= d.longFt) {
        return range(L, L, `${where}${isPrivate ? ` The nearest road is private: ${PRIVATE}.` : ''} Driveway ${fmt(L)} ft`, 'Moderate', L);
      }
      const hi = Math.min(L, d.maxFt);
      const capped = L > d.maxFt ? ` Capped at ${fmt(d.maxFt)} ft: ${PRIVATE}.` : isPrivate ? ` The nearest road is private: ${PRIVATE}.` : ' Verify the access route.';
      return range(d.unknownLengthFt.low, hi, `${where} That is long for a driveway, so the range is ${fmt(d.unknownLengthFt.low)} ft to ${fmt(hi)} ft.${capped}`, 'Low', null);
    }
    if (ra?.available && ra.status === 'none_within') {
      return range(d.unknownLengthFt.low, d.maxFt, `No mapped road within ${fmt(ra.searchedFt || 0)} ft of the parcel interior point: ${PRIVATE}. Range ${fmt(d.unknownLengthFt.low)} ft to ${fmt(d.maxFt)} ft (cap)`, 'Low', null);
    }
    const U = d.unknownLengthFt;
    const why = ra?.status === 'source_unavailable' ? 'The county road map did not answer' : 'Driveway length not measured';
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
      `${gradeText}: assumed ${v.low}-${v.high} cy of cut/fill on a 60 x 80 ft building pad x $${e.low}-$${e.high}/cy local excavation (${C.state === 'WA' ? 'WSDOT' : 'ITD'} low bids), plus ${usd0(P.siteBase.low)}-${usd0(P.siteBase.high)} clearing and erosion control (AcresX allowance). Highway-bid prices; small jobs cost more.`,
      [...refs(e), planningRef()], { confidence: grade == null ? 'Low' : 'Moderate' });
  }

  // ---- Estimate

  function localEstimate(l, C) {
    const P = tables().PLANNING;
    const electric = power(l, C, P);
    const water = connection('water', l, C, P, null) || well(l, C, P);
    const sewer = connection('sewer', l, C, P, null);
    const septicLine = sewer || septic(l, C, P);
    const components = { well: water, septic: septicLine, electric, driveway: driveway(l, C, P), sitework: sitework(l, C, P), permits: permits(l, C, P, !sewer) };
    const low = Object.values(components).reduce((a, x) => a + x.low, 0);
    const high = Object.values(components).reduce((a, x) => a + x.high, 0);
    const moderate = Object.values(components).filter(x => x.confidence === 'Moderate').length;
    return { local: true, county: C.label, researched: C.researched, low, high, midpoint: Math.round((low + high) / 2), confidence: moderate >= 4 ? 'Moderate' : 'Low', components, coverageNote: `Local prices for ${C.label} (sourced ${C.researched}).` };
  }

  function estimate(l) {
    l = current(l);
    if (!l?.parcel) return null;
    const C = profile(l);
    if (C) return localEstimate(l, C);
    const base = typeof root.__acresxScreeningCostEstimate === 'function' ? root.__acresxScreeningCostEstimate()
      : typeof root.__acresxGeneralCostEstimate === 'function' ? root.__acresxGeneralCostEstimate() : null;
    return base ? { ...base, local: false, coverageNote: GENERIC_NOTE } : null;
  }

  // ---- Cost context: road access + watershed (/api/cost-context follow-up, local counties only)

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
    s.textContent = '.cost-sources{font-size:10px;color:var(--muted);margin-top:6px;line-height:1.5}.cost-sources a{color:var(--green)}.cost-quote-badge{display:inline-block;margin-left:6px;border-radius:999px;background:#fff4dd;color:#8a5a00;font-size:9px;font-weight:800;padding:3px 7px;vertical-align:middle}.cost-unverified{color:#8a5a00;font-weight:700}.cost-coverage{font-size:10px;font-weight:800;color:var(--green2);margin-top:6px}';
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
    return `<div class="result-item cost-line" data-cost-key="${esc(item.key)}"><div class="result-top"><h4>${esc(item.label)}${item.quoteRecommended ? '<span class="cost-quote-badge">Get a quote</span>' : ''}</h4><span class="badge">${money(item.low)}–${money(item.high)}</span></div><div class="notice"><strong>${esc(item.confidence || 'Low')} confidence.</strong> ${esc(item.basis)}</div>${sourcesHtml(item)}</div>`;
  }
  function detailsHtml(e) {
    return `<div class="cost-detail-total"><span>${esc(e.coverageNote)} Midpoint ${money(e.midpoint)}</span><strong>${money(e.low)}–${money(e.high)}</strong></div>${Object.values(e.components).map(itemHtml).join('')}<div class="notice"><strong>${SCREENING}</strong><br>Exact fees are shown where an official schedule was found; everything else is a labeled planning range. Utility engineering, septic design, drilling, access and contractor pricing can change actual costs materially. Verify with the responsible agency, utility and contractors.</div>`;
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
    if (root.AcresXSections && !root.AcresXSections.ready('cost')) return; // progressive-loading.js shows "Updating…"
    addStyles();
    if (!profile(l)) {
      // Generic counties: the card from score-cost.js / screening-refinements.js, plus the label.
      if (!card.querySelector('.cost-coverage')) { const n = document.createElement('div'); n.className = 'cost-coverage'; n.textContent = GENERIC_NOTE; card.appendChild(n); }
      return;
    }
    const e = estimate(l);
    card.innerHTML = `<div class="cost-icon">$</div><div><div class="cost-kicker">Preliminary development estimate</div><div class="cost-value">${money(e.low)}–${money(e.high)}</div><div class="cost-note">Midpoint ${money(e.midpoint)} · ${esc(e.confidence)} confidence. ${esc(e.coverageNote)} Uses this parcel's power distance, public utilities, wells, soils, terrain and road access. ${SCREENING}</div><div class="cost-pill">View sources and assumptions →</div></div>`;
    card.onclick = showDetails;
    card.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault?.(); showDetails(); } };
  }

  const M = { estimate, local: l => Boolean(profile(l)), profile, avistaCost, drivewayRate, kootenaiPermit, coverageNote: l => (profile(l) ? estimate(l)?.coverageNote || '' : GENERIC_NOTE), GENERIC_NOTE, render, showDetails, detailsHtml, claimCostContext, loadCostContext };
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
