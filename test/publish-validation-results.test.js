// Offline tests for scripts/publish-validation-results.sh, the per-county push to the
// validation-results branch that county-validation.yml runs in each matrix leg. The "remote" is a
// local bare repository in a temp directory; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/validation-alerts.mjs';

const execFile = promisify(execFileCb);
const SCRIPT = fileURLToPath(new URL('../scripts/publish-validation-results.sh', import.meta.url));
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'
};

let dir;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, HOME: dir } }).trim();

// A bare "origin" and a clone with one commit on main (like actions/checkout leaves it).
function makeClone(name) {
  const clone = path.join(dir, name);
  git(dir, 'clone', '-q', path.join(dir, 'origin.git'), clone);
  return clone;
}

function writeResults(name, county, { failed = 0, discovered = false, runId, extras = true } = {}) {
  const out = path.join(dir, name);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${county}.json`), JSON.stringify({ county, discovered, summary: { failed } }) + '\n');
  writeFileSync(path.join(out, `${county}.md`), `# ${county}\n`);
  if (extras) {
    writeFileSync(path.join(out, `${county}-changes.md`), `changes ${county}\n`);
    writeFileSync(path.join(out, `${county}-alert.json`), JSON.stringify({ runId, alerting: failed > 0 }) + '\n');
  }
  if (discovered) writeFileSync(path.join(out, `${county}-discovered.json`), '{"picks":[]}\n');
  return out;
}

function publish(cwd, env) {
  return execFile('bash', [SCRIPT], {
    cwd, encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, HOME: dir, RETRY_SECONDS: '0', DATE: '2026-11-11', ...env }
  });
}

