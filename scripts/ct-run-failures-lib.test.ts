// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  casesFromJsonReport,
  casesFromListLog,
  formatReport,
  hasListLogSummary,
  parseCtJobs,
  requiredLaneLog,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs module without type declarations
} from './ct-run-failures-lib.mjs';

const HOVER_SPEC =
  'src/lib/components/workspace/__tests__/workspace-hover-card.geometry.ct.spec.ts';
const GENERATOR = 'src/lib/component-catalog/geometry-snapshot.ts';
const FILES_MENU_SPEC = 'src/lib/components/workspace/__tests__/files-open-menu.ct.spec.ts';

// --- GitHub jobs payload -----------------------------------------------------

const JOBS_PAYLOAD = {
  total_count: 7,
  jobs: [
    { id: 1, name: 'Lint & Typecheck', conclusion: 'success' },
    { id: 44, name: 'Component Tests (shard 4/4)', conclusion: 'failure' },
    { id: 11, name: 'Component Tests (shard 1/4)', conclusion: 'success' },
    { id: 22, name: 'Component Tests (shard 2/4)', conclusion: 'success' },
    { id: 5, name: 'Component Tests (quarantine, advisory)', conclusion: 'success' },
    { id: 33, name: 'Component Tests (shard 3/4)', conclusion: null },
    { id: 6, name: 'Unit Tests', conclusion: 'success' },
  ],
};

// --- Playwright JSON report ---------------------------------------------------

function result(status: string, retry: number) {
  return { status, retry, duration: 1, errors: [], stdout: [], stderr: [], attachments: [] };
}

function test(status: string, results: ReturnType<typeof result>[], projectName = 'chromium') {
  return { status, results, projectName, projectId: projectName, expectedStatus: 'passed' };
}

