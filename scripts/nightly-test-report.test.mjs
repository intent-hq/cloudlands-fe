// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  analyzeReports,
  failureCategory,
  failureKey,
  parseReport,
  trustedRun,
} from './nightly-test-report.mjs';
import { entries, fixture, report, testRecord } from './test-fixtures/nightly-browser.mjs';

describe('complete browser evidence', () => {
  it.each(['./', 'test/../', '.\\', 'test\\..\\'])(
    'reports empty path %j as infrastructure rather than a test failure',
    (file) => {
      const data = fixture();
      const raw = report('flaky');
      raw.suites[0].file = file;
      data.documents['playwright-ct-report-1-of-4'].report = raw;
      const result = analyzeReports(data);
      expect(result.incidents).toHaveLength(1);
      expect(result.incidents[0]).toContain('Spec path is empty');
      expect(result.items.map((item) => item.suite)).toEqual(['infrastructure']);
    },
  );
  it('accepts all four CT shards, both root shards, Electron and quarantine on a successful run', () => {
    const result = analyzeReports(fixture());
    expect(result.lanes).toHaveLength(8);
    expect(result.incidents).toEqual([]);
    expect(result.items).toEqual([]);
  });
  it('accepts untouched successful shards and manifest in a failed-jobs-only rerun', () => {
    const data = fixture();
    data.run.run_attempt = 2;
    data.jobs.push({ ...data.jobs[2], id: 22, run_attempt: 2 });
    data.documents['playwright-ct-report-2-of-4'].outcome.runAttempt = '2';
    expect(analyzeReports(data).incidents).toEqual([]);
    expect(analyzeReports(data).lanes.map((l) => l.attempt)).toEqual([1, 2, 1, 1, 1, 1, 1, 1]);
  });
  it.each([
    'Checkout',
    'Record browser outcome',
    'Upload playwright report',
    'Upload playwright report (no files)',
  ])('rejects stale success when the newer job fails at %s', (name) => {
    const data = fixture();
    data.run.run_attempt = 2;
    data.jobs.push({
      ...data.jobs[2],
      id: 22,
      run_attempt: 2,
      conclusion: 'failure',
      steps: [{ name, conclusion: 'failure' }],
    });
    const result = analyzeReports(data);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].suite).toBe('infrastructure');
    expect(result.incidents.join('\n')).toContain('Stale');
    expect(result.lanes).toHaveLength(7);
  });
  it.each([
    [
      'no manifest',
      (d) => {
        delete d.documents['browser-test-manifest'];
      },
    ],
    [
      'truncated manifest',
      (d) => {
        d.documents['browser-test-manifest'].manifest.artifacts = entries.slice(0, 7);
      },
    ],
    [
      'bad manifest entry',
      (d) => {
        d.documents['browser-test-manifest'].manifest.artifacts = entries.map((e) => ({
          ...e,
          advisory: true,
        }));
      },
    ],
    [
      'wrong repository',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.repository = 'other/repo';
      },
    ],
    [
      'wrong run',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.runId = '9999';
      },
    ],
    [
      'wrong SHA',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.sha = 'b'.repeat(40);
      },
    ],
    [
      'wrong suite',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.suite = 'ct';
      },
    ],
    [
      'wrong event',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.event = 'pull_request';
      },
    ],
    [
      'wrong branch',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.ref = 'refs/heads/feature';
      },
    ],
    [
      'wrong archive origin',
      (d) => {
        d.artifacts[1].workflow_run.id = 99;
      },
    ],
    [
      'future attempt',
      (d) => {
        d.documents['playwright-root-report-1'].outcome.runAttempt = '2';
      },
    ],
    [
      'expired',
      (d) => {
        d.artifacts[1].expired = true;
      },
    ],
    [
      'missing archive',
      (d) => {
        d.artifacts.splice(1, 1);
      },
    ],
    [
      'duplicate archive',
      (d) => {
        d.artifacts.push(d.artifacts[1]);
      },
    ],
    [
      'invalid JSON',
      (d) => {
        d.documents['playwright-ct-report-1-of-4'].report = null;
      },
    ],
    [
      'false count',
      (d) => {
        d.documents['playwright-ct-report-1-of-4'].outcome.testCount = 9;
      },
    ],
    [
      'missing raw report',
      (d) => {
        d.documents['playwright-ct-report-1-of-4'].outcome.reportPresent = false;
      },
    ],
    [
      'wrong raw shard',
      (d) => {
        d.documents['playwright-ct-report-1-of-4'].report.config.shard = { current: 2, total: 4 };
      },
    ],
    [
      'upload failed after recording',
      (d) => {
        d.jobs[1].conclusion = 'failure';
        d.jobs[1].steps[0].conclusion = 'failure';
      },
    ],
    [
      'unreadable job metadata',
      (d) => {
        delete d.jobs[1].run_attempt;
      },
    ],
    [
      'missing job observation time',
      (d) => {
        delete d.jobs[1].completed_at;
      },
    ],
    [
      'invalid job observation time',
      (d) => {
        d.jobs[1].completed_at = 'not-a-time';
      },
    ],
    [
      'duplicate latest job',
      (d) => {
        d.jobs.push(d.jobs[1]);
      },
    ],
    [
      'missing job',
      (d) => {
        d.jobs.splice(1, 1);
      },
    ],
    [
      'cancelled',
      (d) => {
        d.jobs[1].conclusion = 'cancelled';
      },
    ],
    [
      'timed out',
      (d) => {
        d.jobs[1].conclusion = 'timed_out';
      },
    ],
    [
      'runner exhausted',
      (d) => {
        d.jobs[1].conclusion = 'startup_failure';
      },
    ],
    [
      'skipped step',
      (d) => {
        d.documents['playwright-ct-report-1-of-4'].outcome.testOutcome = 'skipped';
      },
    ],
  ])('files an infrastructure incident for %s', (_name, mutate) => {
    const data = fixture();
    mutate(data);
    const result = analyzeReports(data);
    expect(result.incidents.length).toBeGreaterThan(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].suite).toBe('infrastructure');
  });
  it('rejects empty required reports independently, while allowing empty quarantine', () => {
    const data = fixture();
    for (const entry of entries) {
      data.documents[entry.artifactName].report.suites = [];
      data.documents[entry.artifactName].outcome.testCount = 0;
    }
    const result = analyzeReports(data);
    expect(result.incidents).toHaveLength(7);
    expect(result.lanes[0].artifact).toBe('playwright-ct-report-quarantine');
  });
  it('suppresses per-test floods for global runner errors and interrupted execution', () => {
    for (const globalError of [true, false]) {
      const data = fixture();
      const raw = report('unexpected');
      if (globalError) raw.errors = [{ message: 'web server exited early' }];
      else testRecord(raw).results[0].status = 'interrupted';
      data.documents['playwright-ct-report-1-of-4'].report = raw;
      const result = analyzeReports(data);
      expect(result.items.map((i) => i.suite)).toEqual(['infrastructure']);
    }
  });
  it('groups provisioning failures and widespread breakages into an infrastructure incident', () => {
    for (const provisioning of [true, false]) {
      const data = fixture();
      const raw = report('unexpected');
      if (provisioning)
        testRecord(raw).results[0].error.message =
          "browserType.launch: Executable doesn't exist at /runner/chromium";
      else
        raw.suites[0].suites[0].specs = Array.from({ length: 26 }, (_, i) => ({
          ...raw.suites[0].suites[0].specs[0],
          title: `case ${i}`,
        }));
      data.documents['playwright-ct-report-1-of-4'].report = raw;
      data.documents['playwright-ct-report-1-of-4'].outcome.testCount = provisioning ? 1 : 26;
      expect(analyzeReports(data).items.map((i) => i.suite)).toEqual(['infrastructure']);
    }
  });
  it('reports failures and pass-on-retry flakes even on a green run, deduplicated across shards', () => {
    const data = fixture();
    data.documents['playwright-ct-report-1-of-4'].report = report('flaky');
    data.documents['playwright-ct-report-2-of-4'].report = report('unexpected');
    data.documents['playwright-root-report-1'].report = report('flaky');
    data.documents['playwright-electron-lifetime-report'].report = report('unexpected');
    const result = analyzeReports(data);
    expect(result.incidents).toEqual([]);
    expect(result.items.map((i) => i.suite)).toEqual(['ct', 'root', 'electron']);
    expect(result.items[0].artifacts).toHaveLength(2);
  });
});

