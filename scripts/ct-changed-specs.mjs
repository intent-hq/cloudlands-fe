#!/usr/bin/env node
// Lists the component-test spec files a pull request adds or edits, so PR CI
// can run just those files many times with retries off (the `test-ct-changed`
// job in .github/workflows/intent-pr.yml). The full CT suite only runs in the
// merge queue, so before this job a new or edited spec that passed only some of
// the time was first caught there, ejecting unrelated PRs: dock-actions.ct.spec.ts
// ejected cloudlands-fe#3978 and dock-composer-spec.ct.spec.ts (added in #3794)
// ejected #4002, failing 12 of 40 local runs under CPU load.
//
// It also lists the existing specs that load a file the pull request changes,
// for the `test-ct-affected` job, which runs each of them once. A change to a
// shared component can break a spec the PR never touches: cloudlands-fe#4029
// edited ChatPanel.svelte with green PR checks and was ejected from the queue
// by chat-panel-composer-geometry.ct.spec.ts (a 24px shift, failed 3 of 3).
//
// Both list modes diff <head> against the merge-base of <base> and <head> (a
// three-dot diff; see diffBase in ct-contract-paths.mjs), so files <base>
// changed after the branch point are not counted as the PR's.
//
// Modes:
//   --diff <base> <head>   prints one `ct_changed_specs=<JSON array>` line for
//                          $GITHUB_OUTPUT. Any error prints
//                          `ct_changed_specs=error`, which the job and the CI
//                          Gate both treat as a failure (never as "no specs").
//   --affected <base> <head>
//                          prints the plan (one line per affected spec), then
//                          `ct_affected_specs=<JSON array>` (the first
//                          CT_AFFECTED_BUDGET, see affectedCtSpecs) and
//                          `ct_affected_over_budget=<JSON array>` (the rest).
//                          Any error prints `ct_affected_specs=error`, which
//                          fails the job and the CI Gate like `--diff`.
//   --over-budget <JSON> <JSON>
//                          prints a Markdown note for the selected and
//                          over-budget lists, for the job log and step summary.
//   --filters <JSON>       prints the Playwright file filters for that list,
//                          NUL-separated, one anchored and regex-escaped
//                          pattern per spec (Playwright treats positional
//                          arguments as regular expressions over the file
//                          path, and SvelteKit-style `[id]` or `+page`
//                          segments would otherwise be read as regex syntax).
//   --repeat-each-listed <report.json>
//                          prints the repetition count for the tests a
//                          Playwright `--list --reporter=json` run discovered
//                          (see ctChangedRepeatEach). Fails (exit 1) on an
//                          unreadable or malformed report, any discovery
//                          error, or zero discovered tests, so the job can
//                          never silently run nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';
import { ctImportGraph, diffBase } from './ct-contract-paths.mjs';

export const OUTPUT_KEY = 'ct_changed_specs';
export const ERROR_VALUE = 'error';
// Each changed test runs this many times with retries off. dock-composer-spec
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

export const AFFECTED_OUTPUT_KEY = 'ct_affected_specs';
export const OVER_BUDGET_OUTPUT_KEY = 'ct_affected_over_budget';
// Affected specs run once each, at most this many per PR (the rest are listed
// in the job output, never dropped silently). Measured over the last 100 main
// commits on 2026-11-02: 28 changed a file some spec loads and 24 of those
// reached more than 60 specs (hub store modules reach nearly all 409), so the
// cap almost always applies. With per-spec durations from queue run
// 41451416066 and two workers, 40 specs take about 11 minutes (p50) and 14
// (p90). 40 is also the smallest cap that keeps both known misses: the
// #4029 geometry spec ranks 11th of 58, and home.ct.spec.ts, which
// cloudlands-fe#3876 broke, ranks 32nd of 202.
export const CT_AFFECTED_BUDGET = 40;

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

// Added, copied and modified paths by default: a deleted spec has nothing to
// run, and --no-renames reports a moved spec as an addition at its new path.
// The affected list passes 'ACMD': a spec that loaded a deleted file in the
// base tree is still worth running.
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

