import { endsWithNocase, normalizeCtPath } from './ct-spec-pattern.mjs';

// The single definition of which files are root Playwright specs — the
// browser-level suite `pnpm run test:playwright` runs through
// `playwright.config.ts`. That config sets `testDir`/`testMatch`/`testIgnore`
// from these constants, and the scripts classify changed files with
// `isRootSpec` / `isIgnoredRootSpec`, so the classifiers cannot drift from
// discovery. This mirrors `ct-spec-pattern.mjs`, which ended the same drift on
// the CT side (cloudlands-fe#2572); on the root side cloudlands-fe#2720's
// review (https://github.com/intent-hq/cloudlands-fe/pull/2720#discussion_r4059946317)
// found `scripts/check-snapshot-fonts.mjs` re-deriving the `test/**/*.spec.ts`
// walk with its own regex, unaware of the config's `testIgnore`. `.mjs` because
// the scripts run under plain `node`.
export const ROOT_TEST_DIR = 'test';
export const ROOT_SPEC_SUFFIX = '.spec.ts';
export const ROOT_TEST_MATCH = `**/*${ROOT_SPEC_SUFFIX}`;

// Specs that match `ROOT_TEST_MATCH` but run only through
// `playwright.manual.config.ts` (or a dedicated CI job): they need a display,
// a live main branch, or produce review artifacts, so `playwright.config.ts`
// never discovers them.
export const ROOT_IGNORED_SPEC_NAMES = [
  'catalog-manual-review.capture.spec.ts',
  'current-main-baseline.spec.ts',
  'electron-browser-lifetime.spec.ts',
];
export const ROOT_TEST_IGNORE = ROOT_IGNORED_SPEC_NAMES.map((name) => `**/${name}`);

// Playwright matches `testMatch` and `testIgnore` with the same
// `createFileMatcher` (`minimatch(..., { nocase: true, dot: true })`) against
// the absolute path, keeping a file when `!testIgnore(file) && testMatch(file)`.
// `**/*<suffix>` is "ends with <suffix>, case-insensitively, dot segments
// included"; `**/<name>` is "the basename is <name>, case-insensitively" — the
// absolute path always has a directory above the basename.
function matchesRootSuffix(path) {
  return path.startsWith(`${ROOT_TEST_DIR}/`) && endsWithNocase(path, ROOT_SPEC_SUFFIX);
}

function matchesRootIgnore(path) {
  return ROOT_IGNORED_SPEC_NAMES.some((name) => endsWithNocase(path, `/${name}`));
}

// True for exactly the files `playwright.config.ts` discovers and runs: under
// `ROOT_TEST_DIR/`, matching `ROOT_TEST_MATCH`, and not matched by
// `ROOT_TEST_IGNORE`.
export function isRootSpec(file) {
  const path = normalizeCtPath(file);
  return matchesRootSuffix(path) && !matchesRootIgnore(path);
}

// True for the files `playwright.config.ts` would discover but ignores: under
// `ROOT_TEST_DIR/`, matching `ROOT_TEST_MATCH`, and matched by `ROOT_TEST_IGNORE`.
export function isIgnoredRootSpec(file) {
  const path = normalizeCtPath(file);
  return matchesRootSuffix(path) && matchesRootIgnore(path);
}