describe('Playwright identities and expected outcomes', () => {
  it.each([
    ['ct', 'src', 'test/ct-browser.ct.spec.ts', 'src/test/ct-browser.ct.spec.ts'],
    ['ct', 'src', 'src/nested.ct.spec.ts', 'src/src/nested.ct.spec.ts'],
    ['ct', 'src', 'tests/nested.ct.spec.ts', 'src/tests/nested.ct.spec.ts'],
    ['ct', 'src', 'e2e/nested.ct.spec.ts', 'src/e2e/nested.ct.spec.ts'],
    [
      'ct',
      'src',
      'features/test/tests/e2e/src/nested.ct.spec.ts',
      'src/features/test/tests/e2e/src/nested.ct.spec.ts',
    ],
    ['ct', 'src/features', 'test/nested.ct.spec.ts', 'src/features/test/nested.ct.spec.ts'],
    ['root', 'test', 'browser.spec.ts', 'test/browser.spec.ts'],
    ['root', 'test', 'src/tests/browser.spec.ts', 'test/src/tests/browser.spec.ts'],
    ['root', '', 'test/browser.spec.ts', 'test/browser.spec.ts'],
    [
      'electron',
      'test',
      'electron-browser-lifetime.spec.ts',
      'test/electron-browser-lifetime.spec.ts',
    ],
    ['electron', 'test', 'e2e/src/browser.spec.ts', 'test/e2e/src/browser.spec.ts'],
  ])('resolves %s locations from report root %s: %s', (suite, root, file, expected) => {
    const raw = report('unexpected');
    const entry = entries.find((candidate) => candidate.suite === suite);
    const location = (rootDir, specFile) => {
      raw.config.rootDir = rootDir;
      raw.suites[0].file = specFile;
      const item = parseReport(raw, entry).failures[0];
      return { file: item.file, key: item.key };
    };
    const rootDir = `/home/runner/work/cloudlands-fe/cloudlands-fe${root ? `/${root}` : ''}`;
    const absolute = location(rootDir, `${rootDir}/${file}`);
    expect(absolute.file).toBe(expected);
    expect(location(rootDir, file)).toEqual(absolute);
    expect(location(`${rootDir}/`, `./${file}`)).toEqual(absolute);
    const windowsRoot = `C:/work/cloudlands-fe${root ? `/${root}` : ''}`.replaceAll('/', '\\');
    expect(location(windowsRoot, file.replaceAll('/', '\\'))).toEqual(absolute);
    expect(location(windowsRoot, `.\\${file.replaceAll('/', '\\')}`)).toEqual(absolute);
    expect(location(windowsRoot, `${windowsRoot}\\${file.replaceAll('/', '\\')}`)).toEqual(
      absolute,
    );
  });
  it.each([
    undefined,
    null,
    42,
    '',
    '.',
    './',
    '.\\',
    'test/..',
    'test/../',
    'test\\..\\',
    'test/bad\0.spec.ts',
    '../../outside.spec.ts',
    '../test/outside.spec.ts',
    'test/../../outside.spec.ts',
    '..\\..\\outside.spec.ts',
    '/tmp/outside.spec.ts',
    '/checkout/src/../../outside.spec.ts',
  ])('rejects invalid or escaping report locations %j', (file) => {
    const raw = report('unexpected');
    raw.suites[0].file = file;
    expect(() => parseReport(raw, entries[0])).toThrow();
  });
  it('keeps complete nested titles and each project, using spec paths instead of generator locations', () => {
    const raw = report('unexpected');
    const spec = raw.suites[0].suites[0].specs[0];
    spec.tests.push({ ...spec.tests[0], projectName: 'webkit', projectId: 'webkit' });
    const result = parseReport(raw, entries[0]);
    expect(result.failures.map((i) => [i.file, i.title, i.project])).toEqual([
      ['src/features/browser/panel.ct.spec.ts', 'browser panel › keeps keyboard focus', 'chromium'],
      ['src/features/browser/panel.ct.spec.ts', 'browser panel › keeps keyboard focus', 'webkit'],
    ]);
    expect(new Set(result.failures.map((i) => i.key)).size).toBe(2);
    // Versioned durable contract, independently computed from the documented v1 tuple.
    expect(result.failures[0].key).toBe(
      'v1:6397486dabee61528bc4a74f8d66dc4919f54e3cc7f3c4d891f378ed53ac5797',
    );
  });
  it('ignores expected negative controls and skips but reports unexpected passes', () => {
    const raw = report('expected');
    testRecord(raw).expectedStatus = 'failed';
    testRecord(raw).results = [{ status: 'failed' }];
    expect(parseReport(raw, entries[0]).failures).toEqual([]);
    testRecord(raw).status = 'skipped';
    testRecord(raw).results = [];
    expect(parseReport(raw, entries[0]).failures).toEqual([]);
    testRecord(raw).status = 'unexpected';
    testRecord(raw).results = [{ status: 'passed' }];
    expect(parseReport(raw, entries[0]).failures[0].category).toBe(
      'expected failure unexpectedly passed',
    );
  });
  it('keeps key stable across retries, shards, line numbers, absolute paths, durations and ports', () => {
    const raw = report('unexpected');
    const item = parseReport(raw, entries[0]).failures[0];
    raw.suites[0].file = '/other/checkout/src/features/browser/panel.ct.spec.ts';
    raw.suites[0].suites[0].specs[0].line = 999;
    testRecord(raw).results[0].retry = 9;
    expect(parseReport(raw, entries[3]).failures[0].key).toBe(item.key);
    expect(failureKey({ ...item, runId: 99, runAttempt: 3, shard: 4 })).toBe(item.key);
    expect(
      failureCategory('Error: connection 123 http://localhost:4112/a at /tmp/abc/test.ts:2:3'),
    ).toBe(
      failureCategory('Error: connection 456 http://localhost:9999/a at /home/xyz/test.ts:8:9'),
    );
    expect(failureCategory('Timeout 30000ms exceeded', 'timedOut')).toBe(
      failureCategory('Timeout 100ms exceeded', 'timedOut'),
    );
  });
  it('recognizes quarantine tracking annotations without a new test identity', () => {
    const raw = report('flaky');
    testRecord(raw).annotations = [
      { type: 'issue', description: 'https://github.com/intent-hq/intent/issues/123' },
    ];
    const item = parseReport(raw, entries[7]).failures[0];
    expect(item.tracking).toEqual([123]);
    expect(item.quarantine).toBe(true);
    expect(item.key).toBe(parseReport(raw, entries[0]).failures[0].key);
  });
  it.each([null, { suites: {} }, { suites: [{ specs: 'broken' }] }])(
    'rejects malformed structure %j',
    (raw) => {
      expect(() => parseReport(raw, entries[0])).toThrow();
    },
  );
  it.each(['pull_request', 'pull_request_target', 'merge_group', 'push'])(
    'excludes %s writers',
    (event) => {
      expect(trustedRun({ ...fixture().run, event })).toBe(false);
    },
  );
  it('allows only nightly and manual main runs from this repository and workflow', () => {
    const run = fixture().run;
    expect(trustedRun(run)).toBe(true);
    expect(trustedRun({ ...run, event: 'workflow_dispatch' })).toBe(true);
    expect(trustedRun({ ...run, head_branch: 'feature' })).toBe(false);
    expect(trustedRun({ ...run, head_repository: { full_name: 'fork/repo' } })).toBe(false);
    expect(trustedRun({ ...run, path: '.github/workflows/other.yml' })).toBe(false);
  });
});
