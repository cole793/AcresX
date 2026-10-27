#!/usr/bin/env node
// Compares a county validation report with the previous run's report and decides whether the
// county needs a GitHub issue alert. Pure file in, files out: it never calls the network or
// GitHub. The workflow's `alert` job reads the decision and runs `gh` (see validation/README.md).
//
//   node scripts/validation-alerts.mjs --county kootenai --current validation-results/kootenai.json \
//     [--previous previous/kootenai.json] [--out validation-results] [--run-url URL] [--results-url URL]
//
// Writes <out>/<county>-changes.md (what changed since the previous run) and
// <out>/<county>-alert.json (the alert decision plus the rendered issue title, body and comments).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { LAYERS, cellStatus } from './validate-county.mjs';

// Alert rules (documented in validation/README.md, "Alerts").
export const ALERT_MIN_PARCELS = 3;
export const ALERT_LABEL = 'validation-alert';
const MAX_DETAIL = 200;
const MAX_BODY = 60000; // GitHub's limit is 65536 characters.

const LABELS = Object.fromEntries(LAYERS.map(l => [l.key, l.label]));
const layerLabel = key => LABELS[key] || key;

// One cell's state for comparison. error and mismatch are both "broken".
export function layerOutcome(layer) {
  if (!layer) return 'absent';
  const s = cellStatus(layer);
  if (s === 'error' || s === 'mismatch') return 'broken';
  if (s === 'ok' || s === 'unavailable' || s === 'skipped') return s;
  return 'absent';
}

// What a cell's failure was, in one line.
export function failureDetail(layer) {
  if (!layer) return '';
  if (layer.mismatches?.length) {
    return layer.mismatches.map(m => `${m.key}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`).join('; ');
  }
  return String(layer.detail ?? '');
}

// A previous report is only a baseline when it checked the same county's saved parcels against
// the same base URL. A discovery run or a preview-URL run is a different sample or a different site.
export function comparable(previous, current) {
  if (!previous || typeof previous !== 'object' || !Array.isArray(previous.results)) return { ok: false, reason: 'no previous run' };
  if (previous.discovered) return { ok: false, reason: 'the previous run was a discovery sample' };
  if (current?.discovered) return { ok: false, reason: 'this run is a discovery sample' };
  if (String(previous.county || '').toLowerCase() !== String(current?.county || '').toLowerCase()) return { ok: false, reason: 'the previous run was for another county' };
  if ((previous.baseUrl || '') !== (current?.baseUrl || '')) return { ok: false, reason: `the previous run used another base URL (${previous.baseUrl || 'none'})` };
  return { ok: true, reason: null };
}

const resultsById = report => new Map((report?.results || []).map(r => [String(r.parcelId), r]));

// Per parcel x layer transitions between two runs.
//   newlyBroken:      was not broken (ok, unavailable, skipped, or the parcel was not in the previous run) -> error/mismatch
//   stillBroken:      error/mismatch in both runs
//   recovered:        error/mismatch -> ok or unavailable
//   newlyUnavailable: ok -> unavailable
// Without a comparable previous run every broken cell counts as newly broken.
export function compareRuns(previous, current) {
  const base = comparable(previous, current);
  const prev = base.ok ? resultsById(previous) : new Map();
  const changes = { comparable: base.ok, reason: base.reason, newlyBroken: [], stillBroken: [], recovered: [], newlyUnavailable: [] };
  for (const r of current?.results || []) {
    const before = prev.get(String(r.parcelId));
    for (const { key } of LAYERS) {
      const now = layerOutcome(r.layers?.[key]);
      const was = layerOutcome(before?.layers?.[key]);
      const entry = { parcelId: String(r.parcelId), layer: key, was: before ? cellStatus(before.layers?.[key]) : 'n/a', now: cellStatus(r.layers?.[key]), detail: failureDetail(r.layers?.[key]) };
      if (now === 'broken') (was === 'broken' ? changes.stillBroken : changes.newlyBroken).push(entry);
      else if (was === 'broken' && (now === 'ok' || now === 'unavailable')) changes.recovered.push({ ...entry, detail: failureDetail(before.layers?.[key]) });
      else if (was === 'ok' && now === 'unavailable') changes.newlyUnavailable.push({ ...entry, detail: String(r.layers?.[key]?.detail ?? '') });
    }
  }
  return changes;
}

// layer key -> [{ parcelId, status, detail }] for every broken cell in a report.
export function brokenByLayer(report) {
  const out = new Map();
  for (const r of report?.results || []) for (const { key } of LAYERS) {
    const layer = r.layers?.[key];
    if (layerOutcome(layer) !== 'broken') continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ parcelId: String(r.parcelId), status: cellStatus(layer), detail: failureDetail(layer) });
  }
  return out;
}

// A layer "meets the threshold" in a run when it is broken for >= minParcels parcels, or, for the
// parcel lookup, for any parcel.
const meetsThreshold = (key, count, minParcels) => count >= minParcels || (key === 'parcel' && count > 0);

