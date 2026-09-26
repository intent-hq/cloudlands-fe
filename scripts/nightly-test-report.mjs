import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { BROWSER_ARTIFACTS } from './browser-test-artifacts.mjs';
import { cleanLogLines } from './ct-run-failures-lib.mjs';

export const SOURCE_REPO = 'intent-hq/cloudlands-fe';
export const ISSUE_REPO = 'intent-hq/intent';
export const OWNER = 'panghy';
export const WORKFLOW_PATH = '.github/workflows/nightly-browser-tests.yml';
const STATUSES = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireValue = (ok, message) => {
  if (!ok) throw new Error(message);
};

export function trustedRun(run) {
  return (
    run?.repository?.full_name === SOURCE_REPO &&
    run?.head_repository?.full_name === SOURCE_REPO &&
    run.head_branch === 'main' &&
    ['schedule', 'workflow_dispatch'].includes(run.event) &&
    run.path === WORKFLOW_PATH &&
    run.name === 'Nightly Browser Tests'
  );
}

export function failureCategory(message, status) {
  const clean = cleanLogLines(message).join('\n').trim();
  if (/execution context was destroyed/i.test(clean)) return 'execution-context-destroyed';
  if (/target.*closed|browser.*closed/i.test(clean)) return 'browser-closed';
  if (/expect\(|assertionerror|toEqual|toBe\(/i.test(clean)) return 'assertion';
  if (status === 'timedOut' || /timeout|timed out/i.test(clean)) return 'timeout';
  return (
    clean
      .split('\n')[0]
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '<url>')
      .replace(/(?:[a-z]:)?[/\\][\w./\\: -]+/gi, '<path>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
      .replace(/\b\d+(?:[.:/-]\d+)*\b/g, '<n>')
      .replace(/retry\s*#?\s*<n>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'unexpected-result'
  );
}

export function failureKey(item) {
  const identity = [SOURCE_REPO, item.suite, item.project, item.file, item.title, item.category];
  return `v1:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}
export const marker = (key) => `<!-- nightly-browser-failure:${key} -->`;
export const occurrenceMarker = (run, key, attempt = run.run_attempt) =>
  `<!-- nightly-browser-seen:${run.id}:${attempt}:${key} -->`;

function specPath(file, rootDir = '') {
  requireValue(
    typeof file === 'string' && file.length > 0 && !file.includes('\0'),
    'Missing or invalid spec path',
  );
  let path = file.replaceAll('\\', '/');
  const root = rootDir.replaceAll('\\', '/');
  const absolute = /^(?:\/|[A-Za-z]:\/)/;
  // Playwright suite locations are relative to config.rootDir, even when an
  // inner directory is also named src/test/tests/e2e (for example src/test/).
  if (!absolute.test(path)) {
    path = posix.normalize(path);
    requireValue(
      path !== '.' && path !== '..' && !path.startsWith('../'),
      'Spec path is empty or escapes report root',
    );
    path = posix.join(root, path);
  }
  const directory = /(?:^|\/)(src|test|tests|e2e)(?:\/|$)/;
  if (absolute.test(path)) {
    const match = directory.exec(path);
    requireValue(match, 'Spec path is outside a known test directory');
    path = path.slice(match.index + (match[0].startsWith('/') ? 1 : 0));
  }
  path = posix.normalize(path);
  requireValue(
    path !== '.' && path !== '..' && !path.startsWith('../'),
    'Spec path is empty or escapes repository',
  );
  return path;
}

// Unlike the CT CLI's presentation helper, keep each project and each error category.
// Never use generated spec.file locations in place of the containing file suite.
export function parseReport(report, entry) {
  requireValue(record(report) && Array.isArray(report.suites), 'Malformed Playwright report');
  requireValue(
    report.errors === undefined || Array.isArray(report.errors),
    'Malformed global errors',
  );
  const failures = [];
  let testCount = 0;
  let interrupted = false;
  let infrastructureError = false;
  const visit = (suites, file, titles) => {
    requireValue(Array.isArray(suites), 'Malformed suites');
    for (const suite of suites) {
      requireValue(
        record(suite) && typeof suite.title === 'string' && Array.isArray(suite.specs),
        'Malformed suite',
      );
      const specFile = file ?? specPath(suite.file, report.config?.rootDir);
      const parents = file ? [...titles, suite.title] : [];
      for (const spec of suite.specs) {
        requireValue(
          record(spec) && typeof spec.title === 'string' && Array.isArray(spec.tests),
          'Malformed spec',
        );
        for (const test of spec.tests) {
          requireValue(
            record(test) &&
              ['expected', 'unexpected', 'flaky', 'skipped'].includes(test.status) &&
              STATUSES.includes(test.expectedStatus) &&
              typeof test.projectId === 'string' &&
              typeof test.projectName === 'string' &&
              Array.isArray(test.results) &&
              (test.status === 'skipped' || test.results.length > 0) &&
              test.results.every((r) => record(r) && STATUSES.includes(r.status)),
            'Malformed test results',
          );
          testCount += 1;
          interrupted ||= test.results.some((r) => r.status === 'interrupted');
          if (!['unexpected', 'flaky'].includes(test.status)) continue;
          const results = test.results.filter(
            (r) => r.status !== test.expectedStatus && r.status !== 'skipped',
          );
          requireValue(results.length > 0, 'Failure without an unexpected result');
          const categories = new Set();
          for (const result of results) {
            const error =
              result.error?.message ??
              result.errors?.[0]?.message ??
              (result.status === 'passed' ? 'Expected failure unexpectedly passed' : result.status);
            requireValue(typeof error === 'string', 'Malformed error');
            infrastructureError ||=
              /executable doesn't exist at|host system is missing dependencies|error while loading shared libraries|no space left on device/i.test(
                error,
              );
            const category = failureCategory(error, result.status);
            if (categories.has(category)) continue;
            categories.add(category);
            const annotations = test.annotations ?? [];
            requireValue(Array.isArray(annotations), 'Malformed annotations');
            const tracking = [
              ...new Set(
                annotations
                  .filter((a) => ['issue', 'quarantine'].includes(a?.type))
                  .flatMap((a) =>
                    [
                      ...String(a.description ?? '').matchAll(
                        /https:\/\/github\.com\/intent-hq\/intent\/issues\/(\d+)\b/g,
                      ),
                    ].map((m) => Number(m[1])),
                  ),
              ),
            ];
            const item = {
              suite: entry.suite === 'quarantine' ? 'ct' : entry.suite,
              project: test.projectName || test.projectId,
              file: specFile,
              title: [...parents, spec.title].join(' › '),
              category,
              status: test.status,
              evidence: cleanLogLines(error).join('\n').slice(0, 1800),
              quarantine: entry.advisory,
              tracking,
              artifact: entry.artifactName,
              shard: entry.shard,
            };
            failures.push({ ...item, key: failureKey(item) });
          }
        }
      }
      if (suite.suites !== undefined) visit(suite.suites, specFile, parents);
    }
  };
  visit(report.suites, undefined, []);
  return {
    testCount,
    failures,
    interrupted,
    infrastructureError,
    globalErrors: report.errors ?? [],
  };
}

function jobName(entry) {
  if (entry.suite === 'manifest') return 'Expected browser reports';
  if (entry.suite === 'ct' || entry.suite === 'quarantine')
    return `Component Tests (shard ${entry.suite === 'quarantine' ? 1 : entry.shard}/4)`;
  return entry.suite === 'root'
    ? `Playwright (root ${entry.shard}/2)`
    : 'Electron Browser Lifetime';
}
function latestJob(jobs, entry, run) {
  const name = jobName(entry);
  const matching = jobs.filter((job) => job.name === name || job.name?.endsWith(` / ${name}`));
  for (const job of matching)
    requireValue(
      Number.isSafeInteger(job.run_attempt) &&
        job.run_attempt >= 1 &&
        job.run_attempt <= run.run_attempt &&
        job.run_id === run.id &&
        job.head_sha === run.head_sha,
      `Invalid job history for ${name}`,
    );
  const latest = Math.max(...matching.map((j) => j.run_attempt));
  const candidates = matching.filter((j) => j.run_attempt === latest);
  requireValue(candidates.length === 1, `Missing or ambiguous job history for ${name}`);
  const job = candidates[0];
  requireValue(
    job.status === 'completed' &&
      Number.isSafeInteger(job.id) &&
      job.id > 0 &&
      typeof job.completed_at === 'string' &&
      Number.isFinite(Date.parse(job.completed_at)) &&
      typeof job.conclusion === 'string' &&
      Array.isArray(job.steps),
    `Incomplete job history for ${name}`,
  );
  return job;
}
function validateContext(data, run, job) {
  requireValue(
    record(data) &&
      data.schemaVersion === 1 &&
      data.repository === SOURCE_REPO &&
      data.runId === String(run.id) &&
      data.sha === run.head_sha &&
      data.ref === `refs/heads/${run.head_branch}` &&
      data.event === run.event &&
      data.runAttempt === String(job.run_attempt),
    'Stale or mismatched artifact context',
  );
}
function validateEntry(data, entry) {
  requireValue(
    Object.entries(entry).every(([key, value]) => data?.[key] === value),
    'Mismatched artifact suite/shard',
  );
}

export function analyzeReports({ run, jobs, artifacts, documents }) {
  requireValue(Array.isArray(jobs), 'Unreadable job history');
  const incidents = [];
  const failures = [];
  const lanes = [];
  const archive = (name) => {
    const found = artifacts.filter((a) => a.name === name);
    requireValue(
      found.length === 1 && !found[0].expired,
      `Missing, expired or ambiguous artifact: ${name}`,
    );
    const a = found[0];
    requireValue(
      a.workflow_run?.id === run.id &&
        a.workflow_run?.head_sha === run.head_sha &&
        a.workflow_run?.repository_id === run.repository.id,
      'Mismatched artifact origin',
    );
    requireValue(
      !documents[name]?.archiveError,
      `Unreadable archive: ${documents[name]?.archiveError}`,
    );
    return documents[name];
  };
  let validManifest = true;
  try {
    const job = latestJob(jobs, { suite: 'manifest' }, run);
    const manifest = archive('browser-test-manifest')?.manifest;
    validateContext(manifest, run, job);
    requireValue(job.conclusion === 'success', 'Manifest job did not succeed');
    requireValue(
      Array.isArray(manifest.artifacts) && manifest.artifacts.length === BROWSER_ARTIFACTS.length,
      'Incomplete manifest',
    );
    for (const entry of BROWSER_ARTIFACTS) {
      const matches = manifest.artifacts.filter((a) => a.artifactName === entry.artifactName);
      requireValue(matches.length === 1, 'Incomplete manifest');
      validateEntry(matches[0], entry);
    }
  } catch (error) {
    validManifest = false;
    incidents.push(`manifest: ${error.message}`);
  }
  for (const entry of BROWSER_ARTIFACTS) {
    try {
      const job = latestJob(jobs, entry, run);
      const doc = archive(entry.artifactName);
      validateContext(doc?.outcome, run, job);
      validateEntry(doc.outcome, entry);
      const outcome = doc.outcome;
      requireValue(
        ['success', 'failure'].includes(outcome.testOutcome) &&
          ['success', 'failure'].includes(outcome.jobStatus),
        'Test execution skipped or cancelled',
      );
      requireValue(outcome.reportPresent === true, 'Missing raw report');
      const parsed = parseReport(doc.report, entry);
      requireValue(
        Number.isSafeInteger(outcome.testCount) &&
          outcome.testCount === parsed.testCount &&
          (entry.advisory || parsed.testCount > 0),
        'Missing, empty or inconsistent test count',
      );
      const shard = doc.report.config?.shard;
      if (shard)
        requireValue(
          shard.current === entry.shard && shard.total === entry.shardCount,
          'Mismatched report shard',
        );
      requireValue(
        !parsed.interrupted && parsed.globalErrors.length === 0,
        'Interrupted tests or global runner error',
      );
      requireValue(!parsed.infrastructureError, 'Browser provisioning or host resource failure');
      requireValue(['success', 'failure'].includes(job.conclusion), `Job ended ${job.conclusion}`);
      const testSteps = [
        'Component tests',
        'Root Playwright tests',
        'Electron browser lifetime tests',
        'Quarantined component tests (advisory)',
      ];
      requireValue(
        !job.steps.some((s) => s.conclusion === 'failure' && !testSteps.includes(s.name)),
        'Setup, recording or upload step failed',
      );
      const upload =
        entry.suite === 'quarantine'
          ? 'Upload quarantine report'
          : entry.suite === 'electron'
            ? 'Upload electron lifetime report'
            : 'Upload playwright report';
      requireValue(
        job.steps.some((s) => s.name === upload && s.conclusion === 'success'),
        'Report upload was not successful',
      );
      requireValue(
        outcome.testOutcome !== 'failure' || parsed.failures.length > 0,
        'Test command failed without reported test failures',
      );
      requireValue(
        job.conclusion !== 'failure' || entry.advisory || parsed.failures.length > 0,
        'Failed job without reported test failures',
      );
      requireValue(
        parsed.failures.length <= 25,
        'Widespread failures require CI triage; individual issue creation suppressed',
      );
      lanes.push({
        artifact: entry.artifactName,
        attempt: job.run_attempt,
        job: job.id,
        tests: parsed.testCount,
      });
      if (validManifest)
        failures.push(
          ...parsed.failures.map((failure) => ({
            ...failure,
            occurrence: {
              attempt: job.run_attempt,
              observedAt: job.completed_at,
              job: job.id,
              artifacts: [entry.artifactName],
              status: failure.status,
              evidence: failure.evidence,
            },
          })),
        );
    } catch (error) {
      incidents.push(`${entry.artifactName}: ${error.message}`);
    }
  }
  const unique = new Map();
  for (const failure of failures) {
    const existing = unique.get(failure.key);
    if (existing) {
      existing.artifacts = [...new Set([...existing.artifacts, failure.artifact])];
      existing.tracking = [...new Set([...existing.tracking, ...failure.tracking])];
      existing.quarantine ||= failure.quarantine;
      existing.occurrences.push(failure.occurrence);
    } else {
      const { occurrence, ...item } = failure;
      unique.set(failure.key, {
        ...item,
        artifacts: [failure.artifact],
        occurrences: [occurrence],
      });
    }
  }
  const items = [...unique.values()];
  if (incidents.length) {
    const incident = {
      suite: 'infrastructure',
      project: 'nightly',
      file: WORKFLOW_PATH,
      title: 'Nightly browser CI evidence is incomplete',
      category: 'incomplete-ci-evidence',
      evidence: incidents.join('\n'),
      artifacts: artifacts.map((a) => a.name),
      tracking: [],
      quarantine: false,
    };
    items.unshift({
      ...incident,
      key: failureKey(incident),
      occurrences: [
        {
          // Incompleteness is an observation about this reporting attempt, whereas
          // test failures above belong to the jobs which actually executed them.
          attempt: run.run_attempt,
          observedAt: run.updated_at,
          artifacts: incident.artifacts,
          evidence: incident.evidence,
        },
      ],
    });
  }
  return { schemaVersion: 1, run, lanes, incidents, items };
}

export function safeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('@', '@\u200b')
    .replaceAll('`', '&#96;');
}
