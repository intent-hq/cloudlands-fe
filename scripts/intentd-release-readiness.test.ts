// @verify-changed-triggers: .github/workflows/auto-cut-alpha.yml, scripts/intentd-release-readiness.mjs, scripts/release-pr-fast-path.mjs, scripts/intentd-pin-advance.sh

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmedIntentdNoop } from './intentd-release-readiness.mjs';

const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const workflow = load(readFileSync('.github/workflows/auto-cut-alpha.yml', 'utf8'));
const steps = workflow.jobs['auto-merge-release-pr'].steps as {
  name: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
  with?: Record<string, unknown>;
}[];
const PIN = '0.9.110';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const FE = 'intent-hq/cloudlands-fe';
const BE = 'intent-hq/intentd';
const directories: string[] = [];

function fixture() {
  return {
    pin: PIN,
    pins: {} as Record<string, string>,
    feTag: 'v3.0.0',
    feTagDate: '2026-09-26T05:50:00Z',
    prDate: '2026-09-26T06:00:00Z',
    before: BASE,
    after: HEAD,
    compare: {
      ahead_by: 1,
      base_commit: { sha: BASE, commit: { committer: { date: '2026-09-26T05:00:00Z' } } },
    },
    commits: [
      { commit: { committer: { date: '2026-09-26T06:00:00Z' }, message: 'fix: frontend change' } },
    ],
    pr: {
      number: 99,
      title: 'chore(release): 3.1.0',
      headRefName: 'release-please--branches--main',
      isCrossRepository: false,
      author: { login: 'releaser' },
      labels: [] as { name: string }[],
    },
    detail: {
      reviewDecision: '',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'CI Gate', conclusion: 'SUCCESS' }],
    },
    pinPr: [] as { number: number; isCrossRepository: boolean }[],
    unresolved: 0,
    beTag: 'v0.9.111',
    beTagDate: '2026-09-26T05:50:00Z',
    proof: {
      head: HEAD,
      run: {
        id: 100,
        run_number: 10,
        run_attempt: 1,
        workflow_id: 42,
        path: '.github/workflows/release-plz.yml',
        event: 'push',
        head_branch: 'main',
        head_sha: HEAD,
        repository: { full_name: BE },
        head_repository: { full_name: BE },
        status: 'completed',
        conclusion: 'success',
      },
      jobs: [
        {
          id: 101,
          run_id: 100,
          run_attempt: 1,
          head_sha: HEAD,
          name: `Release-plz no release needed: v${PIN}@${BASE}`,
          status: 'completed',
          conclusion: 'success',
        },
      ],
      prs: [],
    },
    fail: '',
    shape: 'metadata',
    liveHead: '',
    missingHead: false,
    missingHelper: false,
    fetchFail: false,
  };
}

