// Offline tests for scripts/validation-alerts.mjs (run comparison and issue alert rules). Pure
// functions on report objects; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS } from '../scripts/validate-county.mjs';
import {
  layerOutcome, comparable, compareRuns, brokenByLayer, evaluateAlert, escapeMd, issueTitle, renderIssueBody,
  renderChanges, renderRecoveredComment, buildAlert, parseArgs, ALERT_MIN_PARCELS
} from '../scripts/validation-alerts.mjs';

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error('network disabled in tests'); }; });
afterEach(() => { globalThis.fetch = realFetch; });

const BASE = 'https://acresx.test';
const IDS = Array.from({ length: 12 }, (_, i) => `PIN${String(i + 1).padStart(2, '0')}`);

// A report shaped like validate-county.mjs output. broken: { 'PIN01': { soil: 'timeout after 30s' } }.
// A layer value of { mismatch: true } makes a mismatch; 'unavailable' makes an unavailable cell;
// a parcel layer failure marks the rest skipped, like the harness.
function report({ broken = {}, ids = IDS, discovered = false, baseUrl = BASE, county = 'Kootenai' } = {}) {
  const results = ids.map(parcelId => {
    const layers = {};
    const want = broken[parcelId] || {};
    for (const { key } of LAYERS) {
      const w = want[key];
      if (w === 'unavailable') layers[key] = { status: 'unavailable', detail: 'not available', values: {} };
      else if (w && typeof w === 'object' && w.mismatch) layers[key] = { status: 'ok', detail: 'ok', values: {}, mismatches: [{ key: `${key}.code`, layer: key, expected: 'Rural', actual: 'AG' }] };
      else if (w) layers[key] = { status: 'error', detail: w, values: {} };
      else layers[key] = { status: 'ok', detail: 'ok', values: {} };
    }
    if (layers.parcel.status === 'error') for (const { key } of LAYERS) if (key !== 'parcel') layers[key] = { status: 'skipped', detail: 'parcel lookup failed', values: {} };
    return { parcelId, label: '', why: '', layers };
  });
  return { county, state: 'ID', baseUrl, startedAt: '2026-10-27T13:23:00.000Z', discovered: discovered || undefined, results, summary: {} };
}
const fail = (ids, layer, detail = 'timeout after 30s') => Object.fromEntries(ids.map(id => [id, { [layer]: detail }]));

test('layerOutcome treats error and mismatch as broken', () => {
  assert.equal(layerOutcome({ status: 'error' }), 'broken');
  assert.equal(layerOutcome({ status: 'ok', mismatches: [{}] }), 'broken');
  assert.equal(layerOutcome({ status: 'ok' }), 'ok');
  assert.equal(layerOutcome({ status: 'unavailable' }), 'unavailable');
  assert.equal(layerOutcome({ status: 'skipped' }), 'skipped');
  assert.equal(layerOutcome(undefined), 'absent');
});

test('comparison classifies newly broken, still broken, recovered and newly unavailable cells', () => {
  const prev = report({ broken: { PIN01: { soil: 'timeout after 30s', flood: 'HTTP 502' }, PIN02: { wells: 'HTTP 502' }, PIN05: { parcel: 'HTTP 502' } } });
  const curr = report({ broken: { PIN01: { soil: 'timeout after 30s' }, PIN03: { slope: 'timeout after 30s', zoning: { mismatch: true } }, PIN04: { wetlands: 'unavailable' }, PIN05: { soil: 'NWI down' } } });
  const c = compareRuns(prev, curr);
  assert.equal(c.comparable, true);
  const keys = list => list.map(x => `${x.parcelId}:${x.layer}`).sort();
  assert.deepEqual(keys(c.stillBroken), ['PIN01:soil']);
  // PIN05 soil was skipped (parcel failed) and is now an error: newly broken.
  assert.deepEqual(keys(c.newlyBroken), ['PIN03:slope', 'PIN03:zoning', 'PIN05:soil']);
  assert.deepEqual(keys(c.recovered), ['PIN01:flood', 'PIN02:wells', 'PIN05:parcel']);
  assert.deepEqual(keys(c.newlyUnavailable), ['PIN04:wetlands']);
  const zoning = c.newlyBroken.find(x => x.layer === 'zoning');
  assert.equal(zoning.now, 'mismatch');
  assert.match(zoning.detail, /zoning\.code: expected "Rural", got "AG"/);
  // A recovered cell carries the old failure's detail.
  assert.equal(c.recovered.find(x => x.layer === 'wells').detail, 'HTTP 502');
});

