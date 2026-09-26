// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_ARTIFACTS } from './browser-test-artifacts.mjs';
import { resolveCtAlignedPlaywrightCli } from './ct-browser.mjs';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
const context = {
  GITHUB_REPOSITORY: 'intent-hq/cloudlands-fe',
  GITHUB_RUN_ID: '1234',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'schedule',
};

function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'browser-artifacts-'));
  directories.push(dir);
  return dir;
}

function run(cwd: string, args: string[], env = {}) {
  return spawnSync(process.execPath, [resolve('scripts/browser-test-artifacts.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...context, ...env },
  });
}

function testRecord(overrides = {}) {
  return {
    projectName: 'chromium',
    projectId: 'chromium',
    status: 'expected',
    expectedStatus: 'passed',
    results: [{ status: 'passed' }],
    ...overrides,
  };
}

describe('browser artifact producer contract', () => {
  it('enumerates all four CT shards, both root shards, Electron and advisory quarantine', () => {
    const dir = directory();
    const result = run(dir, ['manifest']);
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, 'browser-test-manifest.json'), 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(
      manifest.artifacts.map((artifact: { artifactName: string }) => artifact.artifactName),
    ).toEqual([
      'playwright-ct-report-1-of-4',
      'playwright-ct-report-2-of-4',
      'playwright-ct-report-3-of-4',
      'playwright-ct-report-4-of-4',
      'playwright-root-report-1',
      'playwright-root-report-2',
      'playwright-electron-lifetime-report',
      'playwright-ct-report-quarantine',
    ]);
    expect(
      manifest.artifacts.filter((artifact: { advisory: boolean }) => artifact.advisory),
    ).toHaveLength(1);
    expect(manifest).toMatchObject({
      repository: context.GITHUB_REPOSITORY,
      runId: '1234',
      runAttempt: '2',
      sha: context.GITHUB_SHA,
      event: 'schedule',
      ref: 'refs/heads/main',
    });
  });

  it.each(BROWSER_ARTIFACTS)(
    'records $artifactName without filtering Playwright outcomes',
    (artifact) => {
      const dir = directory();
      const report = JSON.stringify({
        suites: [
          {
            specs: [
              {
                tests: [
                  testRecord({ expectedStatus: 'failed', results: [{ status: 'failed' }] }),
                  testRecord({
                    status: 'flaky',
                    results: [{ status: 'failed' }, { status: 'passed' }],
                  }),
                  testRecord({ status: 'unexpected', results: [{ status: 'timedOut' }] }),
                  testRecord({ status: 'skipped', results: [] }),
                ],
              },
            ],
          },
        ],
        errors: [{ message: 'worker crashed' }],
      });
      mkdirSync(dirname(join(dir, artifact.reportPath)), { recursive: true });
      writeFileSync(join(dir, artifact.reportPath), report);
      const result = run(dir, ['record', artifact.suite, String(artifact.shard)], {
        BROWSER_TEST_OUTCOME: 'failure',
        BROWSER_JOB_STATUS: 'failure',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, artifact.outcomePath), 'utf8'))).toMatchObject({
        schemaVersion: 1,
        ...artifact,
        runId: '1234',
        runAttempt: '2',
        testOutcome: 'failure',
        jobStatus: 'failure',
        reportPresent: true,
        testCount: 4,
      });
      expect(readFileSync(join(dir, artifact.reportPath), 'utf8')).toBe(report);
    },
  );

  it.each(['success', 'failure', 'cancelled', 'skipped'])(
    'retains %s even when no report was produced',
    (testOutcome) => {
      const dir = directory();
      const result = run(dir, ['record', 'root', '1'], {
        BROWSER_TEST_OUTCOME: testOutcome,
        BROWSER_JOB_STATUS: 'failure',
      });
      expect(result.status, result.stderr).toBe(testOutcome === 'success' ? 1 : 0);
      expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8'))).toMatchObject({
        testOutcome,
        reportPresent: false,
        testCount: null,
      });
    },
  );

  it.each(['skipped', 'failure', 'cancelled'])(
    'rejects a required %s step hidden by a successful job status',
    (testOutcome) => {
      const dir = directory();
      const result = run(dir, ['record', 'root', '1'], {
        BROWSER_TEST_OUTCOME: testOutcome,
        BROWSER_JOB_STATUS: 'success',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('did not run successfully');
    },
  );

  it('marks a never-started step as skipped, without inventing a Playwright report', () => {
    const dir = directory();
    expect(run(dir, ['record', 'electron', '1'], { BROWSER_JOB_STATUS: 'cancelled' }).status).toBe(
      0,
    );
    expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8'))).toMatchObject({
      testOutcome: 'skipped',
      jobStatus: 'cancelled',
      reportPresent: false,
    });
  });

  it.each(['ct', 'root', 'electron'])(
    'rejects an empty or malformed successful %s report after retaining its outcome',
    (suite) => {
      for (const report of ['{"suites":[]}', '{}', 'not JSON']) {
        const dir = directory();
        mkdirSync(join(dir, 'playwright-report'));
        writeFileSync(join(dir, 'playwright-report/results.json'), report);
        const result = run(dir, ['record', suite, '1'], {
          BROWSER_TEST_OUTCOME: 'success',
          BROWSER_JOB_STATUS: 'success',
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('without a nonempty JSON test report');
        expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8'))).toMatchObject({
          testOutcome: 'success',
          testCount: report.includes('[]') ? 0 : null,
        });
      }
    },
  );

  it.each([
    ['string tests', { suites: [{ specs: [{ tests: 'not-a-test-array' }] }] }],
    ['object tests', { suites: [{ specs: [{ tests: { length: 1 } }] }] }],
    ['empty test record', { suites: [{ specs: [{ tests: [{}] }] }] }],
    ['null test record', { suites: [{ specs: [{ tests: [null] }] }] }],
    ['string test record', { suites: [{ specs: [{ tests: ['expected'] }] }] }],
    ...[
      ['unknown outcome', { status: 'success' }],
      ['missing expected status', { expectedStatus: undefined }],
      ['unknown expected status', { expectedStatus: 'expected' }],
      ['missing project identity', { projectId: undefined }],
      ['invalid project name', { projectName: null }],
      ['string results', { results: 'passed' }],
      ['object results', { results: { length: 1 } }],
      ['empty result record', { results: [{}] }],
      ['null result record', { results: [null] }],
      ['unknown result status', { results: [{ status: 'expected' }] }],
      ['missing successful execution', { results: [] }],
    ].map(([name, overrides]) => [
      name,
      { suites: [{ specs: [{ tests: [testRecord(overrides)] }] }] },
    ]),
    ['object suites', { suites: { length: 1 } }],
    ['null suite', { suites: [null] }],
    ['object specs', { suites: [{ specs: { length: 1 } }] }],
    ['null spec', { suites: [{ specs: [null] }] }],
    [
      'null specs beside valid tests',
      { suites: [{ specs: null, suites: [{ specs: [{ tests: [testRecord()] }] }] }] },
    ],
    [
      'null nested suites beside valid tests',
      { suites: [{ specs: [{ tests: [testRecord()] }], suites: null }] },
    ],
  ])('rejects malformed %s and retains the raw report and outcome', (_name, data) => {
    const dir = directory();
    mkdirSync(join(dir, 'playwright-report'));
    const report = JSON.stringify(data);
    const path = join(dir, 'playwright-report/results.json');
    writeFileSync(path, report);
    const result = run(dir, ['record', 'root', '1'], {
      BROWSER_TEST_OUTCOME: 'success',
      BROWSER_JOB_STATUS: 'success',
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('without a nonempty JSON test report');
    expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8'))).toMatchObject({
      testOutcome: 'success',
      jobStatus: 'success',
      reportPresent: true,
      testCount: null,
    });
    expect(readFileSync(path, 'utf8')).toBe(report);
  });

  it.each(['ct', 'root'])(
    'accepts a real %s runner report with expected failures and skipped tests',
    (suite) => {
      const dir = directory();
      const cli =
        suite === 'ct'
          ? resolveCtAlignedPlaywrightCli().cliPath
          : createRequire(import.meta.url).resolve('@playwright/test/cli');
      const testModule = createRequire(cli).resolve('playwright/test');
      const config = join(dir, 'playwright.config.cjs');
      writeFileSync(
        config,
        "module.exports = { testDir: '.', testMatch: 'report.spec.cjs', workers: 1, projects: [{ name: 'first' }, { name: 'second' }] };\n",
      );
      writeFileSync(
        join(dir, 'report.spec.cjs'),
        `
      const { test, expect } = require(${JSON.stringify(testModule)});
      test.describe('nested', () => {
        test('passes', () => expect(1).toBe(1));
        test('expected failure', () => { test.fail(); expect(1).toBe(2); });
        test.skip('intentional skip', () => {});
      });
    `,
      );
      const reportPath = join(dir, 'playwright-report/results.json');
      const tests = spawnSync(
        process.execPath,
        [cli, 'test', '--config', config, '--reporter=json'],
        {
          cwd: dir,
          encoding: 'utf8',
          env: { PATH: process.env.PATH, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
        },
      );
      expect(tests.status, tests.stdout + tests.stderr).toBe(0);
      const report = readFileSync(reportPath, 'utf8');
      expect(JSON.parse(report).stats).toMatchObject({ expected: 4, skipped: 2, unexpected: 0 });
      const result = run(dir, ['record', suite, '1'], {
        BROWSER_TEST_OUTCOME: 'success',
        BROWSER_JOB_STATUS: 'success',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8')).testCount).toBe(6);
      expect(readFileSync(reportPath, 'utf8')).toBe(report);
    },
    20_000,
  );

  it('permits an empty advisory quarantine report and counts nested projects in required reports', () => {
    const dir = directory();
    mkdirSync(join(dir, 'playwright-report-quarantine'));
    writeFileSync(join(dir, 'playwright-report-quarantine/results.json'), '{"suites":[]}');
    const env = { BROWSER_TEST_OUTCOME: 'success', BROWSER_JOB_STATUS: 'success' };
    expect(run(dir, ['record', 'quarantine', '1'], env).status).toBe(0);
    mkdirSync(join(dir, 'playwright-report'));
    writeFileSync(
      join(dir, 'playwright-report/results.json'),
      JSON.stringify({
        suites: [{ specs: [], suites: [{ specs: [{ tests: [testRecord()] }] }] }],
      }),
    );
    expect(run(dir, ['record', 'root', '1'], env).status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'browser-outcome.json'), 'utf8')).testCount).toBe(1);
  });

  it.each([
    ['record', 'ct', '5'],
    ['record', 'unknown', '1'],
    ['unknown'],
    ['record', 'root', '0'],
  ])('rejects invalid commands: %j', (...args) => {
    expect(run(directory(), args).status).not.toBe(0);
  });
});