// Mock only the remote boundary. Execute the real workflow Bash (including
// the new helper's CLI), with gh's jq projection still evaluated by real jq.
function runCut(
  data = fixture(),
  event = 'schedule',
  stepName = 'Merge the Release PR when green',
  throttleTag = '',
  dryRun = true,
  pinAdvance = '',
) {
  const directory = mkdtempSync(join(tmpdir(), 'intentd-readiness-'));
  directories.push(directory);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'core.fileMode', 'true');
  git('remote', 'add', 'origin', data.fetchFail ? join(directory, 'unavailable') : directory);
  writeFileSync(join(directory, 'package.json'), '{ "version": "3.0.0" }\n');
  writeFileSync(join(directory, 'intentd.version'), '0.9.110\n');
  writeFileSync(join(directory, 'CHANGELOG.md'), '# Changelog\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const baseRefOid = git('rev-parse', 'HEAD');
  if (data.shape === 'pin') writeFileSync(join(directory, 'intentd.version'), '0.9.111\n');
  else writeFileSync(join(directory, 'package.json'), '{ "version": "3.1.0" }\n');
  if (data.shape === 'mode') chmodSync(join(directory, 'CHANGELOG.md'), 0o755);
  if (data.shape === 'source') writeFileSync(join(directory, 'app.js'), 'malicious()\n');
  git('add', '.');
  git('commit', '-qm', 'chore(release): 3.1.0');
  const headRefOid = git('rev-parse', 'HEAD');
  mkdirSync(join(directory, 'scripts'));
  for (const script of ['intentd-release-readiness.mjs', 'release-pr-fast-path.mjs', 'intentd-pin-advance.sh'])
    writeFileSync(join(directory, 'scripts', script), readFileSync(`scripts/${script}`));
  if (data.missingHelper) rmSync(join(directory, 'scripts', 'release-pr-fast-path.mjs'));
  writeFileSync(
    join(directory, 'fixture.json'),
    JSON.stringify({
      ...data,
      detail: { ...data.detail, baseRefOid, headRefOid: data.missingHead ? '' : headRefOid },
    }),
  );
  writeFileSync(
    join(directory, 'event.json'),
    JSON.stringify({
      before: data.before,
      after: data.after,
      head_commit: { timestamp: '2026-09-26T06:00:00Z' },
      commits: [{ message: 'fix: bump intentd sidecar' }],
    }),
  );
  writeFileSync(join(directory, 'sleep'), '#!/usr/bin/env bash\ntouch "$READINESS_SLEPT"\n', {
    mode: 0o755,
  });
  writeFileSync(
    join(directory, 'gh'),
    `#!/usr/bin/env node
const {readFileSync, appendFileSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const f = JSON.parse(readFileSync(process.env.READINESS_FIXTURE, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(process.env.READINESS_CALLS, JSON.stringify(a) + '\\n');
const endpoint = a[0] === 'api' ? a.slice(1).find(x => !x.startsWith('--')) : '';
if (f.fail && endpoint.includes(f.fail)) process.exit(1);
let value;
if (a[0] === 'pr' && a[1] === 'list') value = a.includes('--head') ? f.pinPr : [f.pr];
else if (a[0] === 'pr' && a[1] === 'view') value = f.detail;
else if (a[0] === 'pr' && a[1] === 'merge') {
  const expected = a[a.indexOf('--match-head-commit') + 1];
  if (expected !== (f.liveHead || f.detail.headRefOid)) process.exit(1);
  process.exit(0);
}
else if (endpoint === 'graphql') {
  if (a.some(x => x.includes('viewer'))) value = { data: { viewer: { login: 'releaser' } } };
  else { process.stdout.write(String(f.unresolved)); process.exit(0); }
}
else if (endpoint.includes('/contents/intentd.version')) value = {content: Buffer.from((f.pins[endpoint.split('?ref=')[1]] ?? f.pin) + '\\n').toString('base64')};
else if (endpoint === 'repos/${BE}/compare/v${PIN}...main?per_page=1') value = f.compare;
else if (endpoint === 'repos/${BE}/git/matching-refs/tags/v') value = [{ref: 'refs/tags/' + f.beTag}];
else if (endpoint.includes('/git/matching-refs/tags/v')) value = [{ref: 'refs/tags/' + f.feTag}];
else if (endpoint.startsWith('repos/${FE}/compare/')) value = {commits: f.commits};
else if (endpoint === 'repos/${BE}/git/ref/heads/main') value = {object: {sha: f.proof.head}};
else if (endpoint === 'repos/${BE}/commits/v${PIN}') value = {sha: '${BASE}'};
else if (endpoint === 'repos/${BE}/commits/' + f.beTag) value = {commit: {committer: {date: f.beTagDate}}};
else if (endpoint === 'repos/${FE}/commits/' + f.feTag) value = {commit: {committer: {date: f.feTagDate}}};
else if (endpoint === 'repos/${FE}/commits/' + f.pr.headRefName) value = {commit: {committer: {date: f.prDate}}};
else if (endpoint === 'repos/${BE}/actions/workflows/release-plz.yml') value = {id: 42, path: '.github/workflows/release-plz.yml', state: 'active'};
else if (endpoint.includes('/actions/workflows/release-plz.yml/runs?')) value = {total_count: 1, workflow_runs: [f.proof.run]};
else if (endpoint === 'repos/${BE}/actions/runs/100') value = f.proof.run;
else if (endpoint.includes('/actions/runs/100/attempts/1/jobs?')) value = {total_count: f.proof.jobs.length, jobs: f.proof.jobs};
else if (endpoint.includes('/pulls?')) value = f.proof.prs;
else { process.stderr.write('Unexpected gh: ' + JSON.stringify(a)); process.exit(2); }
const projection = a.indexOf('--jq');
if (projection >= 0) {
  const r = spawnSync('jq', ['-r', a[projection + 1]], {input: JSON.stringify(value), encoding: 'utf8'});
  process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status);
}
process.stdout.write(JSON.stringify(value));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(directory, 'curl'),
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({version: '${PIN}'}));\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(directory, 'date'),
    '#!/usr/bin/env bash\nif [[ "$*" == "+%s" ]]; then if [[ -f "$READINESS_SLEPT" ]]; then exec /usr/bin/date -d "2026-09-26T06:16:00Z" +%s; else exec /usr/bin/date -d "2026-09-26T06:00:00Z" +%s; fi; fi\nexec /usr/bin/date "$@"\n',
    { mode: 0o755 },
  );
  const step = steps.find((s) => s.name === stepName)!;
  const context: Record<string, string> = {
    'github.token': 'mock',
    'secrets.RELEASE_PAT': 'mock',
    'inputs.dry_run == true': String(dryRun),
    'github.event_name': event,
    'github.event.before': data.before,
    'github.sha': data.after,
    'steps.throttle.outputs.tag': throttleTag,
    'steps.throttle.outputs.pin_advance': pinAdvance,
  };
  const stepEnv = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([key, value]) => [
      key,
      value.replace(/\$\{\{(.*?)\}\}/g, (_, expression: string) => {
        expect(context).toHaveProperty(expression.trim());
        return context[expression.trim()];
      }),
    ]),
  );
  const result = spawnSync('bash', ['-c', step.run!], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      READINESS_FIXTURE: join(directory, 'fixture.json'),
      READINESS_CALLS: join(directory, 'calls'),
      GITHUB_REPOSITORY: FE,
      ...stepEnv,
      GITHUB_EVENT_PATH: join(directory, 'event.json'),
      READINESS_SLEPT: join(directory, 'slept'),
      GITHUB_OUTPUT: join(directory, 'outputs'),
    },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const calls = readFileSync(join(directory, 'calls'), 'utf8');
  if (dryRun) expect(calls).not.toContain('"merge"');
  return {
    calls: calls
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]),
    headRefOid,
    cut: result.stdout.includes('DRY RUN: would squash-merge'),
    output: result.stdout,
    outputs:
      stepName === 'Merge the Release PR when green'
        ? ''
        : readFileSync(join(directory, 'outputs'), 'utf8'),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('auto-cut intentd dependency guard', () => {
  it('cuts the scripts-only v0.9.110 incident after a confirmed current-main no-op', () => {
    const result = runCut();
    expect(result.cut, result.output).toBe(true);
  });

  it('retains deferral when the new proof cannot be read', () => {
    const data = fixture();
    data.fail = '/actions/';
    const result = runCut(data, 'schedule', 'Merge the Release PR when green', '', false);
    expect(result.calls.some((args) => args[0] === 'pr' && args[1] === 'merge')).toBe(false);
  });

  it('still allows the explicit manual override without reading proof', () => {
    const data = fixture();
    data.fail = '/actions/';
    expect(runCut(data, 'workflow_dispatch').cut).toBe(true);
  });

  it('retains the in-flight build guard despite a valid no-op', () => {
    const result = runCut(fixture(), 'schedule', 'Check for an in-flight intentd release build');
    expect(result.outputs.trim().split('\n').at(-1)).toBe('defer=true');
  });

  it('retains the in-flight guard age bound for a failed build', () => {
    const result = runCut(
      { ...fixture(), beTagDate: '2026-09-26T03:00:00Z' },
      'schedule',
      'Check for an in-flight intentd release build',
    );
    expect(result.outputs.trim().split('\n').at(-1)).toBe('defer=false');
  });

  it('retains the throttle and its pre-merge race check', () => {
    const result = runCut(fixture(), 'schedule', 'Throttle to one cut per hour');
    expect(result.outputs.trim().split('\n').at(-1)).toBe('defer=true');
    expect(runCut(fixture(), 'schedule', 'Merge the Release PR when green', 'v2.9.0').cut).toBe(
      false,
    );
  });

  it.each([
    '/contents/intentd.version',
    '/intentd/compare/',
    '/git/matching-refs/',
    `/${FE}/compare/`,
  ])('preserves the original fail-open lookup: %s', (fail) => {
    expect(runCut({ ...fixture(), fail }).cut).toBe(true);
  });

  it.each([
    'hold',
    'pin PR',
    'failed CI',
    'pending CI',
    'review',
    'changes requested',
    'review required',
    'conflict',
    'draft',
    'fork',
    'author',
  ])('retains the independent %s guard despite a valid no-op', (guard) => {
    const data = fixture();
    if (guard === 'hold') data.pr.labels = [{ name: 'hold-release' }];
    if (guard === 'pin PR') data.pinPr = [{ number: 7, isCrossRepository: false }];
    if (guard === 'failed CI') data.detail.statusCheckRollup[0].conclusion = 'FAILURE';
    if (guard === 'pending CI') data.detail.statusCheckRollup = [];
    if (guard === 'review') data.unresolved = 1;
    if (guard === 'changes requested') data.detail.reviewDecision = 'CHANGES_REQUESTED';
    if (guard === 'review required') data.detail.reviewDecision = 'REVIEW_REQUIRED';
    if (guard === 'conflict') data.detail.mergeable = 'CONFLICTING';
    if (guard === 'draft') data.detail.isDraft = true;
    if (guard === 'fork') data.pr.isCrossRepository = true;
    if (guard === 'author') data.pr.author.login = 'someone-else';
    const result = runCut(data, 'schedule', 'Merge the Release PR when green', '', false);
    expect(result.calls.some((args) => args[0] === 'pr' && args[1] === 'merge')).toBe(false);
  });

  it.each(['no daemon delta', 'old frontend change', 'pin automation', 'release automation'])(
    'keeps the existing %s exemption without proof',
    (scenario) => {
      const data = fixture();
      data.fail = '/actions/';
      if (scenario === 'no daemon delta') data.compare.ahead_by = 0;
      if (scenario === 'old frontend change')
        data.commits[0].commit.committer.date = '2026-09-26T04:00:00Z';
      if (scenario === 'pin automation')
        data.commits[0].commit.message = 'fix: bump intentd sidecar to v0.9.110';
      if (scenario === 'release automation')
        data.commits[0].commit.message = 'chore(release): 3.0.0';
      expect(runCut(data).cut).toBe(true);
    },
  );
});

describe('auto-cut direct release merge', () => {
  const mergeStep = 'Merge the Release PR when green';
  it.each(['schedule', 'workflow_dispatch'])(
    'directly squash merges metadata with the tested head on %s',
    (event) => {
      const result = runCut(fixture(), event, mergeStep, '', false);
      expect(result.calls.filter((args) => args[0] === 'pr' && args[1] === 'merge')).toEqual([
        [
          'pr',
          'merge',
          '99',
          '--repo',
          FE,
          '--squash',
          '--match-head-commit',
          result.headRefOid,
          '--admin',
        ],
      ]);
      expect(result.output).toContain('Directly squash-merged');
    },
  );

  it.each(['source', 'pin', 'mode'])('keeps %s changes on the queue path', (shape) => {
    const result = runCut({ ...fixture(), shape }, 'schedule', mergeStep, '', false);
    expect(result.calls.filter((args) => args[0] === 'pr' && args[1] === 'merge')).toEqual([
      ['pr', 'merge', '99', '--repo', FE, '--squash', '--match-head-commit', result.headRefOid],
    ]);
    expect(result.output).not.toContain('Squash-merged');
    expect(result.output).not.toContain('Directly squash-merged');
  });

  it('does not claim success if release-please refreshed the tested head', () => {
    const result = runCut(
      { ...fixture(), liveHead: 'c'.repeat(40) },
      'schedule',
      mergeStep,
      '',
      false,
    );
    const merge = result.calls.find((args) => args[0] === 'pr' && args[1] === 'merge')!;
    expect(merge).toContain('--match-head-commit');
    expect(merge).toContain(result.headRefOid);
    expect(result.output).toContain('gh pr merge failed');
    expect(result.output).not.toContain('Directly squash-merged');
  });

  it.each(['missingHelper', 'fetchFail'] as const)('falls back to the queue on %s', (failure) => {
    const result = runCut({ ...fixture(), [failure]: true }, 'schedule', mergeStep, '', false);
    const merge = result.calls.find((args) => args[0] === 'pr' && args[1] === 'merge')!;
    expect(merge).toContain('--match-head-commit');
    expect(merge).not.toContain('--admin');
  });

  it('skips a PR without a readable tested head', () => {
    const result = runCut({ ...fixture(), missingHead: true }, 'schedule', mergeStep, '', false);
    expect(result.calls.some((args) => args[0] === 'pr' && args[1] === 'merge')).toBe(false);
  });

  it.each(['metadata', 'source'])('dry run reports the %s route without merging', (shape) => {
    const result = runCut({ ...fixture(), shape });
    expect(result.cut).toBe(true);
    expect(result.output).toContain(shape === 'metadata' ? 'direct' : 'queue');
  });
});

function pinFixture() {
  return {
    ...fixture(),
    pins: { [BASE]: '0.9.109', [HEAD]: PIN, 'heads/main': PIN, 'tags/v3.0.0': '0.9.109' },
    beTag: `v${PIN}`,
  };
}

function outputValue(outputs: string, key: string) {
  return outputs
    .trim()
    .split('\n')
    .filter((line) => line.startsWith(`${key}=`))
    .at(-1)
    ?.slice(key.length + 1);
}

// Execute each guarded workflow step with the preceding step's real outputs.
function runPinChain(data = pinFixture(), event = 'push', mergeData = data) {
  const throttle = runCut(data, event, 'Throttle to one cut per hour');
  if (outputValue(throttle.outputs, 'defer') === 'true')
    return { cut: false, output: throttle.output };
  const inflight = runCut(data, event, 'Check for an in-flight intentd release build');
  if (outputValue(inflight.outputs, 'defer') === 'true')
    return { cut: false, output: inflight.output };
  return runCut(
    mergeData,
    event,
    'Merge the Release PR when green',
    outputValue(throttle.outputs, 'tag'),
    true,
    outputValue(throttle.outputs, 'pin_advance'),
  );
}

describe('prompt pin-driven alpha cut', () => {
  it('preserves the pending pin push when an ordinary push arrives while another cut polls', () => {
    // A entered readiness polling before B advanced the pin. Once B lands,
    // A's Release PR pin check must prevent A from cutting its stale pin.
    const polling = pinFixture();
    polling.before = 'd'.repeat(40);
    polling.after = BASE;
    polling.pins[polling.before] = '0.9.108';
    const active = runCut(polling, 'push', 'Merge the Release PR when green', 'v3.0.0', 'true');
    expect(active.cut, active.output).toBe(false);
    expect(active.output).toContain('head does not carry the pushed intentd pin');

    const pinPush = pinFixture();
    const ordinaryPush = pinFixture();
    ordinaryPush.before = HEAD;
    ordinaryPush.after = 'c'.repeat(40);
    ordinaryPush.pins[ordinaryPush.after] = PIN;

    // Mock GitHub's scheduler boundary using the actual workflow setting:
    // single (default) replaces pending B with C; max retains B then C.
    // https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
    const pending: { name: string; data: ReturnType<typeof pinFixture> }[] = [];
    for (const run of [
      { name: 'B', data: pinPush },
      { name: 'C', data: ordinaryPush },
    ]) {
      if (workflow.concurrency.queue !== 'max') pending.splice(0);
      pending.push(run);
    }
    const cuts: string[] = [];
    for (const run of pending) {
      // Finish each real workflow chain before starting the next: merges
      // stay serialized, and C observes B's release if B was retained.
      if (cuts.length) {
        run.data.feTag = 'v3.0.1';
        run.data.pins['tags/v3.0.1'] = PIN;
      }
      if (runPinChain(run.data).cut) cuts.push(run.name);
    }
    expect(cuts).toEqual(['B']);
  });

  it('wires helpers before throttling and keeps the existing trigger and guard chain', () => {
    const checkout = steps.find((s) => s.name === 'Checkout trusted release helpers')!;
    const throttle = steps.find((s) => s.name === 'Throttle to one cut per hour')!;
    const inflight = steps.find((s) => s.name === 'Check for an in-flight intentd release build')!;
    const merge = steps.find((s) => s.name === 'Merge the Release PR when green')!;
    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(throttle));
    expect(checkout.with?.['sparse-checkout']).toContain('/scripts/intentd-pin-advance.sh');
    expect(checkout.with?.['sparse-checkout']).toContain('/scripts/intentd-release-readiness.mjs');
    expect(checkout.if).not.toContain('steps.throttle');
    expect(throttle.if).toContain("github.event_name != 'workflow_dispatch'");
    expect(inflight.if).toContain("steps.throttle.outputs.defer != 'true'");
    expect(merge.if).toContain("steps.throttle.outputs.defer != 'true'");
    expect(merge.if).toContain("steps.inflight.outputs.defer != 'true'");
    expect(workflow.on.push.branches).toEqual(['main']);
    expect(workflow.on.schedule).toEqual([{ cron: '30 * * * *' }]);
    expect(workflow.concurrency).toEqual({
      group: 'auto-cut-alpha',
      'cancel-in-progress': false,
      queue: 'max',
    });
  });

  it.each(['tags', 'date'])('keeps the original fail-open %s lookup policy', (kind) => {
    const data = pinFixture();
    data.fail = kind === 'tags' ? `repos/${FE}/git/matching-refs/` : `repos/${FE}/commits/v3.0.0`;
    expect(runPinChain(data).cut).toBe(true);
  });

  it('keeps ordinary pushes eligible after the hour', () => {
    const data = pinFixture();
    data.pins[BASE] = PIN;
    data.feTagDate = '2026-09-26T04:00:00Z';
    expect(runPinChain(data).cut).toBe(true);
  });

  it('allows the new pin if a recent old-pin tag appeared after an unthrottled start', () => {
    const before = pinFixture();
    before.feTagDate = '2026-09-26T04:00:00Z';
    const after = pinFixture();
    after.feTag = 'v3.0.1';
    after.pins['tags/v3.0.1'] = '0.9.109';
    expect(runPinChain(before, 'push', after).cut).toBe(true);
  });

  it('still defers an ordinary push after a concurrent tag appears', () => {
    const before = pinFixture();
    before.pins[BASE] = PIN;
    before.feTagDate = '2026-09-26T04:00:00Z';
    const after = structuredClone(before);
    after.feTag = 'v3.0.1';
    after.pins['tags/v3.0.1'] = '0.9.109';
    expect(runPinChain(before, 'push', after).cut).toBe(false);
  });

  it('treats promotion from a prerelease to the stable pin as an advance', () => {
    const data = pinFixture();
    data.pins[BASE] = `${PIN}-alpha.1`;
    data.pins['tags/v3.0.0'] = `${PIN}-alpha.1`;
    expect(runPinChain(data).cut).toBe(true);
  });

  it('cuts a proven new pin within the hour through the existing push chain', () => {
    const result = runPinChain();
    expect(result.cut, result.output).toBe(true);
  });

  it.each([
    'unchanged',
    'comment-only',
    'rollback',
    'already carried',
    'newer carried',
    'superseded',
    'malformed',
    'missing before',
  ])('does not exempt a %s pin push', (kind) => {
    const data = pinFixture();
    if (kind === 'unchanged') data.pins[BASE] = PIN;
    if (kind === 'comment-only') data.pins[BASE] = `# Old comment\n${PIN}\n`;
    if (kind === 'rollback') data.pins[BASE] = '0.9.111';
    if (kind === 'already carried') data.pins['tags/v3.0.0'] = PIN;
    if (kind === 'newer carried') data.pins['tags/v3.0.0'] = '0.9.111';
    if (kind === 'superseded') data.pins['heads/main'] = '0.9.111';
    if (kind === 'malformed') data.pins[HEAD] = 'garbage';
    if (kind === 'missing before') data.before = '0'.repeat(40);
    expect(runPinChain(data).cut).toBe(false);
  });

  it('keeps the schedule throttle even with an unshipped pin', () => {
    expect(runPinChain(pinFixture(), 'schedule').cut).toBe(false);
  });

  it.each([BASE, HEAD, 'heads/main', 'tags/v3.0.0'])(
    'retains the throttle when pin evidence at %s is unreadable',
    (ref) => {
      const data = pinFixture();
      data.fail = `/contents/intentd.version?ref=${ref}`;
      expect(runPinChain(data).cut).toBe(false);
    },
  );

  it('can pass a concurrent cut that still carries the old pin', () => {
    const before = pinFixture();
    const after = pinFixture();
    after.feTag = 'v3.0.1';
    after.pins['tags/v3.0.1'] = '0.9.109';
    const result = runPinChain(before, 'push', after);
    expect(result.cut, result.output).toBe(true);
  });

  it.each(['carried', 'superseded', 'proof unreadable'])(
    'rechecks before merging when the pin becomes %s',
    (kind) => {
      const before = pinFixture();
      const after = pinFixture();
      if (kind === 'carried') {
        after.feTag = 'v3.0.1';
        after.pins['tags/v3.0.1'] = PIN;
      }
      if (kind === 'superseded') after.pins['heads/main'] = '0.9.111';
      if (kind === 'proof unreadable') after.fail = `/contents/intentd.version?ref=${BASE}`;
      expect(runPinChain(before, 'push', after).cut).toBe(false);
    },
  );

  it.each([
    'hold',
    'pin PR',
    'failed CI',
    'pending CI',
    'review',
    'conflict',
    'draft',
    'fork',
    'author',
    'stale pin',
    'stale head',
    'BE dependency',
    'inflight',
  ])('keeps the %s guard for exempt pin pushes', (guard) => {
    const data = pinFixture();
    if (guard === 'hold') data.pr.labels = [{ name: 'hold-release' }];
    if (guard === 'pin PR') data.pinPr = [{ number: 7, isCrossRepository: false }];
    if (guard === 'failed CI') data.detail.statusCheckRollup[0].conclusion = 'FAILURE';
    if (guard === 'pending CI') data.detail.statusCheckRollup = [];
    if (guard === 'review') data.unresolved = 1;
    if (guard === 'conflict') data.detail.mergeable = 'CONFLICTING';
    if (guard === 'draft') data.detail.isDraft = true;
    if (guard === 'fork') data.pr.isCrossRepository = true;
    if (guard === 'author') data.pr.author.login = 'someone-else';
    if (guard === 'stale pin') data.pins[data.pr.headRefName] = '0.9.109';
    if (guard === 'stale head') data.prDate = '2026-09-26T05:00:00Z';
    if (guard === 'BE dependency') data.proof.jobs = [];
    if (guard === 'inflight') data.beTag = 'v0.9.111';
    const result = runPinChain(data);
    expect(result.cut, result.output).toBe(false);
    expect(result.output).not.toContain('throttling this cut');
  });
});