const show = (ref, file) => git(path.join(dir, 'origin.git'), 'show', `${ref}:${file}`);
const files = ref => git(path.join(dir, 'origin.git'), 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean).sort();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'acresx-publish-'));
  git(dir, 'init', '-q', '--bare', 'origin.git');
  const seed = path.join(dir, 'seed');
  git(dir, 'init', '-q', '-b', 'main', seed);
  writeFileSync(path.join(seed, 'README.md'), 'main branch\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'push', '-q', path.join(dir, 'origin.git'), 'main');
  git(path.join(dir, 'origin.git'), 'symbolic-ref', 'HEAD', 'refs/heads/main');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('starts the branch as an orphan and publishes latest/ and history/', async () => {
  const clone = makeClone('leg');
  const results = writeResults('out', 'kootenai', { runId: '101' });
  const { stdout } = await publish(clone, { COUNTY: 'kootenai', RESULTS_DIR: results, RUN_ID: '101' });
  assert.match(stdout, /pushed results/);
  assert.deepEqual(files('validation-results'), [
    'history/2026-11-11/kootenai-101.json',
    'latest/kootenai-alert.json', 'latest/kootenai-changes.md', 'latest/kootenai.json', 'latest/kootenai.md'
  ]);
  assert.equal(JSON.parse(show('validation-results', 'latest/kootenai-alert.json')).runId, '101');
  assert.equal(git(path.join(dir, 'origin.git'), 'log', '--format=%s', 'validation-results'), 'Validation kootenai 2026-11-11 run 101: 0 failed');
  // Shares no history with main, and main is untouched.
  assert.equal(git(path.join(dir, 'origin.git'), 'rev-list', '--count', 'validation-results'), '1');
  assert.deepEqual(files('main'), ['README.md']);
});

test('legs of the same run pushing at the same time all land (rebuild and retry, no force)', async () => {
  const counties = ['kootenai', 'spokane', 'stevens', 'gallatin', 'yellowstone'];
  // Seed the branch so every leg races on an existing tip.
  await publish(makeClone('seed-leg'), { COUNTY: 'kootenai', RESULTS_DIR: writeResults('seed-out', 'kootenai', { runId: '100' }), RUN_ID: '100' });
  await Promise.all(counties.map(county => publish(makeClone(`leg-${county}`), {
    COUNTY: county, RESULTS_DIR: writeResults(`out-${county}`, county, { runId: '200', failed: county === 'gallatin' ? 1 : 0 }), RUN_ID: '200', ATTEMPTS: '20'
  })));
  const all = files('validation-results');
  for (const county of counties) {
    assert.ok(all.includes(`latest/${county}.json`), county);
    assert.ok(all.includes(`history/2026-11-11/${county}-200.json`), county);
  }
  assert.ok(all.includes('history/2026-11-11/kootenai-100.json'), 'earlier run kept');
  const log = git(path.join(dir, 'origin.git'), 'log', '--format=%s', 'validation-results').split('\n');
  assert.equal(log.length, 6);
  assert.ok(log.includes('Validation gallatin 2026-11-11 run 200: 1 failed'));
});

test('a rejected push is retried on the new tip', async () => {
  // A pre-receive hook that refuses the first push, the way a non-fast-forward rejection does.
  const hook = path.join(dir, 'origin.git', 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\nif [ ! -f "${dir}/rejected-once" ]; then touch "${dir}/rejected-once"; echo "rejected for test" >&2; exit 1; fi\n`);
  chmodSync(hook, 0o755);
  const { stdout } = await publish(makeClone('leg'), { COUNTY: 'spokane', RESULTS_DIR: writeResults('out', 'spokane', { runId: '7' }), RUN_ID: '7' });
  assert.match(stdout, /push rejected \(attempt 1 of 5\)/);
  assert.match(stdout, /pushed results to validation-results \(attempt 2\)/);
  assert.ok(files('validation-results').includes('latest/spokane.json'));
});

test('gives up with an error after the last attempt', async () => {
  const hook = path.join(dir, 'origin.git', 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  await assert.rejects(
    publish(makeClone('leg'), { COUNTY: 'spokane', RESULTS_DIR: writeResults('out', 'spokane', { runId: '7' }), RUN_ID: '7', ATTEMPTS: '2' }),
    error => /Could not push spokane results to validation-results after 2 attempts/.test(error.stdout)
  );
});

test('a missing report is a warning and publishes nothing', async () => {
  const empty = path.join(dir, 'empty');
  mkdirSync(empty);
  const { stdout } = await publish(makeClone('leg'), { COUNTY: 'stevens', RESULTS_DIR: empty, RUN_ID: '9' });
  assert.match(stdout, /::warning::No results for stevens/);
  assert.equal(git(path.join(dir, 'origin.git'), 'branch', '--list', 'validation-results'), '');
});

test('discovery runs never replace latest/<county>.json and publish no alert decision', async () => {
  await publish(makeClone('leg1'), { COUNTY: 'kootenai', RESULTS_DIR: writeResults('out1', 'kootenai', { runId: '1', failed: 2 }), RUN_ID: '1' });
  const discover = writeResults('out2', 'kootenai', { runId: '2', discovered: true, failed: 5 });
  await publish(makeClone('leg2'), { COUNTY: 'kootenai', RESULTS_DIR: discover, RUN_ID: '2' });
  assert.equal(JSON.parse(show('validation-results', 'latest/kootenai.json')).summary.failed, 2);
  assert.equal(JSON.parse(show('validation-results', 'latest/kootenai-alert.json')).runId, '1');
  const all = files('validation-results');
  for (const f of ['latest/kootenai-discover-report.json', 'latest/kootenai-discover-report.md', 'latest/kootenai-discovered.json', 'history/2026-11-11/kootenai-2-discover.json']) {
    assert.ok(all.includes(f), f);
  }
  assert.match(git(path.join(dir, 'origin.git'), 'log', '-1', '--format=%s', 'validation-results'), /run 2 \(discover\): 5 failed/);
});

test('rejects invalid county names and run ids', async () => {
  const clone = makeClone('leg');
  const results = writeResults('out', 'kootenai', { runId: '1' });
  await assert.rejects(publish(clone, { COUNTY: '../main', RESULTS_DIR: results, RUN_ID: '1' }), /Invalid county name/);
  await assert.rejects(publish(clone, { COUNTY: 'kootenai', RESULTS_DIR: results, RUN_ID: '1;x' }), /RUN_ID must be digits/);
});

test('only publishes to validation-results; other branches need test mode, main and master never', async () => {
  const clone = makeClone('leg');
  const results = writeResults('out', 'kootenai', { runId: '1' });
  const run = env => publish(clone, { COUNTY: 'kootenai', RESULTS_DIR: results, RUN_ID: '1', ...env });
  await assert.rejects(run({ BRANCH: 'other-results' }), /Refusing to publish to other-results \(only validation-results/);
  for (const branch of ['main', 'master']) {
    await assert.rejects(run({ BRANCH: branch }), new RegExp(`Refusing to publish to ${branch}\\.`));
    await assert.rejects(run({ BRANCH: branch, PUBLISH_TEST_MODE: '1' }), new RegExp(`Refusing to publish to ${branch}\\.`));
  }
  assert.deepEqual(files('main'), ['README.md']);
  assert.equal(git(path.join(dir, 'origin.git'), 'branch', '--list', 'other-results', 'master'), '');
  await run({ BRANCH: 'other-results', PUBLISH_TEST_MODE: '1' });
  assert.ok(files('other-results').includes('latest/kootenai.json'));
});

test('validation-alerts --run-id must be digits', () => {
  assert.equal(parseArgs(['--county', 'kootenai', '--current', 'x', '--run-id', '123']).runId, '123');
  assert.throws(() => parseArgs(['--county', 'kootenai', '--current', 'x', '--run-id', '12a']), /--run-id/);
});

test('validation-alerts writes runId into the alert decision', async () => {
  const out = path.join(dir, 'alerts');
  const current = path.join(dir, 'current.json');
  writeFileSync(current, JSON.stringify({ county: 'Kootenai', baseUrl: 'https://acresx.test', results: [], summary: { failed: 0 } }));
  const alerts = fileURLToPath(new URL('../scripts/validation-alerts.mjs', import.meta.url));
  await execFile(process.execPath, [alerts, '--county', 'kootenai', '--current', current, '--out', out, '--run-id', '555']);
  const decision = JSON.parse(execFileSync('cat', [path.join(out, 'kootenai-alert.json')], { encoding: 'utf8' }));
  assert.equal(decision.runId, '555');
  assert.equal(typeof decision.alerting, 'boolean');
});
