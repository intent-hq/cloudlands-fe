// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_REPO,
  GH_MAX_BUFFER,
  GhError,
  UsageError,
  collectRun,
  createGhRunner,
  gh,
  main,
  parseArgs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs module without type declarations
} from './ct-run-failures.mjs';

const RUN_ID = '35200851715';
const RUN_URL = `https://github.com/intent-hq/cloudlands-fe/actions/runs/${RUN_ID}`;
const PAGE_1 = 'per_page=100&page=1';

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

type Page = Record<string, unknown>;
// A listing fixture is one page (served for page 1 only) or an explicit page array.
function servePage(fixture: Page | Page[], path: string) {
  const page = Number(new URL(path, 'https://api.github.com/').searchParams.get('page'));
  const pages = Array.isArray(fixture) ? fixture : [fixture];
  if (page < 1 || page > pages.length) throw new Error(`unexpected page ${page} for ${path}`);
  return pages[page - 1];
}

function fakeRunner({
  logs = {} as Record<number, string>,
  jobs = JOBS as Page | Page[],
  artifacts = ARTIFACTS as Page | Page[],
  latestAttempt = 1,
} = {}) {
  const calls: string[] = [];
  const runner = {
    api: (path: string) => {
      calls.push(`api ${path}`);
      if (path.includes('/artifacts')) return servePage(artifacts, path);
      if (path.includes('/jobs')) return servePage(jobs, path);
      if (path.endsWith(`/actions/runs/${RUN_ID}`)) return { run_attempt: latestAttempt };
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
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/jobs?${PAGE_1}`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/artifacts?${PAGE_1}`,
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
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/attempts/2/jobs?${PAGE_1}`,
    );
  });

  it('follows jobs and artifacts pagination past a full first page', () => {
    const filler = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: 1000 + i,
        name: `${prefix} ${i}`,
        conclusion: 'success',
        run_attempt: 1,
        expired: false,
      }));
    const jobs = [
      { total_count: 101, jobs: filler('Unit', 100) },
      {
        total_count: 101,
        jobs: [
          { id: 22, name: 'Component Tests (shard 2/4)', conclusion: 'failure', run_attempt: 1 },
        ],
      },
    ];
    const artifacts = [
      { total_count: 101, artifacts: filler('coverage', 100) },
      {
        total_count: 101,
        artifacts: [{ id: 900, name: 'playwright-ct-report-2-of-4', expired: false }],
      },
    ];
    const { runner, calls } = fakeRunner({ jobs, artifacts });
    const { shards } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(
      shards.map((s: { shard: number; source: string | null }) => [s.shard, s.source]),
    ).toEqual([[2, 'json']]);
    expect(calls).toEqual([
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/jobs?${PAGE_1}`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/jobs?per_page=100&page=2`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/artifacts?${PAGE_1}`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/artifacts?per_page=100&page=2`,
      'download playwright-ct-report-2-of-4',
    ]);
  });

  it('stops paginating at total_count when the last page is full', () => {
    const jobs = {
      total_count: 100,
      jobs: Array.from({ length: 100 }, (_, i) => ({
        id: 1000 + i,
        name: i === 99 ? 'Component Tests (shard 1/4)' : `Unit ${i}`,
        conclusion: 'success',
        run_attempt: 1,
      })),
    };
    const { runner, calls } = fakeRunner({ jobs });
    const { shards } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/jobs'))).toEqual([
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/jobs?${PAGE_1}`,
    ]);
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

  it('uses the job log, not a download, when a rerun left several same-named artifacts', () => {
    const artifacts = {
      total_count: 3,
      artifacts: [
        { id: 890, name: 'playwright-ct-report-2-of-4', expired: false },
        { id: 900, name: 'playwright-ct-report-2-of-4', expired: false },
        { id: 901, name: 'playwright-ct-report-3-of-4', expired: true },
      ],
    };
    const { runner, calls } = fakeRunner({
      artifacts,
      logs: { 22: LOG_WITH_SUMMARY, 33: LOG_WITH_SUMMARY, 44: LOG_WITHOUT_SUMMARY },
    });
    const { shards, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: undefined,
      runner,
    });
    expect(shards[1].source).toBe('log');
    expect(shards[1].cases).toEqual([
      expect.objectContaining({ status: 'flaky', title: 'wobbles' }),
    ]);
    expect(warnings).toEqual([
      'shard 2/4: multiple artifacts named playwright-ct-report-2-of-4 (rerun); using job logs',
      expect.stringMatching(/^shard 2\/4: no JSON report artifact/),
      expect.stringMatching(/^shard 3\/4: no JSON report artifact/),
    ]);
    // Never downloads: the duplicate for shard 2 is skipped, shard 3's is expired.
    expect(calls.filter((c) => c.startsWith('download'))).toEqual([]);
    expect(calls).toContain('log 22');
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

  it('uses only job logs for a non-latest --attempt because artifacts are run-wide', () => {
    const attempt1Jobs = {
      total_count: 1,
      jobs: [
        { id: 33, name: 'Component Tests (shard 2/4)', conclusion: 'failure', run_attempt: 1 },
      ],
    };
    const log = [...requiredLaneHeader(2), ...REQUIRED_FAILED_SUMMARY].join('\n');
    const { runner, calls } = fakeRunner({
      jobs: attempt1Jobs,
      logs: { 33: log },
      latestAttempt: 2,
    });
    const { shards, attempt, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: 1,
      runner,
    });
    expect(attempt).toBe(1);
    // Shard 2's artifact holds a JSON report (attempt 2's); it must not be read.
    expect(shards[0].source).toBe('log');
    expect(shards[0].cases).toEqual([REQUIRED_CASE]);
    expect(warnings[0]).toBe(
      'artifacts are run-wide; attempt 1 is not the latest (2), using job logs',
    );
    expect(calls).toEqual([
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}/attempts/1/jobs?${PAGE_1}`,
      `api repos/${DEFAULT_REPO}/actions/runs/${RUN_ID}`,
      'log 33',
    ]);
  });

  it('keeps the artifact path for an explicit --attempt that is the latest', () => {
    const { runner, calls } = fakeRunner({ logs: { 33: LOG_WITH_SUMMARY }, latestAttempt: 1 });
    const { shards, warnings } = collectRun({
      runId: RUN_ID,
      repo: DEFAULT_REPO,
      attempt: 1,
      runner,
    });
    expect(shards[1].source).toBe('json');
    expect(warnings).toEqual([expect.stringMatching(/^shard 3\/4: no JSON report artifact/)]);
    expect(calls).toContain('download playwright-ct-report-2-of-4');
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

// --- real subprocess boundary ---------------------------------------------------

/**
 * Put a fake `gh` executable first on PATH. It answers the jobs / artifacts
 * listings for one red shard 2 (no artifact) and streams `log` for its job log.
 */
function installFakeGh(log: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-run-failures-fake-gh-'));
  writeFileSync(join(dir, 'job.log'), log);
  const jobs = {
    total_count: 1,
    jobs: [{ id: 22, name: 'Component Tests (shard 2/4)', conclusion: 'failure', run_attempt: 1 }],
  };
  const script = [
    `#!${process.execPath}`,
    "const { readFileSync } = require('node:fs');",
    'const args = process.argv.slice(2);',
    'const target = args[args.length - 1];',
    `if (args[0] === 'api' && args[1] === '--allow-escape-sequences') process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'job.log'))}, 'utf8'));`,
    "else if (args[0] === 'api' && target.includes('/artifacts')) process.stdout.write(JSON.stringify({ total_count: 0, artifacts: [] }));",
    `else if (args[0] === 'api' && target.includes('/jobs')) process.stdout.write(${JSON.stringify(JSON.stringify(jobs))});`,
    "else { process.stderr.write('fake gh: unexpected ' + args.join(' ')); process.exit(1); }",
    '',
  ].join('\n');
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath ?? ''}`;
  return () => {
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  };
}

describe('gh subprocess boundary', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  // Build output, retry traces, then the summary: well past Node's default 1 MiB.
  const BIG_LOG = [
    ...requiredLaneHeader(2),
    ...Array.from({ length: 20_000 }, (_, i) => `${T}  build chunk ${i} ${'x'.repeat(48)}`),
    ...REQUIRED_FAILED_SUMMARY,
  ].join('\n');

  it('lists the cases of a >1 MiB job log through the real gh runner with exit 0', () => {
    expect(Buffer.byteLength(BIG_LOG)).toBeGreaterThan(1024 * 1024);
    cleanups.push(installFakeGh(BIG_LOG));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = main([RUN_ID, '--json'], {
      stdout: { write: (s: string) => stdout.push(s) },
      stderr: { write: (s: string) => stderr.push(s) },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.totals).toEqual({ failed: 1, flaky: 0, redShards: 1 });
    expect(parsed.shards[0].source).toBe('log');
    expect(parsed.shards[0].cases).toEqual([REQUIRED_CASE]);
    expect(stderr.join('')).not.toMatch(/error:/);
  });

  it('names the buffer limit when gh output exceeds maxBuffer', () => {
    cleanups.push(installFakeGh(BIG_LOG));
    const args = ['api', '--allow-escape-sequences', 'repos/o/r/actions/jobs/22/logs'];
    expect(GH_MAX_BUFFER).toBe(64 * 1024 * 1024);
    let caught: unknown;
    try {
      gh(args, { maxBuffer: 4096 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GhError);
    expect((caught as Error).message).toBe(
      'gh api --allow-escape-sequences output exceeded the 4096 byte buffer limit',
    );
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