// Existing specs that load a changed file. `graph` is ctImportGraph's
// `{ edges, headSpecs }`; `changed` the diff's paths, deletions included (a
// spec that imported a deleted file is still worth running). Each result is
// `{ spec, via, distance }`: `via` is a changed file the spec loads and
// `distance` the number of import edges from the spec to it.
//
// About 71% of src/ is reachable from some spec through shared store modules,
// so a hub edit reaches nearly every spec and the caller can run only a prefix
// of this list. The order makes that prefix useful: every changed file gets its
// nearest spec before any changed file gets its second, and so on (a round
// robin over each file's own nearest-first list), so one hub edit cannot crowd
// out the few specs that mount a leaf component changed alongside it. Within a
// round, nearer specs come first; remaining ties sort by path.
export function affectedCtSpecs(graph, changed) {
  const importers = new Map();
  for (const [from, targets] of graph.edges) {
    for (const target of targets) {
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push(from);
    }
  }
  const runnable = new Set(graph.headSpecs);
  const skip = new Set(changedCtSpecs(changed));
  const best = new Map();
  for (const file of [...new Set(changed.map(normalizeCtPath))].sort()) {
    // Breadth-first over importers: the first visit is the shortest distance.
    const seen = new Set([file]);
    const reached = [];
    let frontier = [file];
    for (let distance = 1; frontier.length; distance++) {
      const next = [];
      for (const module of frontier) {
        for (const importer of importers.get(module) ?? []) {
          if (seen.has(importer)) continue;
          seen.add(importer);
          next.push(importer);
          if (runnable.has(importer) && !skip.has(importer))
            reached.push({ spec: importer, distance });
        }
      }
      frontier = next;
    }
    reached.sort((a, b) => a.distance - b.distance || compare(a.spec, b.spec));
    reached.forEach(({ spec, distance }, round) => {
      const current = best.get(spec);
      if (
        !current ||
        round < current.round ||
        (round === current.round && distance < current.distance)
      ) {
        best.set(spec, { spec, via: file, distance, round });
      }
    });
  }
  return [...best.values()]
    .sort((a, b) => a.round - b.round || a.distance - b.distance || compare(a.spec, b.spec))
    .map(({ spec, via, distance }) => ({ spec, via, distance }));
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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

// The Markdown note the affected job prints and adds to its step summary.
export function overBudgetNote(selected, overBudget) {
  const lines = [
    `Running ${selected.length} affected component test spec${selected.length === 1 ? '' : 's'} once each.`,
  ];
  if (overBudget.length) {
    lines.push(
      '',
      `**${overBudget.length} more affected spec${overBudget.length === 1 ? ' was' : 's were'} not run on this PR** ` +
        `(budget: ${CT_AFFECTED_BUDGET} per PR). The merge queue runs the full suite. Not run:`,
      '',
      ...overBudget.map((spec) => `- ${spec}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

function usage() {
  return (
    'usage: ct-changed-specs.mjs --diff <base> <head> | --affected <base> <head> | ' +
    '--filters <JSON array> | --repeat-each-listed <report.json> | ' +
    '--over-budget <JSON array> <JSON array>'
  );
}

export function main(
  argv,
  {
    diff = changedFiles,
    graph = ctImportGraph,
    resolveBase = diffBase,
    log = console.log,
    warn = console.error,
    write,
    readReport = (path) => readFileSync(path, 'utf8'),
  } = {},
) {
  const writeOut = write ?? ((text) => process.stdout.write(text));
  if (argv[0] === '--affected') {
    let selected = ERROR_VALUE;
    let overBudget = '[]';
    try {
      const [given, head, ...rest] = argv.slice(1);
      if (!given || !head || rest.length) throw new Error(usage());
      const base = resolveBase(given, head);
      const affected = affectedCtSpecs(graph(base, head), diff(base, head, 'ACMD'));
      affected.forEach(({ spec, via, distance }, index) => {
        const mark = index < CT_AFFECTED_BUDGET ? 'run' : 'over budget';
        log(`${mark}: ${spec} (loads ${via}, ${distance} import${distance === 1 ? '' : 's'} away)`);
      });
      const specs = affected.map(({ spec }) => spec);
      selected = JSON.stringify(specs.slice(0, CT_AFFECTED_BUDGET));
      overBudget = JSON.stringify(specs.slice(CT_AFFECTED_BUDGET));
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
    }
    log(`${AFFECTED_OUTPUT_KEY}=${selected}`);
    log(`${OVER_BUDGET_OUTPUT_KEY}=${overBudget}`);
    return 0;
  }
  if (argv[0] === '--over-budget' && argv.length === 3) {
    try {
      writeOut(overBudgetNote(parseSpecList(argv[1]), parseSpecList(argv[2])));
      return 0;
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
  }
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
  if (argv[0] === '--repeat-each-listed' && argv.length === 2) {
    try {
      const { total, files } = listedCtTests(JSON.parse(readReport(argv[1])));
      const repeat = ctChangedRepeatEach(total);
      for (const { file, tests } of files)
        warn(`  ${file}: ${tests} test${tests === 1 ? '' : 's'}`);
      warn(
        `Discovered ${total} test${total === 1 ? '' : 's'} in ${files.length} spec file${files.length === 1 ? '' : 's'}; ` +
          `repeating each ${repeat} times (${total * repeat} runs; budget ${CT_CHANGED_TEST_RUN_BUDGET}, ` +
          `${CT_CHANGED_MIN_REPEAT_EACH}-${CT_CHANGED_REPEAT_EACH} repetitions).`,
      );
      writeOut(`${repeat}\n`);
      return 0;
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
      return 1;
    }
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