const JSON_REPORT = {
  suites: [
    {
      title: HOVER_SPEC,
      file: HOVER_SPEC,
      line: 0,
      column: 0,
      specs: [],
      suites: [
        {
          title: 'workspace hover-card snapshots with a fixed clock',
          file: HOVER_SPEC,
          line: 12,
          column: 1,
          specs: [
            {
              title: 'workspace-hover-card.geometry working 720px geometry snapshot',
              file: GENERATOR,
              line: 108,
              column: 7,
              ok: false,
              tests: [
                test('unexpected', [result('failed', 0), result('failed', 1), result('failed', 2)]),
              ],
            },
            {
              title: 'workspace-hover-card.geometry dense 720px geometry snapshot',
              file: GENERATOR,
              line: 108,
              column: 7,
              ok: true,
              tests: [test('expected', [result('passed', 0)])],
            },
          ],
        },
      ],
    },
    {
      title: FILES_MENU_SPEC,
      file: FILES_MENU_SPEC,
      line: 0,
      column: 0,
      specs: [
        {
          title: 'Files menu keyboard navigation executes each mock action once and restores focus',
          file: FILES_MENU_SPEC,
          line: 54,
          column: 1,
          ok: true,
          tests: [test('flaky', [result('failed', 0), result('passed', 1)])],
        },
        {
          title: 'skipped on this shard',
          file: FILES_MENU_SPEC,
          line: 90,
          column: 1,
          ok: true,
          tests: [test('skipped', [result('skipped', 0)])],
        },
      ],
    },
    {
      title: 'src/lib/components/ui/button/__tests__/button.geometry.ct.spec.ts',
      file: 'src/lib/components/ui/button/__tests__/button.geometry.ct.spec.ts',
      line: 0,
      column: 0,
      specs: [],
      suites: [
        {
          title: 'button geometry regression detection',
          file: 'src/lib/components/ui/button/__tests__/button.geometry.ct.spec.ts',
          line: 20,
          column: 1,
          specs: [
            {
              title: 'button.geometry default 420px geometry snapshot',
              file: GENERATOR,
              line: 108,
              column: 7,
              ok: true,
              tests: [
                {
                  ...test('expected', [result('failed', 0)]),
                  expectedStatus: 'failed',
                  annotations: [{ type: 'fail' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 1 },
};

// --- List-reporter log (modelled on job 105135040443) ------------------------

const PREFIX = 'Component Tests (shard 4/4)\tUNKNOWN STEP\t2026-09-17T09:35:51.5264218Z ';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const HOVER_STATES = ['working', 'attention', 'dense', 'landscape-wide', 'landscape-narrow'];
const hoverTitle = (state: string) =>
  `workspace hover-card snapshots with a fixed clock › workspace-hover-card.geometry ${state} 720px geometry snapshot`;
const FLAKY_TITLES: [string, string][] = [
  [
    `${FILES_MENU_SPEC}:54:1`,
    'Files menu keyboard navigation executes each mock action once and restores focus',
  ],
  [`${FILES_MENU_SPEC}:211:3`, 'collapsed Files launcher is a transparent aligned action at 360px'],
];

function listReporterLog(): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(`${PREFIX}${line}`);
  push('Running 251 tests using 1 worker, shard 4 of 4');
  push('');
  push(
    `  ${RED}✘${RESET}   42 [chromium] › ${GENERATOR}:108:7 › button geometry regression detection › button.geometry default 420px geometry snapshot (1.4s)`,
  );
  for (const [location, title] of FLAKY_TITLES) {
    push(`  ${RED}✘${RESET}  139 [chromium] › ${location} › ${title} (7.2s)`);
    push(`  ✓  139 [chromium] › ${location} › ${title} ${YELLOW}(retry #1)${RESET} (2.1s)`);
  }
  HOVER_STATES.forEach((state, index) => {
    const base = `[chromium] › ${GENERATOR}:108:7 › ${hoverTitle(state)}`;
    push(`  ${RED}✘${RESET}  ${230 + index} ${base} (1.7s)`);
    push(`  ${RED}✘${RESET}  ${230 + index} ${base} ${YELLOW}(retry #1)${RESET} (1.6s)`);
    push(`  ${RED}✘${RESET}  ${230 + index} ${base} ${YELLOW}(retry #2)${RESET} (1.6s)`);
  });
  push('');
  push('');
  push(`  1) [chromium] › ${GENERATOR}:108:7 › ${hoverTitle('working')} ─────────`);
  push('');
  push('    Error: geometry snapshot mismatch');
  push('');
  push('    Retry #1 ───────────────────────────────────────────────────────────────');
  push('');
  push('    Error: geometry snapshot mismatch');
  push('');
  push(
    `    Error Context: test-results/lib-components-workspace-_-823ec-ent-aligned-action-at-360px-chromium/error-context.md`,
  );
  push('');
  push(`  ${RED}5 failed${RESET}`);
  for (const state of HOVER_STATES) {
    push(`    ${RED}[chromium] › ${GENERATOR}:108:7 › ${hoverTitle(state)} ${RESET}`);
  }
  push(`  ${YELLOW}2 flaky${RESET}`);
  for (const [location, title] of FLAKY_TITLES) {
    push(`    ${YELLOW}[chromium] › ${location} › ${title} ${RESET}`);
  }
  push('  244 passed (11.4m)');
  push(' ELIFECYCLE  Command failed with exit code 1.');
  push('##[error]Process completed with exit code 1.');
  return lines.join('\n');
}

// --- Tests --------------------------------------------------------------------

describe('parseCtJobs', () => {
  it('selects the CT shard jobs sorted by shard, ignoring other jobs', () => {
    expect(parseCtJobs(JOBS_PAYLOAD)).toEqual([
      {
        jobId: 11,
        shard: 1,
        shardCount: 4,
        conclusion: 'success',
        name: 'Component Tests (shard 1/4)',
      },
      {
        jobId: 22,
        shard: 2,
        shardCount: 4,
        conclusion: 'success',
        name: 'Component Tests (shard 2/4)',
      },
      { jobId: 33, shard: 3, shardCount: 4, conclusion: null, name: 'Component Tests (shard 3/4)' },
      {
        jobId: 44,
        shard: 4,
        shardCount: 4,
        conclusion: 'failure',
        name: 'Component Tests (shard 4/4)',
      },
    ]);
  });

  it('accepts a bare jobs array and returns [] when there are no CT jobs', () => {
    expect(parseCtJobs(JOBS_PAYLOAD.jobs)).toHaveLength(4);
    expect(parseCtJobs({ jobs: [{ id: 1, name: 'Lint', conclusion: 'success' }] })).toEqual([]);
    expect(parseCtJobs(undefined)).toEqual([]);
  });
});

describe('casesFromJsonReport', () => {
  it('lists unexpected and flaky specs once, located at their spec file', () => {
    expect(casesFromJsonReport(JSON_REPORT)).toEqual([
      {
        status: 'failed',
        specFile: HOVER_SPEC,
        title:
          'workspace hover-card snapshots with a fixed clock › workspace-hover-card.geometry working 720px geometry snapshot',
        location: `${GENERATOR}:108:7`,
      },
      {
        status: 'flaky',
        specFile: FILES_MENU_SPEC,
        title: 'Files menu keyboard navigation executes each mock action once and restores focus',
        location: `${FILES_MENU_SPEC}:54:1`,
      },
    ]);
  });

  it('drops expected failures (test.fail) and skipped specs', () => {
    const titles = casesFromJsonReport(JSON_REPORT).map((c: { title: string }) => c.title);
    expect(titles).not.toContain(expect.stringContaining('button.geometry default'));
    expect(titles).not.toContain('skipped on this shard');
  });

  it('reports failed over flaky when projects disagree and tolerates empty input', () => {
    const report = {
      suites: [
        {
          title: 'a.ct.spec.ts',
          file: 'a.ct.spec.ts',
          line: 0,
          column: 0,
          specs: [
            {
              title: 'case',
              file: 'a.ct.spec.ts',
              line: 3,
              column: 1,
              tests: [
                test('flaky', [result('failed', 0), result('passed', 1)], 'chromium'),
                test('unexpected', [result('failed', 0), result('failed', 1)], 'firefox'),
              ],
            },
          ],
        },
      ],
    };
    expect(casesFromJsonReport(report)).toEqual([
      { status: 'failed', specFile: 'a.ct.spec.ts', title: 'case', location: 'a.ct.spec.ts:3:1' },
    ]);
    expect(casesFromJsonReport({ suites: [] })).toEqual([]);
    expect(casesFromJsonReport(undefined)).toEqual([]);
  });
});

describe('casesFromListLog', () => {
  it('reads the summary block only: 5 failed + 2 flaky, retries collapsed, test.fail ignored', () => {
    const cases = casesFromListLog(listReporterLog());
    expect(cases.filter((c: { status: string }) => c.status === 'failed')).toHaveLength(5);
    expect(cases.filter((c: { status: string }) => c.status === 'flaky')).toHaveLength(2);
    expect(cases[0]).toEqual({
      status: 'failed',
      specFile: GENERATOR,
      title: hoverTitle('working'),
      location: `${GENERATOR}:108:7`,
    });
    expect(cases[5]).toEqual({
      status: 'flaky',
      specFile: FILES_MENU_SPEC,
      title: FLAKY_TITLES[0][1],
      location: FLAKY_TITLES[0][0],
    });
    expect(cases.map((c: { title: string }) => c.title)).not.toContain(
      expect.stringContaining('button.geometry default'),
    );
  });

  it('strips ANSI escapes, gh log prefixes, raw-log timestamps and a BOM', () => {
    const rawApiLog = listReporterLog()
      .split('\n')
      .map((line) => line.replace(/^Component Tests \(shard 4\/4\)\tUNKNOWN STEP\t/, ''))
      .join('\n');
    const cases = casesFromListLog(`\uFEFF${rawApiLog}`);
    expect(cases).toHaveLength(7);
    for (const item of cases) {
      expect(item.title).not.toMatch(/\u001b/);
      expect(item.location).not.toMatch(/\u001b|\t|Z /);
    }
  });

  it('returns [] when the log has no summary block', () => {
    const noSummary = listReporterLog().split('\n').slice(0, 20).join('\n');
    expect(casesFromListLog(noSummary)).toEqual([]);
    expect(casesFromListLog('')).toEqual([]);
    expect(casesFromListLog(undefined)).toEqual([]);
  });

  it('hasListLogSummary tells a summarized log from one that died before the summary', () => {
    expect(hasListLogSummary(listReporterLog())).toBe(true);
    expect(hasListLogSummary('2026-09-17T09:35:51.5288934Z   244 passed (11.4m)')).toBe(true);
    expect(hasListLogSummary(listReporterLog().split('\n').slice(0, 20).join('\n'))).toBe(false);
    expect(hasListLogSummary('##[error]Process completed with exit code 137.')).toBe(false);
    expect(hasListLogSummary(undefined)).toBe(false);
  });

  it('does not list cases under headers other than failed/flaky', () => {
    const log = [
      '  1 skipped',
      `    [chromium] › a.ct.spec.ts:1:1 › skipped case`,
      '  3 passed (1.0s)',
    ].join('\n');
    expect(casesFromListLog(log)).toEqual([]);
  });

  it('keeps the cases after the final header when no passed/skipped footer follows', () => {
    const failedLine = '    [chromium] › a.ct.spec.ts:1:1 › fails';
    const flakyLine = '    [chromium] › b.ct.spec.ts:2:3 › wobbles';
    const failed = {
      status: 'failed',
      specFile: 'a.ct.spec.ts',
      title: 'fails',
      location: 'a.ct.spec.ts:1:1',
    };
    const flaky = {
      status: 'flaky',
      specFile: 'b.ct.spec.ts',
      title: 'wobbles',
      location: 'b.ct.spec.ts:2:3',
    };

    expect(casesFromListLog(`  1 failed\n${failedLine}\n`)).toEqual([failed]);
    expect(casesFromListLog(`  1 flaky\n${flakyLine}\n`)).toEqual([flaky]);
    expect(casesFromListLog(['  1 failed', failedLine, '  1 flaky', flakyLine].join('\n'))).toEqual(
      [failed, flaky],
    );
    expect(
      casesFromListLog(
        ['  1 failed', failedLine, '  1 flaky', flakyLine, '  3 passed (1.0s)'].join('\n'),
      ),
    ).toEqual([failed, flaky]);
  });
});

describe('requiredLaneLog', () => {
  const T = '2026-09-17T09:24:22.9620867Z ';
  const jobLog = [
    `${T}##[group]Run pnpm run test:ct --only-changed=HEAD --pass-with-no-tests --reporter=list`,
    `${T}\u001b[36;1mpnpm run test:ct --only-changed=HEAD --pass-with-no-tests --reporter=list\u001b[0m`,
    `${T}##[endgroup]`,
    `${T}  2 passed (3.0s)`,
    `${T}##[group]Run set -euo pipefail`,
    `${T}\u001b[36;1m# or explicitly parked under the @quarantine tag below.\u001b[0m`,
    `${T}\u001b[36;1mpnpm run test:ct --shard=1/4 --grep-invert '@quarantine\\b' --fail-on-flaky-tests --reporter=list,html,json\u001b[0m`,
    `${T}##[endgroup]`,
    `${T}  1 failed`,
    `${T}    [chromium] › src/lib/a.ct.spec.ts:3:1 › required regression`,
    `${T}  240 passed (9.0m)`,
    `${T}##[error]Process completed with exit code 1.`,
    `${T}##[group]Run pnpm run test:ct --grep '@quarantine\\b' --pass-with-no-tests --reporter=list,html --output=test-results-quarantine`,
    `${T}\u001b[36;1mpnpm run test:ct --grep '@quarantine\\b' --pass-with-no-tests --reporter=list,html --output=test-results-quarantine\u001b[0m`,
    `${T}##[endgroup]`,
    `${T}  1 failed`,
    `${T}    [chromium] › src/lib/q.ct.spec.ts:9:1 › quarantined flake @quarantine`,
    `${T}##[group]Run actions/upload-artifact@v7`,
  ].join('\n');

  it('slices from the required-lane command echo to the next step', () => {
    const lane = requiredLaneLog(jobLog);
    expect(lane).toContain("--grep-invert '@quarantine");
    expect(lane).toContain('required regression');
    expect(lane).not.toContain('quarantined flake');
    expect(lane).not.toContain('--only-changed');
    expect(lane).not.toContain('upload-artifact');
    expect(casesFromListLog(lane)).toEqual([
      {
        status: 'failed',
        specFile: 'src/lib/a.ct.spec.ts',
        title: 'required regression',
        location: 'src/lib/a.ct.spec.ts:3:1',
      },
    ]);
  });

  it('runs to the end of the log when the required lane is the last step', () => {
    const lines = jobLog.split('\n');
    const lane = requiredLaneLog(lines.slice(0, 12).join('\n'));
    expect(lane).toContain('required regression');
    expect(lane).toContain('exit code 1');
  });

  it('returns null when the log carries no required-lane invocation', () => {
    expect(requiredLaneLog('  1 failed\n    [chromium] › a.ct.spec.ts:1:1 › x')).toBeNull();
    expect(requiredLaneLog('')).toBeNull();
    expect(requiredLaneLog(undefined)).toBeNull();
  });
});

describe('formatReport', () => {
  const shards = [
    { ...parseCtJobs(JOBS_PAYLOAD)[0], source: null, cases: [] },
    { ...parseCtJobs(JOBS_PAYLOAD)[2], source: null, cases: [] },
    { ...parseCtJobs(JOBS_PAYLOAD)[3], source: 'json', cases: casesFromJsonReport(JSON_REPORT) },
  ];

  it('prints one line per shard, cases under red shards, and a total with job links', () => {
    const { text } = formatReport({
      runId: 35205905401,
      repo: 'intent-hq/cloudlands-fe',
      attempt: 1,
      shards,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Run 35205905401 (intent-hq/cloudlands-fe, attempt 1) — Component Tests');
    expect(lines[1]).toBe('shard 1/4  success');
    expect(lines[2]).toBe(
      'shard 3/4  unknown  (source: none — no JSON report artifact and no log summary block)',
    );
    expect(lines[3]).toBe('shard 4/4  failure  (source: json)');
    expect(lines[4]).toBe(
      `  failed  ${HOVER_SPEC}  workspace hover-card snapshots with a fixed clock › workspace-hover-card.geometry working 720px geometry snapshot (${GENERATOR}:108:7)`,
    );
    expect(lines[5]).toBe(
      `  flaky   ${FILES_MENU_SPEC}:54:1  Files menu keyboard navigation executes each mock action once and restores focus`,
    );
    expect(lines[6]).toBe(
      'Total: 1 failed, 1 flaky across 2 red shards (job 33: https://github.com/intent-hq/cloudlands-fe/actions/runs/35205905401/job/33, job 44: https://github.com/intent-hq/cloudlands-fe/actions/runs/35205905401/job/44)',
    );
    expect(lines).toHaveLength(7);
  });

  it('annotates log-sourced shards and orders failed before flaky', () => {
    const logShard = {
      ...parseCtJobs(JOBS_PAYLOAD)[3],
      source: 'log',
      cases: [...casesFromListLog(listReporterLog())].reverse(),
    };
    const { text, json } = formatReport({ runId: 1, repo: 'o/r', shards: [logShard] });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Run 1 (o/r) — Component Tests');
    expect(lines[1]).toBe(
      'shard 4/4  failure  (source: log — no JSON report artifact; locations may be generator helpers)',
    );
    expect(lines.slice(2, 7).every((line) => line.startsWith('  failed  '))).toBe(true);
    expect(lines.slice(7, 9).every((line) => line.startsWith('  flaky   '))).toBe(true);
    expect(lines[2]).toBe(`  failed  ${GENERATOR}:108:7  ${hoverTitle('landscape-narrow')}`);
    expect(lines.at(-1)).toBe(
      'Total: 5 failed, 2 flaky across 1 red shard (job 44: https://github.com/o/r/actions/runs/1/job/44)',
    );
    expect(json).toMatchObject({
      runId: 1,
      repo: 'o/r',
      attempt: null,
      totals: { failed: 5, flaky: 2, redShards: 1 },
    });
    expect(json.shards[0]).toMatchObject({
      shard: 4,
      jobId: 44,
      jobUrl: 'https://github.com/o/r/actions/runs/1/job/44',
      conclusion: 'failure',
      source: 'log',
    });
    expect(json.shards[0].cases.map((c: { status: string }) => c.status)).toEqual([
      ...Array(5).fill('failed'),
      ...Array(2).fill('flaky'),
    ]);
  });

  it('reports an all-green run with zero red shards and no job list', () => {
    const green = parseCtJobs(JOBS_PAYLOAD).map((s) => ({
      ...s,
      conclusion: 'success',
      source: null,
      cases: [],
    }));
    const { text } = formatReport({ runId: 2, repo: 'o/r', shards: green });
    expect(text.split('\n').at(-1)).toBe('Total: 0 failed, 0 flaky across 0 red shards');
  });
});