const HEAD_URL = `repos/${BE}/git/ref/heads/main`;
const WORKFLOW_URL = `repos/${BE}/actions/workflows/release-plz.yml`;
const RUNS_URL = `${WORKFLOW_URL}/runs?branch=main&event=push&head_sha=${HEAD}&per_page=100&page=1`;
const RUN_URL = `repos/${BE}/actions/runs/100`;
const JOBS_URL = `${RUN_URL}/attempts/1/jobs?per_page=100&page=1`;
const PRS_URL = `repos/${BE}/pulls?state=open&base=main&per_page=100&page=1`;
const PIN_URL = `repos/${FE}/contents/intentd.version?ref=heads/main`;
const TAG_URL = `repos/${BE}/commits/v${PIN}`;
const releasePr = {
  state: 'open',
  base: { ref: 'main' },
  head: { ref: 'release-plz-2026-09-26', repo: { full_name: BE } },
};

function proofHarness() {
  const proof = fixture().proof;
  const responses = new Map<string, unknown>([
    [HEAD_URL, { object: { sha: HEAD } }],
    [WORKFLOW_URL, { id: 42, path: '.github/workflows/release-plz.yml', state: 'active' }],
    [RUNS_URL, { total_count: 1, workflow_runs: [proof.run] }],
    [RUN_URL, proof.run],
    [JOBS_URL, { total_count: proof.jobs.length, jobs: proof.jobs }],
    [PRS_URL, []],
    [PIN_URL, { content: Buffer.from(`# Sidecar\n${PIN}\n`).toString('base64') }],
    [TAG_URL, { sha: BASE }],
  ]);
  const calls: string[] = [];
  const api = (endpoint: string) => {
    calls.push(endpoint);
    if (!responses.has(endpoint)) throw new Error(`Unexpected endpoint: ${endpoint}`);
    const value = responses.get(endpoint);
    if (value instanceof Error) throw value;
    return structuredClone(
      typeof value === 'function' ? value(calls.filter((c) => c === endpoint).length) : value,
    );
  };
  return {
    proof,
    responses,
    calls,
    check: (options = {}) =>
      confirmedIntentdNoop(
        { pin: PIN, baselineSha: BASE, feRepo: FE, ...options },
        { api, log: () => {} },
      ),
  };
}

