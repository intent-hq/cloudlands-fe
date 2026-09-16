#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one list of repo-relative paths whose change requires the full Playwright
// component suite: the stylesheet/token contract that `playwright/index.ts`
// mounts (`src/app.css` imports `$lib/styles/*.css`), the CT harness itself, and
// the dependency manifests (a Playwright/Svelte/Tailwind bump is a CT-contract
// change). `scripts/verify-changed.mjs` selects the local `ct-full` check from it
// and the `pull_request` workflow decides whether to run `test-ct` from the same
// list, via `node scripts/ct-contract-paths.mjs --diff <base> <head>`.
// cloudlands-fe#2441 rewrote `tokens.css`, `app.css` and `run-ct-tests.mjs` with
// no CT run and was ejected from the merge queue with 40 CT failures.
export const CT_CONTRACT_FILES = Object.freeze([
  'src/app.css',
  'playwright-ct.config.ts',
  'scripts/run-ct-tests.mjs',
  'package.json',
  'pnpm-lock.yaml',
]);
export const CT_CONTRACT_DIRECTORIES = Object.freeze(['src/lib/styles/', 'playwright/']);
export const CT_CONTRACT_PATHS = Object.freeze([
  ...CT_CONTRACT_FILES,
  ...CT_CONTRACT_DIRECTORIES.map((directory) => `${directory}**`),
]);

const OUTPUT_KEY = 'ct_required';

function normalize(file) {
  let path = String(file).split(sep).join('/');
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

export function isCtContractPath(file) {
  const path = normalize(file);
  return (
    CT_CONTRACT_FILES.includes(path) ||
    CT_CONTRACT_DIRECTORIES.some((directory) => path.startsWith(directory))
  );
}

export function ctRequired(files) {
  return files.some(isCtContractPath);
}

export function changedFiles(base, head, { cwd = process.cwd() } = {}) {
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', base, head], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
}

export function parseArgs(argv) {
  if (argv[0] !== '--diff') throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  const [base, head, ...rest] = argv.slice(1);
  if (!base || !head || rest.length)
    throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  return { base, head };
}

// Prints exactly one `ct_required=true|false` line and always exits 0: a failure
// to compute relevance must run CT, never skip it.
export function main(argv, { diff = changedFiles, log = console.log, warn = console.error } = {}) {
  let required = true;
  try {
    const { base, head } = parseArgs(argv);
    required = ctRequired(diff(base, head));
  } catch (error) {
    warn(
      `ct-contract-paths: ${error instanceof Error ? error.message : error}; requiring CT (fail-safe)`,
    );
  }
  log(`${OUTPUT_KEY}=${required}`);
  return 0;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) process.exitCode = main(process.argv.slice(2));
