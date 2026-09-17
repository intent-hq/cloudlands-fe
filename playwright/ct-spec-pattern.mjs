import { posix, sep } from 'node:path';

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

// True for exactly the files `playwright-ct.config.ts` discovers: under
// `CT_TEST_DIR/`, matching `CT_TEST_MATCH` (Node's built-in glob matcher; the
// fixtures in ct-spec-pattern.test.ts pin that its semantics for this pattern
// equal Playwright's).
export function isCtSpec(file) {
  const path = normalizeCtPath(file);
  const prefix = `${CT_TEST_DIR}/`;
  if (!path.startsWith(prefix)) return false;
  return posix.matchesGlob(path.slice(prefix.length), CT_TEST_MATCH);
}

// Suffix-only check for callers that route a CT-suffixed file outside
// `CT_TEST_DIR` to a different lane instead of ignoring it.
export function hasCtSpecSuffix(file) {
  return normalizeCtPath(file).endsWith(CT_SPEC_SUFFIX);
}

// `<directory>/<scene>.geometry<CT_SPEC_SUFFIX>` → `{ directory, scene }`, with
// `directory` either `''` or ending in `/`; null for any other path.
export function ctGeometryScene(file) {
  const path = normalizeCtPath(file);
  const suffix = `.geometry${CT_SPEC_SUFFIX}`;
  if (!path.endsWith(suffix)) return null;
  const stem = path.slice(0, -suffix.length);
  const slash = stem.lastIndexOf('/');
  const scene = stem.slice(slash + 1);
  if (!scene) return null;
  return { directory: stem.slice(0, slash + 1), scene };
}
