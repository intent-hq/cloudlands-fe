// @verify-changed-triggers: .github/workflows/auto-cut-alpha.yml, scripts/intentd-release-readiness.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmedIntentdNoop } from './intentd-release-readiness.mjs';

const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const workflow = load(readFileSync('.github/workflows/auto-cut-alpha.yml', 'utf8'));
const steps = workflow.jobs['auto-merge-release-pr'].steps as { name: string; run?: string }[];
const PIN = '0.9.110';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const FE = 'intent-hq/cloudlands-fe';
const BE = 'intent-hq/intentd';
const directories: string[] = [];

function fixture() {
  return {
    pin: PIN,
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
  };
}

// Mock only the remote boundary. Execute the real workflow Bash (including
// the new helper's CLI), with gh's jq projection still evaluated by real jq.
function runCut(
  data = fixture(),
  event = 'schedule',
  stepName = 'Merge the Release PR when green',
  throttleTag = '',
) {
  const directory = mkdtempSync(join(tmpdir(), 'intentd-readiness-'));
  directories.push(directory);
  writeFileSync(join(directory, 'fixture.json'), JSON.stringify(data));
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
else if (endpoint === 'graphql') {
  if (a.some(x => x.includes('viewer'))) value = { data: { viewer: { login: 'releaser' } } };
  else { process.stdout.write(String(f.unresolved)); process.exit(0); }
}
else if (endpoint.includes('/contents/intentd.version')) value = {content: Buffer.from(f.pin + '\\n').toString('base64')};
else if (endpoint === 'repos/${BE}/compare/v${PIN}...main?per_page=1') value = f.compare;
else if (endpoint === 'repos/${BE}/git/matching-refs/tags/v') value = [{ref: 'refs/tags/' + f.beTag}];
else if (endpoint.includes('/git/matching-refs/tags/v')) value = [{ref: 'refs/tags/v3.0.0'}];
else if (endpoint === 'repos/${FE}/compare/v3.0.0...main?per_page=250') value = {commits: f.commits};
else if (endpoint === 'repos/${BE}/git/ref/heads/main') value = {object: {sha: f.proof.head}};
else if (endpoint === 'repos/${BE}/commits/v${PIN}') value = {sha: '${BASE}'};
else if (endpoint === 'repos/${BE}/commits/' + f.beTag) value = {commit: {committer: {date: f.beTagDate}}};
else if (endpoint === 'repos/${FE}/commits/v3.0.0') value = {commit: {committer: {date: '2026-09-26T05:50:00Z'}}};
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
    '#!/usr/bin/env bash\nif [[ "$*" == "+%s" ]]; then exec /usr/bin/date -d "2026-09-26T06:00:00Z" +%s; fi\nexec /usr/bin/date "$@"\n',
    { mode: 0o755 },
  );
  const result = spawnSync('bash', ['-c', steps.find((s) => s.name === stepName)!.run!], {
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      READINESS_FIXTURE: join(directory, 'fixture.json'),
      READINESS_CALLS: join(directory, 'calls'),
      GITHUB_REPOSITORY: FE,
      EVENT_NAME: event,
      DRY_RUN: 'true',
      THROTTLE_TAG: throttleTag,
      GITHUB_OUTPUT: join(directory, 'outputs'),
      MANIFEST_MIRROR_URL: 'https://example.invalid/alpha.json',
      RELEASE_PAT: 'mock',
      GH_TOKEN: 'mock',
    },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const calls = readFileSync(join(directory, 'calls'), 'utf8');
  expect(calls).not.toContain('"merge"');
  return {
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
    expect(runCut(data).cut).toBe(false);
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
    if (guard === 'conflict') data.detail.mergeable = 'CONFLICTING';
    if (guard === 'draft') data.detail.isDraft = true;
    if (guard === 'fork') data.pr.isCrossRepository = true;
    if (guard === 'author') data.pr.author.login = 'someone-else';
    expect(runCut(data).cut).toBe(false);
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
