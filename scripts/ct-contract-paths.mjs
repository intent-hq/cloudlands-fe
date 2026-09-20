#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CT_TEST_DIR, isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

// The one list of repo-relative paths whose change requires the full Playwright
// component suite: the stylesheet/token contract that `playwright/index.ts`
// mounts (`src/app.css` imports `$lib/styles/*.css`), the CT harness itself, and
// the mount-harness helpers `playwright/index.ts` imports directly (the rest of
// `src/lib/component-catalog/` is ordinary component code), and the dependency
// manifests (a Playwright/Svelte/Tailwind bump is a CT-contract change).
// `scripts/verify-changed.mjs` selects the local `ct-full` check from it
// and the `pull_request` workflow decides whether to run `test-ct` from the same
// list, via `node scripts/ct-contract-paths.mjs --diff <base> <head>`.
// cloudlands-fe#2441 rewrote `tokens.css`, `app.css` and `run-ct-tests.mjs` with
// no CT run and was ejected from the merge queue with 40 CT failures.
//
// The workflow's `ct_required` additionally covers the CT test artifacts
// themselves — the specs `playwright-ct.config.ts` discovers and the geometry
// goldens `src/**/__geometry__/*.geometry.json` (`isCtTestArtifact`) — so a PR that
// edits specs or baselines gets CT signal on pull_request. Those are NOT contract
// paths: `verify:changed` keeps selecting the narrower `ct-related` lane for
// them locally. cloudlands-fe#2533 changed 22 specs and 1 golden with CT skipped
// on the PR and was ejected from the merge queue three times.
export const CT_CONTRACT_FILES = Object.freeze([
  'src/app.css',
  'playwright-ct.config.ts',
  'scripts/run-ct-tests.mjs',
  'src/lib/component-catalog/capture-stability.ts',
  'src/lib/component-catalog/geometry-probe.ts',
  'src/lib/component-catalog/preview-definition.ts',
  'package.json',
  'pnpm-lock.yaml',
]);
export const CT_CONTRACT_DIRECTORIES = Object.freeze(['src/lib/styles/', 'playwright/']);
export const CT_CONTRACT_PATHS = Object.freeze([
  ...CT_CONTRACT_FILES,
  ...CT_CONTRACT_DIRECTORIES.map((directory) => `${directory}**`),
]);

// The spec half is `isCtSpec` — exactly what `playwright-ct.config.ts` discovers,
// since both read `playwright/ct-spec-pattern.mjs` (a broader pattern would
// require CT for files the matrix never loads); the golden half is the path
// `geometrySnapshotTargets` in `scripts/verify-changed.mjs` derives (matched
// relative to `CT_TEST_DIR/`; dot-prefixed segments are accepted).
const CT_GEOMETRY_GOLDEN_RE = /^(?:.*\/)?__geometry__\/[^/]+\.geometry\.json$/;

const OUTPUT_KEY = 'ct_required';

export function isCtContractPath(file) {
  const path = normalizeCtPath(file);
  return (
    CT_CONTRACT_FILES.includes(path) ||
    CT_CONTRACT_DIRECTORIES.some((directory) => path.startsWith(directory))
  );
}

function isCtGeometryGolden(file) {
  const path = normalizeCtPath(file);
  const prefix = `${CT_TEST_DIR}/`;
  return path.startsWith(prefix) && CT_GEOMETRY_GOLDEN_RE.test(path.slice(prefix.length));
}

export function isCtTestArtifact(file) {
  return isCtSpec(file) || isCtGeometryGolden(file);
}

export function ctRequired(files) {
  return files.some((file) => isCtContractPath(file) || isCtTestArtifact(file));
}

// `-z` keeps paths verbatim (no `core.quotePath` escaping of non-ASCII names) and
// `--no-renames` reports a rename as delete + add, so a contract file moved out of
// the list still surfaces on its old path.
export function changedFiles(base, head, { cwd = process.cwd() } = {}) {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMD', base, head],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
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