// Alert decision for one county. A layer alerts when it meets the threshold in this run AND
// either it is broken for >= minParcels parcels in this run, or it also met the threshold in the
// previous comparable run (two consecutive runs). So one parcel's lookup failing once does not
// alert; failing in two runs in a row does. The issue closes when no layer meets the threshold.
export function evaluateAlert(previous, current, { minParcels = ALERT_MIN_PARCELS } = {}) {
  const now = brokenByLayer(current);
  const base = comparable(previous, current);
  const before = base.ok ? brokenByLayer(previous) : new Map();
  const total = (current?.results || []).length;
  const alertLayers = [], watchLayers = [], belowThreshold = [];
  for (const { key, label } of LAYERS) {
    const parcels = now.get(key);
    if (!parcels) continue;
    const prevCount = before.get(key)?.length || 0;
    const entry = { layer: key, label, count: parcels.length, total, previousCount: base.ok ? prevCount : null, parcels };
    if (!meetsThreshold(key, parcels.length, minParcels)) { belowThreshold.push(entry); continue; }
    if (parcels.length >= minParcels) alertLayers.push({ ...entry, reason: `broken for ${parcels.length} of ${total} parcels in this run` });
    else if (meetsThreshold(key, prevCount, minParcels)) alertLayers.push({ ...entry, reason: 'failed in two consecutive runs' });
    else watchLayers.push({ ...entry, reason: 'first failing run; alerts if it fails again in the next run' });
  }
  return {
    alerting: alertLayers.length > 0,
    // Above the threshold at all (alerting or waiting for a second run). An open issue stays open
    // while this is true and closes when it is false.
    aboveThreshold: alertLayers.length + watchLayers.length > 0,
    alertLayers, watchLayers, belowThreshold, minParcels, comparable: base.ok, reason: base.reason
  };
}

// --- markdown --------------------------------------------------------------------------------

// Safe for a markdown table cell in an issue: one line, markdown punctuation escaped, HTML
// neutralised, and @ / # broken with a zero-width space so nothing mentions a user or links an
// issue. Error text comes from upstream servers, so treat it as untrusted.
export function escapeMd(value, max = MAX_DETAIL) {
  let s = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()|~!])/g, '\\$1')
    .replace(/@/g, '@​').replace(/#/g, '#​');
}

const countyName = report => String(report?.county || '').trim() || 'County';

export function issueTitle(report, decision) {
  const n = decision.alertLayers.length;
  return `Validation: ${countyName(report)} — ${n} layer${n === 1 ? '' : 's'} broken`;
}

function linkLines(links = {}) {
  const lines = [];
  if (links.runUrl) lines.push(`- Run: ${links.runUrl}`);
  if (links.resultsUrl) lines.push(`- Latest results: ${links.resultsUrl}`);
  if (links.changesUrl) lines.push(`- Changes since the previous run: ${links.changesUrl}`);
  if (links.historyUrl) lines.push(`- Every run: ${links.historyUrl}`);
  return lines;
}

function layerTable(layers) {
  const lines = ['| Layer | Parcels broken | Why it alerts | Parcel | Status | Detail |', '|---|---|---|---|---|---|'];
  for (const l of layers) {
    l.parcels.forEach((p, i) => lines.push(`| ${i ? '' : escapeMd(l.label)} | ${i ? '' : `${l.count} of ${l.total}`} | ${i ? '' : escapeMd(l.reason || '')} | ${escapeMd(p.parcelId, 40)} | ${escapeMd(p.status, 20)} | ${escapeMd(p.detail)} |`));
  }
  return lines;
}

function belowLines(decision) {
  const rest = [...decision.watchLayers, ...decision.belowThreshold];
  if (!rest.length) return [];
  return ['', 'Also failing, below the alert threshold or waiting for a second run:', '',
    ...rest.map(l => `- ${escapeMd(l.label)}: ${l.count} of ${l.total} (${l.parcels.map(p => escapeMd(p.parcelId, 40)).join(', ')})`)];
}

