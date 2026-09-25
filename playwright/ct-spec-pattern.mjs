import { sep } from 'node:path';

// The single definition of which files are Playwright component tests.
// `playwright-ct.config.ts` sets `testDir`/`testMatch` from these constants, and
// `scripts/ct-contract-paths.mjs` / `scripts/verify-changed.mjs` classify changed
// files with `isCtSpec`, so the classifiers cannot drift from discovery: before
// this module, cloudlands-fe#2572 copied a broader `verify-changed` regex into
// `ct-contract-paths.mjs` and needed a review round-trip to narrow it, and
// `verify-changed` itself routed `*.ct.test.ts` / `*.ct.spec.js` to the CT lane
// although Playwright never discovers them. `.mjs` because the scripts run
// under plain `node`.
export const CT_TEST_DIR = 'src';
export const CT_SPEC_SUFFIX = '.ct.spec.ts';
export const CT_TEST_MATCH = `**/*${CT_SPEC_SUFFIX}`;

export function normalizeCtPath(file) {
  let path = String(file).split(sep).join('/');
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

// Playwright evaluates `testMatch` with `createFileMatcher` (playwright/lib/util.js):
// `minimatch(filePath, pattern, { nocase: true, dot: true })`, and its `testDir`
// walk skips only `node_modules` and `.gitignore` rules. For `**/*<suffix>` that
// is exactly "the path ends with <suffix>, case-insensitively, dotfiles and
// dot-directories included" — so the classifiers compare suffixes that way
// instead of using Node's `path.matchesGlob`, which is case-sensitive and
// rejects dot segments (playwright/ct-spec-pattern.test.ts pins the agreement
// against the CT runner's own matcher). Exported so `root-spec-pattern.mjs`
// shares the one implementation instead of re-deriving it.
export function endsWithNocase(path, suffix) {
  return path.toLowerCase().endsWith(suffix.toLowerCase());
}

// True for exactly the files `playwright-ct.config.ts` discovers: under
// `CT_TEST_DIR/` and matching `CT_TEST_MATCH` under Playwright's semantics.
export function isCtSpec(file) {
  const path = normalizeCtPath(file);
  return path.startsWith(`${CT_TEST_DIR}/`) && endsWithNocase(path, CT_SPEC_SUFFIX);
}

// Suffix-only check for callers that route a CT-suffixed file outside
// `CT_TEST_DIR` to a different lane instead of ignoring it.
export function hasCtSpecSuffix(file) {
  return endsWithNocase(normalizeCtPath(file), CT_SPEC_SUFFIX);
}

// `<directory>/<scene>.geometry<CT_SPEC_SUFFIX>` → `{ directory, scene }`, with
// `directory` either `''` or ending in `/`; null for any other path.
export function ctGeometryScene(file) {
  const path = normalizeCtPath(file);
  const suffix = `.geometry${CT_SPEC_SUFFIX}`;
  if (!endsWithNocase(path, suffix)) return null;
  const stem = path.slice(0, -suffix.length);
  const slash = stem.lastIndexOf('/');
  const scene = stem.slice(slash + 1);
  if (!scene) return null;
  return { directory: stem.slice(0, slash + 1), scene };
}
