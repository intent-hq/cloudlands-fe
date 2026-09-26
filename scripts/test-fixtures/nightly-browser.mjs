// Independent examples of producer schema 1 and GitHub REST data.
import { CT_SPEC_SUFFIX } from '../../playwright/ct-spec-pattern.mjs';

const specimen = `features/browser/panel${CT_SPEC_SUFFIX}`;
export const entries = [
  ...[1, 2, 3, 4].map((shard) => ({
    suite: 'ct',
    shard,
    shardCount: 4,
    artifactName: `playwright-ct-report-${shard}-of-4`,
    advisory: false,
    reportPath: 'playwright-report/results.json',
    outcomePath: 'browser-outcome.json',
  })),
  ...[1, 2].map((shard) => ({
    suite: 'root',
    shard,
    shardCount: 2,
    artifactName: `playwright-root-report-${shard}`,
    advisory: false,
    reportPath: 'playwright-report/results.json',
    outcomePath: 'browser-outcome.json',
  })),
  {
    suite: 'electron',
    shard: 1,
    shardCount: 1,
    artifactName: 'playwright-electron-lifetime-report',
    advisory: false,
    reportPath: 'playwright-report/results.json',
    outcomePath: 'browser-outcome.json',
  },
  {
    suite: 'quarantine',
    shard: 1,
    shardCount: 1,
    artifactName: 'playwright-ct-report-quarantine',
    advisory: true,
    reportPath: 'playwright-report-quarantine/results.json',
    outcomePath: 'browser-quarantine-outcome.json',
  },
];

export function report(status = 'expected', project = 'chromium') {
  return {
    config: { rootDir: '/home/runner/work/cloudlands-fe/cloudlands-fe/src' },
    errors: [],
    suites: [
      {
        file: specimen,
        title: specimen,
        specs: [],
        suites: [
          {
            title: 'browser panel',
            specs: [
              {
                title: 'keeps keyboard focus',
                file: 'test/generator.ts',
                line: 25,
                tests: [
                  {
                    projectName: project,
                    projectId: project,
                    status,
                    expectedStatus: 'passed',
                    annotations: [],
                    results:
                      status === 'expected'
                        ? [{ status: 'passed' }]
                        : status === 'flaky'
                          ? [
                              {
                                status: 'failed',
                                retry: 0,
                                error: {
                                  message: 'Error: expect(received).toBe(expected)\nExpected: true',
                                },
                              },
                              { status: 'passed', retry: 1 },
                            ]
                          : [
                              {
                                status: 'failed',
                                error: {
                                  message: 'Error: expect(received).toBe(expected)\nExpected: true',
                                },
                              },
                            ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
export const testRecord = (value) => value.suites[0].suites[0].specs[0].tests[0];

export function fixture() {
  const run = {
    id: 1234,
    run_attempt: 1,
    name: 'Nightly Browser Tests',
    path: '.github/workflows/nightly-browser-tests.yml',
    status: 'completed',
    conclusion: 'success',
    event: 'schedule',
    head_branch: 'main',
    head_sha: 'a'.repeat(40),
    repository: { full_name: 'intent-hq/cloudlands-fe', id: 12 },
    head_repository: { full_name: 'intent-hq/cloudlands-fe', id: 12 },
    updated_at: '2026-09-26T02:45:00Z',
  };
  const context = {
    schemaVersion: 1,
    repository: 'intent-hq/cloudlands-fe',
    runId: '1234',
    runAttempt: '1',
    sha: run.head_sha,
    ref: 'refs/heads/main',
    event: 'schedule',
  };
  const jobs = [
    {
      id: 10,
      name: 'Expected browser reports',
      run_id: 1234,
      run_attempt: 1,
      head_sha: run.head_sha,
      status: 'completed',
      conclusion: 'success',
      completed_at: run.updated_at,
      steps: [],
    },
  ];
  const artifacts = [
    {
      id: 100,
      name: 'browser-test-manifest',
      expired: false,
      workflow_run: { id: 1234, head_sha: run.head_sha, repository_id: 12 },
    },
  ];
  const documents = { 'browser-test-manifest': { manifest: { ...context, artifacts: entries } } };
  for (const [index, entry] of entries.entries()) {
    if (entry.suite !== 'quarantine')
      jobs.push({
        id: 11 + index,
        name:
          entry.suite === 'ct'
            ? `test-ct / Component Tests (shard ${entry.shard}/4)`
            : entry.suite === 'root'
              ? `test-playwright / Playwright (root ${entry.shard}/2)`
              : 'test-electron / Electron Browser Lifetime',
        run_id: 1234,
        run_attempt: 1,
        head_sha: run.head_sha,
        status: 'completed',
        conclusion: 'success',
        completed_at: run.updated_at,
        steps: [
          {
            name:
              entry.suite === 'electron'
                ? 'Upload electron lifetime report'
                : 'Upload playwright report',
            conclusion: 'success',
          },
          ...(index === 0 ? [{ name: 'Upload quarantine report', conclusion: 'success' }] : []),
        ],
      });
    artifacts.push({
      id: 101 + index,
      name: entry.artifactName,
      expired: false,
      workflow_run: { id: 1234, head_sha: run.head_sha, repository_id: 12 },
    });
    documents[entry.artifactName] = {
      outcome: {
        ...context,
        ...entry,
        testCount: 1,
        testOutcome: 'success',
        jobStatus: 'success',
        reportPresent: true,
      },
      report: report(),
    };
  }
  return { run, jobs, artifacts, documents };
}

export function issueStore(initial = []) {
  const issues = structuredClone(initial);
  const comments = [];
  const writes = [];
  let refreshes = 0;
  const client = {
    issues,
    writes,
    storedComments: comments,
    canonical: () => ({ state: 'none', number: null }),
    inventory: () => {
      refreshes += 1;
      return structuredClone({ issues, comments });
    },
    refreshes: () => refreshes,
    issue: (number) => {
      const issue = issues.find((i) => i.number === number);
      if (!issue) throw new Error('404 issue');
      return structuredClone(issue);
    },
    comments: (number) =>
      structuredClone(comments.filter((c) => c.issue_url.endsWith(`/${number}`))),
    create: (title, body) => {
      const issue = {
        number: Math.max(0, ...issues.map((i) => i.number)) + 1,
        title,
        body,
        state: 'open',
        type: { name: 'Bug' },
        assignees: [{ login: 'panghy' }],
        labels: [{ name: 'component:fe' }, { name: 'agent-filed' }],
      };
      issues.push(issue);
      writes.push({ create: issue.number });
      return structuredClone(issue);
    },
    comment: (number, body) => {
      const comment = {
        id: comments.length + 1,
        issue_url: `https://api.github.com/repos/intent-hq/intent/issues/${number}`,
        body,
      };
      comments.push(comment);
      writes.push({ comment: number });
      return comment;
    },
    reopen: (number) => {
      issues.find((i) => i.number === number).state = 'open';
      writes.push({ reopen: number });
    },
  };
  return client;
}