test('a parcel missing from the previous run counts as newly broken; discovery and other base URLs are not baselines', () => {
  const curr = report({ broken: { PIN12: { soil: 'x' } } });
  const prev = report({ ids: IDS.slice(0, 11) });
  assert.deepEqual(compareRuns(prev, curr).newlyBroken.map(x => x.parcelId), ['PIN12']);
  assert.equal(compareRuns(prev, curr).newlyBroken[0].was, 'n/a');

  assert.equal(comparable(null, curr).ok, false);
  assert.match(comparable(report({ discovered: true }), curr).reason, /discovery/);
  assert.match(comparable(report({ baseUrl: 'https://pr-3.test' }), curr).reason, /base URL/);
  assert.match(comparable(report({ county: 'Gallatin' }), curr).reason, /another county/);
  assert.equal(comparable({ nope: true }, curr).ok, false);

  const noBase = compareRuns(report({ discovered: true, broken: { PIN12: { soil: 'x' } } }), curr);
  assert.equal(noBase.comparable, false);
  assert.equal(noBase.stillBroken.length, 0);
  assert.equal(noBase.newlyBroken.length, 1);
});

test('threshold: one run with 3 parcels broken on a layer alerts at once', () => {
  const curr = report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'slope') });
  const d = evaluateAlert(null, curr);
  assert.equal(ALERT_MIN_PARCELS, 3);
  assert.equal(d.alerting, true);
  assert.equal(d.alertLayers.length, 1);
  assert.equal(d.alertLayers[0].layer, 'slope');
  assert.equal(d.alertLayers[0].count, 3);
  assert.equal(d.alertLayers[0].total, 12);
  assert.match(d.alertLayers[0].reason, /3 of 12 parcels in this run/);
});

test('threshold: transient single failures never alert', () => {
  // Two parcels on a non-parcel layer: below the threshold, even two runs in a row.
  const two = report({ broken: fail(['PIN01', 'PIN02'], 'slope') });
  let d = evaluateAlert(two, two);
  assert.equal(d.alerting, false);
  assert.equal(d.aboveThreshold, false);
  assert.equal(d.belowThreshold[0].layer, 'slope');
  // One parcel lookup failing once: above the threshold but waits for a second run.
  const one = report({ broken: fail(['PIN04'], 'parcel', 'HTTP 502: Too many requests.') });
  d = evaluateAlert(report(), one);
  assert.equal(d.alerting, false);
  assert.equal(d.aboveThreshold, true);
  assert.equal(d.watchLayers[0].layer, 'parcel');
  // Without a comparable previous run, a single parcel failure also waits.
  assert.equal(evaluateAlert(null, one).alerting, false);
  assert.equal(evaluateAlert(report({ discovered: true, broken: fail(['PIN04'], 'parcel') }), one).alerting, false);
});

test('threshold: the parcel lookup failing in two consecutive runs alerts, even for different parcels', () => {
  const prev = report({ broken: fail(['PIN04'], 'parcel') });
  const curr = report({ broken: fail(['PIN07'], 'parcel') });
  const d = evaluateAlert(prev, curr);
  assert.equal(d.alerting, true);
  assert.equal(d.alertLayers[0].layer, 'parcel');
  assert.equal(d.alertLayers[0].reason, 'failed in two consecutive runs');
  assert.equal(d.alertLayers[0].previousCount, 1);
  // Three parcel lookups failing in one run alert at once.
  assert.equal(evaluateAlert(null, report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'parcel') })).alerting, true);
});

test('threshold: mismatches count as broken', () => {
  const mm = Object.fromEntries(['PIN01', 'PIN02', 'PIN03'].map(id => [id, { zoning: { mismatch: true } }]));
  const d = evaluateAlert(null, report({ broken: mm }));
  assert.equal(d.alerting, true);
  assert.equal(d.alertLayers[0].parcels[0].status, 'mismatch');
  assert.equal(brokenByLayer(report({ broken: mm })).get('zoning').length, 3);
});

test('recovery: nothing above the threshold closes; a waiting parcel failure keeps the issue open', () => {
  const recovered = buildAlert(report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'slope') }), report({ broken: fail(['PIN01'], 'slope') }));
  assert.equal(recovered.alerting, false);
  assert.equal(recovered.aboveThreshold, false);
  assert.equal(recovered.changed, true);
  assert.match(recovered.recoveredComment, /^Recovered: no layer meets the alert threshold/);
  assert.match(recovered.recoveredComment, /Slope grid: 1 of 12 \(PIN01\)/);

  const waiting = buildAlert(report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'slope') }), report({ broken: fail(['PIN09'], 'parcel') }));
  assert.equal(waiting.alerting, false);
  assert.equal(waiting.aboveThreshold, true);

  const steady = buildAlert(report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'slope') }), report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'slope') }));
  assert.equal(steady.alerting, true);
  assert.equal(steady.changed, false, 'a steady failure does not comment again');
});

