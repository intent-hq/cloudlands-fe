#!/usr/bin/env node
// Lists the component-test spec files a pull request adds or edits, so PR CI
// can run just those files many times with retries off (the `test-ct-changed`
// job in .github/workflows/intent-pr.yml). The full CT suite only runs in the
// merge queue, so before this job a new or edited spec that passed only some of
// the time was first caught there, ejecting unrelated PRs: dock-actions.ct.spec.ts
// ejected cloudlands-fe#3978 and dock-composer-spec.ct.spec.ts (added in #3794)
// ejected #4002, failing 12 of 40 local runs under CPU load.
//
// Two modes:
//   --diff <base> <head>   prints one `ct_changed_specs=<JSON array>` line for
//                          $GITHUB_OUTPUT. Any error prints
//                          `ct_changed_specs=error`, which the job and the CI
//                          Gate both treat as a failure (never as "no specs").
//   --filters <JSON>       prints the Playwright file filters for that list,
//                          NUL-separated, one anchored and regex-escaped
//                          pattern per spec (Playwright treats positional
//                          arguments as regular expressions over the file
//                          path, and SvelteKit-style `[id]` or `+page`
//                          segments would otherwise be read as regex syntax).
//   --repeat-each <JSON>   prints the repetition count for that list (see
//                          ctChangedRepeatEach).
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

export const OUTPUT_KEY = 'ct_changed_specs';
export const ERROR_VALUE = 'error';
// Each changed spec runs this many times with retries off. dock-composer-spec
// failed 12 of 40 runs under load, so 20 repetitions miss a flake that common
// with a probability far below one in a thousand.
export const CT_CHANGED_REPEAT_EACH = 20;
// A PR that edits many specs at once (a rename or a shared-helper refactor)
// would turn 20 repetitions into hours. Spread a fixed budget of spec-file runs
// over the changed files instead, never dropping below a few repetitions.
export const CT_CHANGED_RUN_BUDGET = 200;
export const CT_CHANGED_MIN_REPEAT_EACH = 3;

export function ctChangedRepeatEach(specCount) {
  const scaled = Math.floor(CT_CHANGED_RUN_BUDGET / Math.max(1, specCount));
  return Math.max(CT_CHANGED_MIN_REPEAT_EACH, Math.min(CT_CHANGED_REPEAT_EACH, scaled));
}

// Added, copied and modified paths only: a deleted spec has nothing to run, and
// --no-renames reports a moved spec as an addition at its new path.
export function changedFiles(base, head) {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACM', base, head],
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
  return 'usage: ct-changed-specs.mjs --diff <base> <head> | --filters <JSON array> | --repeat-each <JSON array>';
}

export function main(
  argv,
  { diff = changedFiles, log = console.log, warn = console.error, write } = {},
) {
  const writeOut = write ?? ((text) => process.stdout.write(text));
  if (argv[0] === '--diff') {
    let value = ERROR_VALUE;
    try {
      const [base, head, ...rest] = argv.slice(1);
      if (!base || !head || rest.length) throw new Error(usage());
      value = JSON.stringify(changedCtSpecs(diff(base, head)));
    } catch (error) {
      warn(`ct-changed-specs: ${error instanceof Error ? error.message : error}`);
    }
    log(`${OUTPUT_KEY}=${value}`);
    return 0;
  }
  if ((argv[0] === '--filters' || argv[0] === '--repeat-each') && argv.length === 2) {
    try {
      const specs = parseSpecList(argv[1]);
      if (specs.length === 0) throw new Error('no component test specs to run');
      writeOut(
        argv[0] === '--filters'
          ? specs.map((spec) => `${playwrightFilter(spec)}\0`).join('')
          : `${ctChangedRepeatEach(specs.length)}\n`,
      );
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
