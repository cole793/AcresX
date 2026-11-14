// Shared reading of the /api/hazards flood result for the page's labels and scores. This file is
// the single source of truth for flood categories, labels, detail text and the flood score.
// Injected first by maybeInjectUiPolish() in src/index.js; index.html, parcel-preview.js,
// score-cost.js and screening-refinements.js call window.AcresXFlood at render time (and keep
// their old behaviour if it has not loaded).
//
// Categories, worst first (the worst intersecting zone wins; ranked by score, lowest first, and
// moderate beats not_mapped on the tie). Rules match src/services/flood.js (FLOOD_RANK, rowCategory).
//   high          SFHA_TF 'T', or FLD_ZONE A*/V* (not 'AREA NOT INCLUDED')       score 20, red
//   undetermined  D (or an unknown zone code)                                      score 55, amber
//   moderate      shaded X (0.2 PCT and other non-minimal subtypes), B             score 70, amber
//   not_mapped    no FEMA zone, or 'AREA NOT INCLUDED' / 'OPEN WATER'              score 70, amber
//   minimal       unshaded X ("AREA OF MINIMAL FLOOD HAZARD" or no subtype), C     score 96, green
//   limited       source.emptyResult: FEMA was unreachable and the backup source (Esri USA Flood
//                 Hazard Areas, which only maps high- and moderate-risk areas) found nothing.
//                 Not "no flood zone", so it is limited data                       score 50, amber
//   unavailable   available:false                                                 score 50, amber
// If a response has no `category` (older cached answers), it is derived from zoneDetails or zones.
// County paper-map copies (source.digitalFemaMap === false, e.g. Stevens County's digitized FEMA
// FIRM, src/counties/stevens-flood.js) use the same categories and scores; the detail names the
// source (source.label) and says FEMA has no digital map there, and the overview says so briefly.
// A high answer whose A/AE zone covers only part of the parcel adds source.edgeNote (the share
// and the map's edge accuracy).
// Zone shares (src/services/flood-share.js: floodZones, sfhaSharePct, floodShare): shareText()
// says how much of the parcel each zone covers ("Zone A on 12% of parcel (2.4 ac); rest zone X"),
// and says plainly when the high-risk zone only touches the parcel's edge; overviewShare() is the
// short form for the overview fact. Both are '' when the share was not measured. They never
// change the category or the score.
(function (root) {
  const BACKUP_PROVIDER = 'Esri USA Flood Hazard Areas';
  const LIMITED_LABEL = 'Limited flood data';
  const LIMITED_TEXT = 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.';
  const CATEGORIES = ['high', 'undetermined', 'moderate', 'not_mapped', 'minimal'];
  const NOT_MAPPED_ZONES = ['AREA NOT INCLUDED', 'OPEN WATER'];

  const GRADES = {
    high: { score: 20, label: 'High risk', cls: 'red', overview: 'High-risk flood zone', overviewCls: 'warn' },
    moderate: { score: 70, label: 'Moderate risk', cls: 'amber', overview: 'Moderate flood hazard', overviewCls: 'warn' },
    undetermined: { score: 55, label: 'Undetermined', cls: 'amber', overview: 'Flood risk not determined', overviewCls: 'warn' },
    minimal: { score: 96, label: 'Minimal', cls: 'green', overview: 'Minimal flood hazard', overviewCls: 'good' },
    not_mapped: { score: 70, label: 'Not mapped', cls: 'amber', overview: 'No digital FEMA flood map', overviewCls: 'warn' },
    limited: { score: 50, label: LIMITED_LABEL, cls: 'amber', overview: LIMITED_LABEL, overviewCls: 'warn' },
    unavailable: { score: 50, label: 'Unavailable', cls: 'amber', overview: 'Not verified', overviewCls: 'warn' }
  };
  const NOT_MAPPED_TEXT = 'No digital FEMA flood map (NFHL) covers this parcel. Verify with the county or FEMA.';
  const BACKUP_NOTE = ' (backup source: Esri copy of FEMA data)';
  const PAPER_MAP_NOTE = 'FEMA has no digital flood map here. Verify with the county or FEMA.';
  const PAPER_MAP_SUFFIX = ' (county copy of FEMA paper map)';

  const isLimited = flood => flood?.available === true && flood?.source?.emptyResult === true;
  const isBackup = flood => flood?.source?.provider === BACKUP_PROVIDER;
  const backupSuffix = flood => (isBackup(flood) ? ' (backup source)' : '');
  const isPaperMap = flood => flood?.source?.digitalFemaMap === false;
  const paperMapSource = flood => String(flood?.source?.label || flood?.source?.provider || 'county copy of the FEMA paper map');

  const upper = v => String(v ?? '').trim().toUpperCase();
  const isPointTwo = subtype => /0\.2\s*(%|PCT|PERCENT)/i.test(String(subtype || ''));

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
    const ranked = categories.map(c => CATEGORIES.indexOf(c)).filter(i => i >= 0);
    return ranked.length ? CATEGORIES[Math.min(...ranked)] : 'not_mapped';
  }

  // The flood result's category: unavailable, limited, or one of CATEGORIES.
  function category(flood) {
    if (!flood?.available) return 'unavailable';
    if (isLimited(flood) || flood.category === 'limited') return 'limited';
    if (CATEGORIES.includes(flood.category)) return flood.category;
    const backup = isBackup(flood);
    const found = rowsOf(flood).map(r => rowCategory(r, backup)).filter(Boolean);
    // Older answers whose `high` came from SFHA_TF or Esri symbology with no zone code to match.
    // Not when every zone is 'AREA NOT INCLUDED' / 'OPEN WATER': that was the old high bug.
    const onlyNotMapped = found.length > 0 && found.every(c => c === 'not_mapped');
    if (flood.high && !onlyNotMapped) found.push('high');
    if (flood.intersects && !found.length) found.push('undetermined');
    return worst(found);
  }

  const MEANING = {
    high: () => ' (1% annual chance, Special Flood Hazard Area)',
    moderate: rows => (rows.length && rows.every(r => upper(r.zone) === 'X' && isPointTwo(r.subtype)) ? ' (0.2% annual chance)' : ' (moderate flood hazard)'),
    undetermined: () => ': flood risk undetermined, verify with FEMA',
    minimal: () => ' (minimal flood hazard)'
  };

  // Worst zone first, then each other category's zones in rank order. Not-mapped rows are left
  // out of the "also" list. Backup-source zones say they come from Esri's copy of FEMA data.
  function detail(flood, cat) {
    if (cat === 'unavailable') return 'FEMA service unavailable';
    if (cat === 'limited') return LIMITED_TEXT;
    if (cat === 'not_mapped') return NOT_MAPPED_TEXT;
    const backup = isBackup(flood);
    const rows = rowsOf(flood);
    const zonesIn = list => [...new Set(list.map(r => String(r.zone).trim()))];
    const shown = new Set();
    const groups = [];
    for (const c of [cat, ...CATEGORIES.filter(c => c !== cat && c !== 'not_mapped')]) {
      const group = rows.filter(r => rowCategory(r, backup) === c);
      const zones = zonesIn(group).filter(z => !shown.has(z));
      zones.forEach(z => shown.add(z));
      if (c === cat || zones.length) groups.push({ c, group, zones });
    }
    const [main, ...others] = groups;
    if (isPaperMap(flood)) {
      const zones = main.zones.length ? `Flood zone ${main.zones.join(', ')}` : 'Flood zone';
      const edge = cat === 'high' && flood.source?.edgeNote ? ` ${String(flood.source.edgeNote)}` : '';
      return `${zones}${MEANING[cat](main.group)}${others.map(g => `; also zone ${g.zones.join(', ')}${MEANING[g.c](g.group)}`).join('')}. Source: ${paperMapSource(flood)}.${edge} ${PAPER_MAP_NOTE}`;
    }
    const head = main.zones.length
      ? `${backup ? 'Flood zone' : 'FEMA zone'} ${main.zones.join(', ')}${backup ? BACKUP_NOTE : ''}${MEANING[cat](main.group)}`
      : `${backup ? 'Flood zone' : 'FEMA flood zone'}${backup ? BACKUP_NOTE : ''}${MEANING[cat](main.group)}`;
    return head + others.map(g => `; also zone ${g.zones.join(', ')}${MEANING[g.c](g.group)}`).join('');
  }

  // { category, score, label, cls, overview, overviewCls, detail } for one flood result.
  // label/cls: the grade cards (index.html); overview/overviewCls: the overview fact (parcel-preview).
  function grade(flood) {
    const cat = category(flood);
    const g = GRADES[cat];
    const quiet = cat === 'limited' || cat === 'unavailable';
    const suffix = quiet ? '' : (isPaperMap(flood) && cat !== 'not_mapped' ? PAPER_MAP_SUFFIX : backupSuffix(flood));
    return { category: cat, score: g.score, label: g.label, cls: g.cls, overview: `${g.overview}${suffix}`, overviewCls: g.overviewCls, detail: detail(flood, cat) };
  }

  // ---- Zone shares

  const measured = flood => flood?.available === true && flood?.floodShare?.status === 'measured' && Array.isArray(flood?.floodZones) && flood.floodZones.length > 0;
  const finite = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  // 67 -> "67%", 2.44 -> "2.4%", 0.3 -> "under 1%".
  function pctText(value) {
    const n = finite(value) ?? 0;
    if (n >= 99.95) return 'all';
    if (n < 1) return 'under 1%';
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)}%`;
  }
  const acresText = value => { const n = finite(value) ?? 0; return `${n >= 1 ? n.toFixed(1) : n.toFixed(2)} ac`; };
  function zoneName(entry) {
    const subtype = String(entry?.subtype || '');
    const zone = String(entry?.zone || '').trim();
    if (/FLOODWAY/i.test(subtype)) return `Zone ${zone} floodway`;
    if (isPointTwo(subtype)) return `Zone ${zone} (0.2% annual chance)`;
    return `Zone ${zone}`;
  }
  const onParcel = entry => (pctText(entry.sharePct) === 'all' ? `${zoneName(entry)} on all of the parcel (${acresText(entry.acres)})` : `${zoneName(entry)} on ${pctText(entry.sharePct)} of parcel (${acresText(entry.acres)})`);

  // "Zone A on 67% of parcel (13.8 ac); rest zone X (6.8 ac)", or '' when not measured.
  function shareText(flood) {
    if (!measured(flood)) return '';
    const zones = flood.floodZones.filter(z => z && z.zone);
    const rest = zones.find(z => z.remainder);
    const listed = zones.filter(z => !z.remainder);
    const sfha = listed.filter(z => z.sfha === true);
    const others = listed.filter(z => z.sfha !== true && !(finite(z.sharePct) < 1 && z.edgeOnly));
    const sfhaShare = finite(flood.sfhaSharePct) ?? 0;
    const parts = [];
    if (sfha.length && sfhaShare < 1) {
      const names = [...new Set(sfha.map(z => zoneName(z)))].join(', ');
      parts.push(`${names} only touches the edge of the parcel (${sfhaShare > 0 ? 'under 1%' : 'no measurable area'})`);
    } else {
      parts.push(...sfha.filter(z => !z.edgeOnly).map(onParcel));
    }
    parts.push(...others.map(onParcel));
    if (rest) parts.push(parts.length ? `rest zone ${rest.zone} (${acresText(rest.acres)})` : onParcel(rest));
    else {
      const restPct = finite(flood.floodShare?.restSharePct) ?? 0;
      if (restPct >= 1 && parts.length) {
        parts.push(isBackup(flood) || flood.floodShare?.coverage ? `rest outside mapped high- and moderate-risk areas (${pctText(restPct)})` : `${pctText(restPct)} has no mapped zone`);
      }
    }
    return parts.join('; ');
  }

  // Short form for the overview fact: "67% of parcel", "edge only", or ''. Only for high,
  // moderate and undetermined answers (a minimal or not-mapped answer needs no share).
  function overviewShare(flood) {
    if (!measured(flood)) return '';
    const cat = category(flood);
    if (cat === 'high') {
      const share = finite(flood.sfhaSharePct) ?? 0;
      return share < 1 ? 'edge only' : `${pctText(share) === 'all' ? 'whole parcel' : `${pctText(share)} of parcel`}`;
    }
    if (cat !== 'moderate' && cat !== 'undetermined') return '';
    const share = flood.floodZones.filter(z => !z.remainder && z.category === cat).reduce((sum, z) => sum + (finite(z.sharePct) ?? 0), 0);
    return share < 1 ? 'edge only' : `${pctText(Math.min(100, share)) === 'all' ? 'whole parcel' : `${pctText(Math.min(100, share))} of parcel`}`;
  }

  // The flood factor (0-100) for the buildability score. The second argument is ignored; it was
  // each consumer's own scale before every consumer shared these scores.
  const score = flood => grade(flood).score;

  root.AcresXFlood = {
    BACKUP_PROVIDER, BACKUP_NOTE, LIMITED_LABEL, LIMITED_TEXT, NOT_MAPPED_TEXT, PAPER_MAP_NOTE, PAPER_MAP_SUFFIX, CATEGORIES, GRADES,
    isLimited, isBackup, isPaperMap, backupSuffix, rowCategory, category, detail, grade, score, shareText, overviewShare
  };
})(typeof window !== 'undefined' ? window : globalThis);