test('issue title and body: table of broken layers, links, no mentions', () => {
  const curr = report({ broken: { ...fail(['PIN01', 'PIN02', 'PIN03'], 'slope'), PIN05: { flood: 'HTTP 502' } } });
  const links = { runUrl: 'https://github.com/o/r/actions/runs/1', resultsUrl: 'https://github.com/o/r/blob/validation-results/latest/kootenai.md', historyUrl: 'https://github.com/o/r/tree/validation-results/history' };
  const alert = buildAlert(null, curr, links);
  assert.equal(alert.title, 'Validation: Kootenai — 1 layer broken');
  assert.equal(issueTitle(curr, { alertLayers: [{}, {}, {}] }), 'Validation: Kootenai — 3 layers broken');
  assert.match(alert.body, /\| Slope grid \| 3 of 12 \| broken for 3 of 12 parcels in this run \| PIN01 \| error \| timeout after 30s \|/);
  assert.match(alert.body, /\|  \|  \|  \| PIN02 \| error \|/);
  assert.match(alert.body, /- Run: https:\/\/github.com\/o\/r\/actions\/runs\/1/);
  assert.match(alert.body, /- Latest results: https:\/\/github.com\/o\/r\/blob\/validation-results\/latest\/kootenai.md/);
  assert.match(alert.body, /Flood: 1 of 12 \(PIN05\)/);
  assert.match(alert.body, /No comparison: no previous run/);
  assert.doesNotMatch(alert.body, /@[A-Za-z]/);
});

test('escapeMd neutralises tables, markdown, HTML, mentions and issue links in upstream text', () => {
  const nasty = 'Bad | gateway <script>alert(1)</script> @cole793 see #12 `x` [link](http://e) *b* \\ end\nnext';
  const out = escapeMd(nasty, 500);
  assert.doesNotMatch(out, /(^|[^\\])\|/, 'pipes are escaped');
  assert.doesNotMatch(out, /[<>\n]/);
  assert.doesNotMatch(out, /@c/);
  assert.match(out, /@​cole793/);
  assert.match(out, /#​12/);
  assert.match(out, /\\\[link\\\]\\\(http:\/\/e\\\)/);
  assert.match(out, /\\`x\\`/);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /\\\\ end next$/);
  assert.equal(escapeMd('x'.repeat(300)).length, 200);

  const curr = report({ broken: fail(['PIN01', 'PIN02', 'PIN03'], 'soil', 'oops | @someone #3 <b>') });
  const body = renderIssueBody(curr, evaluateAlert(null, curr), compareRuns(null, curr));
  for (const line of body.split('\n').filter(l => l.startsWith('| Soil') || l.startsWith('|  |'))) {
    assert.equal(line.split(/(?<!\\)\|/).length, 8, `row keeps 6 cells: ${line}`);
  }
  assert.doesNotMatch(body, /@someone/);
  assert.doesNotMatch(renderRecoveredComment(curr, evaluateAlert(null, curr)), /@someone/);
});

test('changes markdown lists sections and says when there is no baseline', () => {
  const prev = report({ broken: fail(['PIN01'], 'wells', 'HTTP 502') });
  const curr = report({ broken: fail(['PIN02'], 'soil') });
  const md = renderChanges(curr, compareRuns(prev, curr));
  assert.match(md, /newly broken 1, still broken 0, recovered 1, newly unavailable 0/);
  assert.match(md, /### Newly broken\n\n\| Parcel \| Layer \| Was \| Now \| Detail \|\n\|---\|---\|---\|---\|---\|\n\| PIN02 \| Soil \| ok \| error \| timeout after 30s \|/);
  assert.match(md, /### Recovered[\s\S]*\| PIN01 \| Wells \| error \| ok \| HTTP 502 \|/);
  assert.doesNotMatch(md, /### Still broken/);
  assert.match(renderChanges(curr, compareRuns(null, curr)), /No comparison: no previous run/);
});

test('alerts CLI arguments are validated', () => {
  assert.throws(() => parseArgs(['--county', 'Koot enai', '--current', 'x']), /--county/);
  assert.throws(() => parseArgs(['--county', 'kootenai']), /--current/);
  assert.throws(() => parseArgs(['--county', 'kootenai', '--current', 'x', '--run-url', 'javascript:alert(1)']), /https URL/);
  assert.throws(() => parseArgs(['--county', 'kootenai', '--current', 'x', '--bogus']), /Unknown argument/);
  assert.equal(parseArgs(['--county', 'kootenai', '--current', 'x', '--run-url', 'https://github.com/o/r/actions/runs/1']).runUrl, 'https://github.com/o/r/actions/runs/1');
});
