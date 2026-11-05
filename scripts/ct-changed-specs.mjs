// Lists the component-test specs a branch adds or edits, for the local stress
// runner. CI does not run component tests on PRs or in the merge queue: the
// full suite runs nightly and on manual dispatch (nightly-browser-tests.yml).
// To stress a new or edited spec for flakiness before pushing
// (dock-composer-spec.ct.spec.ts failed 12 of 40 local runs under CPU load and
// ejected #4002), run `pnpm run test:ct:changed-repeat`
// (scripts/ct-changed-repeat.mjs), which uses the helpers below.
import { isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

// For the local stress runner (ct-changed-repeat.mjs): each changed test runs
// this many times with retries off. dock-composer-spec
export const CT_CHANGED_REPEAT_EACH = 20;
// The repetitions share a fixed budget of test runs, counted over the tests
// Playwright actually discovers in the changed specs (not spec files: one large
// spec can hold dozens of tests). A budget of spec-file runs let 10 dock specs
// holding 86 tests plan 86 x 20 = 1720 runs; the 45-minute job was cancelled
// after 1167 of them had passed (cloudlands-fe#4047, run 41564605167), about
// 2.2 s of wall time per run on two workers. At that rate 800 runs take about
// 30 minutes plus setup (install, browser, bundle build), leaving headroom
// under the job timeout. The rate is an estimate from one run, not a
// guarantee: slow specs or a loaded runner take longer.
export const CT_CHANGED_TEST_RUN_BUDGET = 800;
// Never fewer than this, even when the changed specs hold more tests than the
// budget covers (then the job may exceed the budget rather than skip repeats).
export const CT_CHANGED_MIN_REPEAT_EACH = 3;

// Repetitions for `testCount` discovered tests: the budget spread over them,
// within [CT_CHANGED_MIN_REPEAT_EACH, CT_CHANGED_REPEAT_EACH].
export function ctChangedRepeatEach(testCount) {
  if (!Number.isInteger(testCount) || testCount <= 0) {
    throw new Error(`expected a positive number of discovered tests, got ${testCount}`);
  }
  const scaled = Math.floor(CT_CHANGED_TEST_RUN_BUDGET / testCount);
  return Math.max(CT_CHANGED_MIN_REPEAT_EACH, Math.min(CT_CHANGED_REPEAT_EACH, scaled));
}

// Counts the tests in a Playwright JSON report from `--list` (each spec's
// `tests`, through nested `suites`), per spec file. Throws on a malformed
// report, any discovery error (a spec that failed to load would otherwise just
// contribute no tests), or zero tests.
export function listedCtTests(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites)) {
    throw new Error('expected a Playwright JSON report with a suites array');
  }
  if (!Array.isArray(report.errors))
    throw new Error('expected a Playwright JSON report errors array');
  if (report.errors.length) {
    const messages = report.errors.map((error) => error?.message ?? JSON.stringify(error));
    throw new Error(`test discovery failed: ${messages.join('; ')}`);
  }
  const count = (suite) => {
    if (!suite || typeof suite !== 'object') throw new Error('malformed suite in the report');
    let tests = 0;
    for (const spec of suite.specs ?? []) {
      if (!Array.isArray(spec?.tests)) throw new Error('malformed spec in the report');
      tests += spec.tests.length;
    }
    for (const child of suite.suites ?? []) tests += count(child);
    return tests;
  };
  const files = report.suites.map((suite) => ({ file: String(suite.file), tests: count(suite) }));
  const total = files.reduce((sum, { tests }) => sum + tests, 0);
  if (total === 0) throw new Error('test discovery found no tests in the changed specs');
  return { total, files };
}

export function changedCtSpecs(files) {
  return [...new Set(files.filter(isCtSpec).map(normalizeCtPath))].sort();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Playwright matches each filter against the absolute spec path, so anchor at a
// path boundary and the end: `src/a/b.ct.spec.ts` must not also select
// `src/a/xb.ct.spec.ts` or `src/a/b.ct.spec.ts.bak`.
export function playwrightFilter(spec) {
  return `(?:^|[\\\\/])${escapeRegExp(normalizeCtPath(spec))}$`;
}