const cap = s => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)}\n\n(Truncated; see the latest results.)\n` : s);

export function renderIssueBody(report, decision, changes, links = {}) {
  const lines = [
    `The scheduled county validation for ${escapeMd(countyName(report))}, ${escapeMd(report?.state || '')} found broken layers (run ${escapeMd(report?.startedAt || '')}).`,
    '',
    ...linkLines(links),
    '',
    '## Broken layers',
    '',
    ...layerTable(decision.alertLayers),
    ...belowLines(decision),
    '',
    `Alert rule: a layer alerts when it is broken (error or mismatch) for at least ${decision.minParcels} parcels in one run, or when it meets the threshold (${decision.minParcels} parcels, or any parcel for the parcel lookup) in two consecutive runs. This issue closes when no layer meets the threshold.`,
    '',
    ...changesLines(changes, { heading: '## Changes since the previous run' }),
    'Results are screening checks of the deployed site against county and state servers. Verify a failure in the results before changing code.'
  ];
  return cap(lines.join('\n') + '\n');
}

export function renderUpdateComment(report, decision, changes, links = {}) {
  const lines = [
    `Still broken in run ${escapeMd(report?.startedAt || '')}: ${decision.alertLayers.map(l => `${escapeMd(l.label)} ${l.count} of ${l.total}`).join(', ') || 'none alerting'}.`,
    '',
    ...linkLines(links),
    '',
    ...layerTable(decision.alertLayers),
    ...belowLines(decision),
    '',
    ...changesLines(changes, { heading: '## Changes since the previous run' })
  ];
  return cap(lines.join('\n') + '\n');
}

export function renderRecoveredComment(report, decision, links = {}) {
  const lines = [
    `Recovered: no layer meets the alert threshold in run ${escapeMd(report?.startedAt || '')}. Closing this issue.`,
    '',
    ...linkLines(links),
    ...belowLines(decision)
  ];
  return cap(lines.join('\n') + '\n');
}

const SECTIONS = [
  ['newlyBroken', 'Newly broken'],
  ['stillBroken', 'Still broken'],
  ['recovered', 'Recovered'],
  ['newlyUnavailable', 'Newly unavailable']
];

function changesLines(changes, { heading = '# Changes since the previous run' } = {}) {
  const lines = [heading, ''];
  if (!changes.comparable) lines.push(`No comparison: ${escapeMd(changes.reason || 'no previous run')}. Every broken layer is listed as newly broken.`, '');
  const counts = SECTIONS.map(([k, label]) => `${label.toLowerCase()} ${changes[k].length}`).join(', ');
  lines.push(`Parcel x layer cells: ${counts}.`, '');
  for (const [k, label] of SECTIONS) {
    if (!changes[k].length) continue;
    lines.push(`### ${label}`, '', '| Parcel | Layer | Was | Now | Detail |', '|---|---|---|---|---|');
    for (const c of changes[k]) lines.push(`| ${escapeMd(c.parcelId, 40)} | ${escapeMd(layerLabel(c.layer))} | ${escapeMd(c.was, 20)} | ${escapeMd(c.now, 20)} | ${escapeMd(c.detail)} |`);
    lines.push('');
  }
  return lines;
}

export function renderChanges(report, changes) {
  return [`# Changes since the previous run: ${escapeMd(countyName(report))}, ${escapeMd(report?.state || '')}`, '',
    `- Run: ${escapeMd(report?.startedAt || '')}`, '', ...changesLines(changes, { heading: '## Cells' })].join('\n') + '\n';
}

// Everything the workflow's alert job needs, with no logic left for the shell beyond
// "is an issue open?".
export function buildAlert(previous, current, links = {}, options = {}) {
  const changes = compareRuns(previous, current);
  const decision = evaluateAlert(previous, current, options);
  return {
    county: countyName(current),
    alerting: decision.alerting,
    aboveThreshold: decision.aboveThreshold,
    // Comment on an already-open issue only when cells broke or recovered, so a steady failure
    // doesn't comment every day (the open issue is the signal).
    changed: !changes.comparable || changes.newlyBroken.length > 0 || changes.recovered.length > 0,
    title: issueTitle(current, decision),
    body: renderIssueBody(current, decision, changes, links),
    updateComment: renderUpdateComment(current, decision, changes, links),
    recoveredComment: renderRecoveredComment(current, decision, links),
    decision,
    changes
  };
}

// --- CLI -------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { county: '', current: '', previous: '', out: 'validation-results', runUrl: '', resultsUrl: '', changesUrl: '', historyUrl: '' };
  const flags = { '--county': 'county', '--current': 'current', '--previous': 'previous', '--out': 'out', '--run-url': 'runUrl', '--results-url': 'resultsUrl', '--changes-url': 'changesUrl', '--history-url': 'historyUrl' };
  for (let i = 0; i < argv.length; i++) {
    const key = flags[argv[i]];
    if (!key) throw new Error(`Unknown argument: ${argv[i]}`);
    args[key] = argv[++i] ?? '';
  }
  if (!/^[a-z0-9-]+$/.test(args.county)) throw new Error('--county is required (lowercase file name, e.g. kootenai).');
  if (!args.current) throw new Error('--current is required.');
  for (const [flag, k] of Object.entries(flags)) if (k.endsWith('Url') && args[k] && !/^https:\/\/[^\s<>()]+$/.test(args[k])) throw new Error(`${flag} must be an https URL.`);
  return args;
}

async function readJson(file) {
  if (!file) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; console.error(`could not read ${file}: ${error.message}`); return null; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const current = await readJson(args.current);
  if (!current) throw new Error(`No current report at ${args.current}.`);
  const previous = await readJson(args.previous);
  const links = { runUrl: args.runUrl, resultsUrl: args.resultsUrl, changesUrl: args.changesUrl, historyUrl: args.historyUrl };
  const alert = buildAlert(previous, current, links);
  await mkdir(args.out, { recursive: true });
  await writeFile(path.join(args.out, `${args.county}-changes.md`), renderChanges(current, alert.changes));
  await writeFile(path.join(args.out, `${args.county}-alert.json`), JSON.stringify(alert, null, 2) + '\n');
  console.error(`${args.county}: alerting=${alert.alerting} aboveThreshold=${alert.aboveThreshold} changed=${alert.changed} (${alert.changes.reason || 'compared with the previous run'})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
}
