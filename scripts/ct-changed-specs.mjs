#!/usr/bin/env node
// Lists the component-test specs a branch adds or edits, for the local stress
// runner. CI does not run component tests on PRs or in the merge queue: the
// full suite runs nightly and on manual dispatch (nightly-browser-tests.yml).
// To stress a new or edited spec for flakiness before pushing
// (dock-composer-spec.ct.spec.ts failed 12 of 40 local runs under CPU load and
// ejected #4002), run `pnpm run test:ct:changed-repeat`
// (scripts/ct-changed-repeat.mjs), which uses the repetition helpers below.
//
// The list diffs <head> against the merge-base of <base> and <head> (a
// three-dot diff; see diffBase in ct-contract-paths.mjs), so files <base>
// changed after the branch point are not counted as the branch's.
//
// Modes:
//   --diff <base> <head>   prints one `ct_changed_specs=<JSON array>` line
//                          listing the specs the diff adds or edits. Any error
//                          prints `ct_changed_specs=error` (never "no specs").
//   --filters <JSON>       prints the Playwright file filters for that list,
//                          NUL-separated, one anchored and regex-escaped
//                          pattern per spec (Playwright treats positional
//                          arguments as regular expressions over the file
//                          path, and SvelteKit-style `[id]` or `+page`
//                          segments would otherwise be read as regex syntax).
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';
import { diffBase } from './ct-contract-paths.mjs';

export const OUTPUT_KEY = 'ct_changed_specs';
export const ERROR_VALUE = 'error';
// For the local stress runner (ct-changed-repeat.mjs): each changed test runs
// this many times with retries off. dock-composer-spec
// failed 12 of 40 runs under load, so 20 repetitions miss a flake that common
// with a probability far below one in a thousand.
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

// Added, copied and modified paths: a deleted spec has nothing to run, and
// --no-renames reports a moved spec as an addition at its new path.
export function changedFiles(base, head, filter = 'ACM') {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', `--diff-filter=${filter}`, base, head],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
}

export function changedCtSpecs(files) {
  return [...new Set(files.filter(isCtSpec).map(normalizeCtPath))].sort();
}

export function parseSpecList(json) {
  const value = JSON.parse(json);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !isCtSpec(item))) {
    throw new Error(`expected a JSON array of component test specs, got ${json}`);
  }
  return value.map(normalizeCtPath);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Playwright matches each filter against the absolute spec path, so anchor at a
// path boundary and the end: `src/a/b.ct.spec.ts` must not also select
// `src/a/xb.ct.spec.ts` or `src/a/b.ct.spec.ts.bak`.
export function playwrightFilter(spec) {
  return `(?:^|[\\\\/])${escapeRegExp(normalizeCtPath(spec))}$`;
}

function usage() {
  return 'usage: ct-changed-specs.mjs --diff <base> <head> | --filters <JSON array>';
}

export function main(
  argv,
  {
    diff = changedFiles,
    resolveBase = diffBase,
    log = console.log,
    warn = console.error,
    write,
  } = {},
) {
  const writeOut = write ?? ((text) => process.stdout.write(text));
  if (argv[0] === '--diff') {
    let value = ERROR_VALUE;
    try {
      const [given, head, ...rest] = argv.slice(1);
      if (!given || !head || rest.length) throw new Error(usage());
      value = JSON.stringify(changedCtSpecs(diff(resolveBase(given, head), head)));
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
    }
    log(`${OUTPUT_KEY}=${value}`);
    return 0;
  }
  if (argv[0] === '--filters' && argv.length === 2) {
    try {
      const specs = parseSpecList(argv[1]);
      if (specs.length === 0) throw new Error('no component test specs to run');
      writeOut(specs.map((spec) => `${playwrightFilter(spec)}\0`).join(''));
      return 0;
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
  }
  warn(usage());
  return 2;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) process.exitCode = main(process.argv.slice(2));
