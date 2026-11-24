// Shared reading of the /api/hazards flood result for the page's labels and scores. This file is
// the single source of truth for flood labels and detail text (the categories and the flood score
// are score-core.js rules, read through window.AcresXScoreCore).
// Injected right after score-core.js by maybeInjectUiPolish() in src/index.js; index.html, parcel-preview.js,
// and property-report-v2.js call window.AcresXFlood at render time (index.html and parcel-preview.js
// keep their old behaviour if it has not loaded); the score reads the rules from score-core.js.
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
// change the category or grade().score. shareScore() is the buildability score's flood factor
// when the share was measured (see its comment); screening-refinements.js uses it.
(function (root) {
  // The rules (categories and their scores, the zone-share score) are in score-core.js
  // (window.AcresXScoreCore, injected before this file); this file keeps the labels and text.
  const C = root.AcresXScoreCore;
  if (!C) throw new Error('AcresX: public/score-core.js must load before flood-status.js');
  const FC = C.flood;
  const { BACKUP_PROVIDER, CATEGORIES, isLimited, isBackup, rowCategory, rowsOf } = FC;
  const category = flood => FC.category(flood);
  const LIMITED_LABEL = 'Limited flood data';
  const LIMITED_TEXT = 'Not in a mapped high- or moderate-risk flood area (backup source; FEMA unavailable). Verify with FEMA.';

  const GRADES = {
    high: { score: FC.SCORES.high, label: 'High risk', cls: 'red', overview: 'High-risk flood zone', overviewCls: 'warn' },
    moderate: { score: FC.SCORES.moderate, label: 'Moderate risk', cls: 'amber', overview: 'Moderate flood hazard', overviewCls: 'warn' },
    undetermined: { score: FC.SCORES.undetermined, label: 'Undetermined', cls: 'amber', overview: 'Flood risk not determined', overviewCls: 'warn' },
    minimal: { score: FC.SCORES.minimal, label: 'Minimal', cls: 'green', overview: 'Minimal flood hazard', overviewCls: 'good' },
    not_mapped: { score: FC.SCORES.not_mapped, label: 'Not mapped', cls: 'amber', overview: 'No digital FEMA flood map', overviewCls: 'warn' },
    limited: { score: FC.SCORES.limited, label: LIMITED_LABEL, cls: 'amber', overview: LIMITED_LABEL, overviewCls: 'warn' },
    unavailable: { score: FC.SCORES.unavailable, label: 'Unavailable', cls: 'amber', overview: 'Not verified', overviewCls: 'warn' }
  };
  const NOT_MAPPED_TEXT = 'No digital FEMA flood map (NFHL) covers this parcel. Verify with the county or FEMA.';
  const BACKUP_NOTE = ' (backup source: Esri copy of FEMA data)';
  const PAPER_MAP_NOTE = 'FEMA has no digital flood map here. Verify with the county or FEMA.';
  const PAPER_MAP_SUFFIX = ' (county copy of FEMA paper map)';

  const backupSuffix = flood => (isBackup(flood) ? ' (backup source)' : '');
  const isPaperMap = flood => flood?.source?.digitalFemaMap === false;
  const paperMapSource = flood => String(flood?.source?.label || flood?.source?.provider || 'county copy of the FEMA paper map');

  const upper = v => String(v ?? '').trim().toUpperCase();
  const isPointTwo = subtype => /0\.2\s*(%|PCT|PERCENT)/i.test(String(subtype || ''));

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

  const measured = flood => FC.shareMeasured(flood);
  const finite = C.finite;
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

  // The flood factor (0-100) for the buildability score (score-core.js flood.score). The second
  // argument is ignored; it was each consumer's own scale before every consumer shared these scores.
  const score = flood => FC.score(flood);

  // The flood factor when FEMA zone shares were measured, else null (callers keep score()); the
  // rule is score-core.js flood.shareScore (only high-risk SFHA answers change, by their share).
  const shareScore = flood => FC.shareScore(flood);

  root.AcresXFlood = {
    BACKUP_PROVIDER, BACKUP_NOTE, LIMITED_LABEL, LIMITED_TEXT, NOT_MAPPED_TEXT, PAPER_MAP_NOTE, PAPER_MAP_SUFFIX, CATEGORIES, GRADES,
    isLimited, isBackup, isPaperMap, backupSuffix, rowCategory, category, detail, grade, score, shareScore, shareText, overviewShare
  };
})(typeof window !== 'undefined' ? window : globalThis);
