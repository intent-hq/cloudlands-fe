// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPO,
  UsageError,
  collectRun,
  createGhRunner,
  main,
  parseArgs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs module without type declarations
} from './ct-run-failures.mjs';

const RUN_ID = '35200851715';
const RUN_URL = `https://github.com/intent-hq/cloudlands-fe/actions/runs/${RUN_ID}`;

describe('parseArgs', () => {
  it('accepts a bare run id with defaults', () => {
    expect(parseArgs([RUN_ID])).toEqual({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      json: false,
      help: false,
    });
  });

  it('extracts the run id from an actions run URL, including job and attempt sub-paths', () => {
    expect(parseArgs([RUN_URL]).runId).toBe(RUN_ID);
    expect(parseArgs([`${RUN_URL}/job/105135040443`]).runId).toBe(RUN_ID);
    expect(parseArgs([`${RUN_URL}/attempts/2?check_suite_focus=true`]).runId).toBe(RUN_ID);
  });

  it('parses --repo, --attempt, and --json in any order', () => {
    expect(parseArgs(['--json', '--attempt', '2', RUN_ID, '--repo', 'acme/widgets'])).toEqual({
      runId: RUN_ID,
      repo: 'acme/widgets',
      attempt: 2,
      json: true,
      help: false,
    });
  });

  it('rejects malformed input with a UsageError', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(['not-a-run'])).toThrow(UsageError);
    expect(() => parseArgs([RUN_ID, '--attempt', '0'])).toThrow(UsageError);
    expect(() => parseArgs([RUN_ID, '--attempt'])).toThrow(UsageError);
    expect(() => parseArgs([RUN_ID, '--repo', 'no-slash'])).toThrow(UsageError);
    expect(() => parseArgs([RUN_ID, '--bogus'])).toThrow(UsageError);
    expect(() => parseArgs([RUN_ID, '123'])).toThrow(UsageError);
  });

  it('accepts --help without a run id', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

// --- fake gh boundary ---------------------------------------------------------

const JOBS = {
  total_count: 5,
  jobs: [
    { id: 1, name: 'Lint & Typecheck', conclusion: 'success', run_attempt: 1 },
    { id: 11, name: 'Component Tests (shard 1/4)', conclusion: 'success', run_attempt: 1 },
    { id: 22, name: 'Component Tests (shard 2/4)', conclusion: 'failure', run_attempt: 1 },
    { id: 33, name: 'Component Tests (shard 3/4)', conclusion: 'failure', run_attempt: 1 },
    { id: 44, name: 'Component Tests (shard 4/4)', conclusion: 'failure', run_attempt: 1 },
  ],
};

const ARTIFACTS = {
  total_count: 2,
  artifacts: [
    { id: 900, name: 'playwright-ct-report-2-of-4', expired: false },
    { id: 901, name: 'playwright-ct-report-3-of-4', expired: true },
  ],
};

const JSON_REPORT = {
  suites: [
    {
      title: 'lib/a.ct.spec.ts',
      file: 'lib/a.ct.spec.ts',
      specs: [
        {
          title: 'breaks',
          file: 'lib/a.ct.spec.ts',
          line: 3,
          column: 1,
          tests: [{ status: 'unexpected', projectName: 'chromium' }],
        },
      ],
      suites: [],
    },
  ],
};

const T = '2026-09-17T09:35:51.5264218Z ';
// The required-lane step header as GitHub logs it (script echo in ANSI colour).
function requiredLaneHeader(shard: number) {
  return [
    `${T}##[group]Run set -euo pipefail`,
    `${T}\u001b[36;1mpnpm run test:ct --shard=${shard}/4 --grep-invert '@quarantine\\b' --fail-on-flaky-tests --reporter=list,html,json\u001b[0m`,
    `${T}##[endgroup]`,
  ];
}
// The advisory quarantine lane (shard 1 only), run after a red required step.
function advisoryLane(summary: string[]) {
  return [
    `${T}##[error]Process completed with exit code 1.`,
    `${T}##[group]Run pnpm run test:ct --grep '@quarantine\\b' --pass-with-no-tests --reporter=list,html --output=test-results-quarantine`,
    `${T}\u001b[36;1mpnpm run test:ct --grep '@quarantine\\b' --pass-with-no-tests --reporter=list,html --output=test-results-quarantine\u001b[0m`,
    `${T}##[endgroup]`,
    ...summary,
    `${T}##[group]Run actions/upload-artifact@v7`,
  ];
}
const FLAKY_SUMMARY = [
  `${T}  1 flaky`,
  `${T}    [chromium] › src/lib/b.ct.spec.ts:54:1 › wobbles`,
  `${T}  244 passed (11.4m)`,
];
const REQUIRED_FAILED_SUMMARY = [
  `${T}  1 failed`,
  `${T}    [chromium] › src/lib/a.ct.spec.ts:3:1 › required regression`,
  `${T}  240 passed (9.0m)`,
];
const REQUIRED_CASE = {
  status: 'failed',
  specFile: 'src/lib/a.ct.spec.ts',
  title: 'required regression',
  location: 'src/lib/a.ct.spec.ts:3:1',
};

const LOG_WITH_SUMMARY = [...requiredLaneHeader(3), ...FLAKY_SUMMARY].join('\n');

const LOG_WITHOUT_SUMMARY = [
  ...requiredLaneHeader(4),
  `${T}##[error]Process completed with exit code 137.`,
].join('\n');

function fakeRunner({
  logs = {} as Record<number, string>,
  jobs = JOBS,
  artifacts = ARTIFACTS,
} = {}) {
  const calls: string[] = [];
  const runner = {
    api: (path: string) => {
      calls.push(`api ${path}`);
      if (path.includes('/artifacts')) return artifacts;
      if (path.includes('/jobs')) return jobs;
      throw new Error(`unexpected api path ${path}`);
    },
    jobLog: (_repo: string, jobId: number) => {
      calls.push(`log ${jobId}`);
      return logs[jobId] ?? '';
    },
    jsonReport: (_repo: string, _runId: string, name: string) => {
      calls.push(`download ${name}`);
      return name === 'playwright-ct-report-2-of-4' ? JSON_REPORT : null;
    },
  };
  return { runner, calls };
}

describe('collectRun shard resolution', () => {
  it('skips green shards, reads JSON where the artifact has a report, and falls back to the log otherwise', () => {
    const { runner, calls } = fakeRunner({
      logs: { 33: LOG_WITH_SUMMARY, 44: LOG_WITHOUT_SUMMARY },
    });
    const { shards, attempt, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });

    expect(attempt).toBe(1);
    expect(
      shards.map((s: { shard: number; source: string | null }) => [s.shard, s.source]),
    ).toEqual([
      [1, null],
      [2, 'json'],
      [3, 'log'],
      [4, null],
    ]);
    expect(shards[0].cases).toEqual([]);
    expect(shards[1].cases).toEqual([
      {
        status: 'failed',
        specFile: 'lib/a.ct.spec.ts',
        title: 'breaks',
        location: 'lib/a.ct.spec.ts:3:1',
      },
    ]);
    expect(shards[2].cases).toEqual([
      {
        status: 'flaky',
        specFile: 'src/lib/b.ct.spec.ts',
        title: 'wobbles',
        location: 'src/lib/b.ct.spec.ts:54:1',
      },
    ]);
    expect(shards[3].note).toMatch(/no test summary found/);
    expect(warnings).toEqual([expect.stringMatching(/^shard 3\/4: no JSON report artifact/)]);

    // Green shard 1: no download, no log. Expired artifact for shard 3 and
    // missing artifact for shard 4: never downloaded.
    expect(calls).toEqual([
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/jobs?per_page=100`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/artifacts?per_page=100`,
      'download playwright-ct-report-2-of-4',
      'log 33',
      'log 44',
    ]);
  });

  it('queries the attempt-scoped jobs endpoint when --attempt is given', () => {
    const { runner, calls } = fakeRunner({ logs: { 33: LOG_WITH_SUMMARY } });
    const { attempt } = collectRun({ runId: RUN_ID, repo: DEFAULT_REPO, attempt: 2, runner });
    expect(attempt).toBe(2);
    expect(calls[0]).toBe(
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/attempts/2/jobs?per_page=100`,
    );
  });

  it('lists only the required-lane cases when a red shard 1 is followed by a green advisory lane', () => {
    const log = [
      ...requiredLaneHeader(1),
      ...REQUIRED_FAILED_SUMMARY,
      ...advisoryLane([`${T}  1 passed (20.0s)`]),
    ].join('\n');
    const { runner } = fakeRunner({ logs: { 33: log } });
    const { shards, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards[2].source).toBe('log');
    expect(shards[2].cases).toEqual([REQUIRED_CASE]);
    expect(warnings).toEqual([expect.stringMatching(/^shard 3\/4: no JSON report artifact/)]);
  });

  it('lists only the required-lane cases when the advisory lane fails too', () => {
    const log = [
      ...requiredLaneHeader(1),
      ...REQUIRED_FAILED_SUMMARY,
      ...advisoryLane([
        `${T}  1 failed`,
        `${T}    [chromium] › src/lib/q.ct.spec.ts:9:1 › quarantined flake @quarantine`,
      ]),
    ].join('\n');
    const { runner } = fakeRunner({ logs: { 33: log } });
    const { shards } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards[2].cases).toEqual([REQUIRED_CASE]);
  });

  it('reads the required lane of a shard without an advisory step unchanged', () => {
    const log = [
      ...requiredLaneHeader(3),
      ...REQUIRED_FAILED_SUMMARY,
      `${T}##[error]Process completed with exit code 1.`,
      `${T}##[group]Run actions/upload-artifact@v7`,
    ].join('\n');
    const { runner } = fakeRunner({ logs: { 33: log } });
    const { shards } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards[2].cases).toEqual([REQUIRED_CASE]);
  });

  it('falls back to the whole log with a warning when the required-lane step is not found', () => {
    const { runner } = fakeRunner({ logs: { 33: FLAKY_SUMMARY.join('\n') } });
    const { shards, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards[2].source).toBe('log');
    expect(shards[2].cases).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringMatching(/^shard 3\/4: required-lane step not found/),
      expect.stringMatching(/^shard 3\/4: no JSON report artifact/),
    ]);
  });

  it('returns no shards for a run without CT jobs and never fetches artifacts', () => {
    const { runner, calls } = fakeRunner({
      jobs: {
        total_count: 1,
        jobs: [{ id: 1, name: 'publish', conclusion: 'success', run_attempt: 1 }],
      },
    });
    expect(
      collectRun({ runId: RUN_ID, repo: DEFAULT_REPO, attempt: undefined, runner }).shards,
    ).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('createGhRunner gh argv', () => {
  it('passes --allow-escape-sequences for job logs and downloads artifacts into the temp dir', () => {
    const argv: string[][] = [];
    const run = (args: string[]) => {
      argv.push(args);
      return args[0] === 'api' && !args.includes('--allow-escape-sequences') ? '{"ok":true}' : '';
    };
    const runner = createGhRunner({ tmpDir: '/tmp/ct-run-failures-test', run });

    expect(runner.api('repos/o/r/actions/runs/1/jobs')).toEqual({ ok: true });
    runner.jobLog('o/r', 42);
    expect(runner.jsonReport('o/r', RUN_ID, 'playwright-ct-report-1-of-4')).toBeNull();

    expect(argv).toEqual([
      ['api', 'repos/o/r/actions/runs/1/jobs'],
      ['api', '--allow-escape-sequences', 'repos/o/r/actions/jobs/42/logs'],
      [
        'run',
        'download',
        RUN_ID,
        '--repo',
        'o/r',
        '--name',
        'playwright-ct-report-1-of-4',
        '--dir',
        '/tmp/ct-run-failures-test/playwright-ct-report-1-of-4',
      ],
    ]);
  });
});

describe('main', () => {
  function capture() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      io: {
        stdout: { write: (s: string) => stdout.push(s) },
        stderr: { write: (s: string) => stderr.push(s) },
      },
      stdout: () => stdout.join(''),
      stderr: () => stderr.join(''),
    };
  }

  it('prints the listing and exits 0 even with failures', () => {
    const { io, stdout, stderr } = capture();
    const { runner } = fakeRunner({ logs: { 33: LOG_WITH_SUMMARY, 44: LOG_WITHOUT_SUMMARY } });
    const code = main([RUN_ID], { createRunner: () => runner, ...io });
    expect(code).toBe(0);
    expect(stdout()).toContain(`Run ${RUN_ID} (${DEFAULT_REPO}, attempt 1) — Component Tests`);
    expect(stdout()).toContain('Total: 1 failed, 1 flaky across 3 red shards');
    expect(stderr()).toMatch(/^warning: shard 3\/4: no JSON report artifact/);
  });

  it('--json prints a parseable report', () => {
    const { io, stdout } = capture();
    const { runner } = fakeRunner({ logs: { 33: LOG_WITH_SUMMARY } });
    expect(main([RUN_ID, '--json'], { createRunner: () => runner, ...io })).toBe(0);
    const parsed = JSON.parse(stdout());
    expect(parsed.runId).toBe(RUN_ID);
    expect(parsed.totals).toEqual({ failed: 1, flaky: 1, redShards: 3 });
  });

  it('exits 2 naming the run when it has no CT jobs', () => {
    const { io, stderr } = capture();
    const { runner } = fakeRunner({
      jobs: {
        total_count: 1,
        jobs: [{ id: 1, name: 'publish', conclusion: 'success', run_attempt: 1 }],
      },
    });
    expect(main([RUN_ID], { createRunner: () => runner, ...io })).toBe(2);
    expect(stderr()).toContain(
      `Run ${RUN_ID} (${DEFAULT_REPO}) has no Component Tests shard jobs.`,
    );
  });

  it('exits 2 with usage on bad arguments and 0 on --help', () => {
    const bad = capture();
    expect(main([], { createRunner: () => fakeRunner().runner, ...bad.io })).toBe(2);
    expect(bad.stderr()).toContain('usage:');
    const help = capture();
    expect(main(['--help'], { createRunner: () => fakeRunner().runner, ...help.io })).toBe(0);
    expect(help.stdout()).toContain('usage:');
  });
});