describe('confirmed intentd release-plz no-op', () => {
  it('requires a trusted successful current-main assessment of the shipped baseline', () => {
    expect(proofHarness().check()).toBe(true);
  });

  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', null])(
    'rejects run conclusion %s even with a successful marker',
    (conclusion) => {
      const h = proofHarness();
      Object.assign(h.proof.run, { conclusion });
      expect(h.check()).toBe(false);
    },
  );
  it.each(['queued', 'in_progress', 'waiting', 'pending'])('rejects a %s run', (status) => {
    const h = proofHarness();
    h.proof.run.status = status;
    expect(h.check()).toBe(false);
  });
  it.each([
    ['event', 'pull_request'],
    ['event', 'workflow_dispatch'],
    ['head_branch', 'topic'],
    ['head_sha', 'c'.repeat(40)],
    ['path', '.github/workflows/ci.yml'],
    ['workflow_id', 7],
    ['repository', { full_name: 'fork/intentd' }],
    ['head_repository', { full_name: 'fork/intentd' }],
    ['run_attempt', 0],
    ['run_attempt', null],
    ['id', null],
    ['run_number', null],
  ])('rejects untrusted run %s=%j', (key, value) => {
    const h = proofHarness();
    Object.assign(h.proof.run, { [key as string]: value });
    expect(h.check()).toBe(false);
  });

  it.each([
    'missing',
    'malformed',
    'skipped',
    'failed',
    'pending',
    'duplicate',
    'wrong baseline tag',
    'wrong baseline commit',
    'wrong attempt',
    'wrong run',
    'wrong head',
  ])('rejects a %s marker', (scenario) => {
    const h = proofHarness();
    const marker = h.proof.jobs[0];
    if (scenario === 'missing') h.proof.jobs.splice(0);
    if (scenario === 'duplicate') h.proof.jobs.push({ ...marker });
    if (scenario === 'malformed') marker.name += ' malformed';
    if (scenario === 'skipped') marker.conclusion = 'skipped';
    if (scenario === 'failed') marker.conclusion = 'failure';
    if (scenario === 'pending') marker.status = 'queued';
    if (scenario === 'wrong baseline tag')
      marker.name = `Release-plz no release needed: v0.9.111@${BASE}`;
    if (scenario === 'wrong baseline commit')
      marker.name = `Release-plz no release needed: v${PIN}@${'c'.repeat(40)}`;
    if (scenario === 'wrong attempt') marker.run_attempt = 2;
    if (scenario === 'wrong run') marker.run_id = 99;
    if (scenario === 'wrong head') marker.head_sha = 'c'.repeat(40);
    h.responses.set(JOBS_URL, { total_count: h.proof.jobs.length, jobs: h.proof.jobs });
    expect(h.check()).toBe(false);
  });

  it('keeps real release work blocked while a release-plz PR is open', () => {
    const h = proofHarness();
    h.responses.set(PRS_URL, [releasePr]);
    expect(h.check()).toBe(false);
  });

  it('ignores a fork branch imitating the release PR', () => {
    const h = proofHarness();
    h.responses.set(PRS_URL, [
      { ...releasePr, head: { ...releasePr.head, repo: { full_name: 'fork/intentd' } } },
    ]);
    expect(h.check()).toBe(true);
  });

  it('does not infer a no-op from a manually closed release PR', () => {
    const h = proofHarness();
    h.responses.set(PRS_URL, []);
    h.responses.set(JOBS_URL, { total_count: 0, jobs: [] });
    expect(h.check()).toBe(false);
  });

  it('rejects a merged release before its tag exists', () => {
    const h = proofHarness();
    h.responses.set(JOBS_URL, { total_count: 0, jobs: [] });
    expect(h.check()).toBe(false);
  });

  it('rejects a newer released baseline that the frontend has not pinned', () => {
    const h = proofHarness();
    h.proof.jobs[0].name = `Release-plz no release needed: v0.9.111@${'c'.repeat(40)}`;
    expect(h.check()).toBe(false);
  });

  it('never falls back to an older successful run behind a newer failed or pending run', () => {
    for (const status of ['completed', 'in_progress']) {
      const h = proofHarness();
      h.responses.set(RUNS_URL, {
        total_count: 2,
        workflow_runs: [
          h.proof.run,
          { ...h.proof.run, id: 102, run_number: 11, status, conclusion: 'failure' },
        ],
      });
      expect(h.check()).toBe(false);
    }
  });

  it('uses the successful latest run rather than an older failed run', () => {
    const h = proofHarness();
    h.responses.set(RUNS_URL, {
      total_count: 2,
      workflow_runs: [
        { ...h.proof.run, id: 99, run_number: 9, conclusion: 'failure' },
        h.proof.run,
      ],
    });
    expect(h.check()).toBe(true);
  });

  it('reads the exact latest attempt, never retained jobs from attempt 1', () => {
    const h = proofHarness();
    h.proof.run.run_attempt = 2;
    h.responses.set(`${RUN_URL}/attempts/2/jobs?per_page=100&page=1`, { total_count: 0, jobs: [] });
    expect(h.check()).toBe(false);
    expect(h.calls).not.toContain(JOBS_URL);
  });

  it('accepts a successful reassessment on the latest attempt', () => {
    const h = proofHarness();
    h.proof.run.run_attempt = 2;
    h.proof.jobs[0].run_attempt = 2;
    h.responses.set(`${RUN_URL}/attempts/2/jobs?per_page=100&page=1`, {
      total_count: 1,
      jobs: h.proof.jobs,
    });
    expect(h.check()).toBe(true);
  });

  it.each(['main', 'pin', 'tag', 'PR', 'run', 'attempt', 'conclusion'])(
    'rejects %s movement during the proof lookup',
    (kind) => {
      const h = proofHarness();
      const endpoint = {
        main: HEAD_URL,
        pin: PIN_URL,
        tag: TAG_URL,
        PR: PRS_URL,
        run: RUNS_URL,
        attempt: RUN_URL,
        conclusion: RUN_URL,
      }[kind]!;
      const before = structuredClone(h.responses.get(endpoint));
      const after = {
        main: { object: { sha: 'c'.repeat(40) } },
        pin: { content: Buffer.from('0.9.111\n').toString('base64') },
        tag: { sha: 'c'.repeat(40) },
        PR: [releasePr],
        run: { total_count: 1, workflow_runs: [{ ...h.proof.run, id: 102, run_number: 11 }] },
        attempt: { ...h.proof.run, run_attempt: 2 },
        conclusion: { ...h.proof.run, conclusion: 'failure' },
      }[kind];
      h.responses.set(endpoint, (call: number) => (call === 1 ? before : after));
      expect(h.check()).toBe(false);
    },
  );

  it.each([HEAD_URL, WORKFLOW_URL, RUNS_URL, RUN_URL, JOBS_URL, PRS_URL, PIN_URL, TAG_URL])(
    'rejects API errors and malformed responses at %s',
    (endpoint) => {
      for (const bad of [new Error('GitHub unavailable'), null, {}]) {
        const h = proofHarness();
        h.responses.set(endpoint, bad);
        expect(h.check()).toBe(false);
      }
    },
  );

  it.each([HEAD_URL, RUNS_URL, RUN_URL, PRS_URL, PIN_URL, TAG_URL])(
    'rejects unreadable rechecks at %s',
    (endpoint) => {
      const h = proofHarness();
      const before = structuredClone(h.responses.get(endpoint));
      h.responses.set(endpoint, (call: number) => {
        if (call > 1) throw new Error('GitHub unavailable');
        return before;
      });
      expect(h.check()).toBe(false);
    },
  );

  it('walks PR pagination so an open release PR on page two blocks', () => {
    const h = proofHarness();
    h.responses.set(
      PRS_URL,
      Array.from({ length: 100 }, (_, n) => ({
        ...releasePr,
        head: { ...releasePr.head, ref: `fix-${n}` },
      })),
    );
    h.responses.set(PRS_URL.replace('&page=1', '&page=2'), [releasePr]);
    expect(h.check()).toBe(false);
    expect(h.calls).toContain(PRS_URL.replace('&page=1', '&page=2'));
  });

  it('walks job pagination to find the marker', () => {
    const h = proofHarness();
    h.responses.set(JOBS_URL, {
      total_count: 101,
      jobs: Array.from({ length: 100 }, (_, id) => ({ name: `ordinary ${id}` })),
    });
    h.responses.set(JOBS_URL.replace('&page=1', '&page=2'), {
      total_count: 101,
      jobs: h.proof.jobs,
    });
    expect(h.check()).toBe(true);
  });

  it('walks run pagination rather than accepting a success before a newer run', () => {
    const h = proofHarness();
    h.responses.set(RUNS_URL, {
      total_count: 101,
      workflow_runs: Array.from({ length: 100 }, (_, i) => ({
        ...h.proof.run,
        id: i + 1,
        run_number: i + 1,
      })),
    });
    h.responses.set(RUNS_URL.replace('&page=1', '&page=2'), {
      total_count: 101,
      workflow_runs: [{ ...h.proof.run, id: 101, run_number: 101, status: 'queued' }],
    });
    expect(h.check()).toBe(false);
    expect(h.calls).toContain(RUNS_URL.replace('&page=1', '&page=2'));
  });

  it.each([2, 1001])('rejects a truncated run listing (total %s)', (total_count) => {
    const h = proofHarness();
    h.responses.set(RUNS_URL, { total_count, workflow_runs: [h.proof.run] });
    expect(h.check()).toBe(false);
  });

  it.each([
    { pin: '' },
    { baselineSha: '' },
    { baselineSha: 'abc' },
    { feRepo: 'fork/cloudlands-fe' },
  ])('rejects invalid guard inputs %j', (options) => {
    expect(proofHarness().check(options)).toBe(false);
  });
});
