import { execFileSync } from 'node:child_process';
import { normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

// The one list of repo-relative paths whose change requires the full Playwright
// component suite: the stylesheet/token contract that `playwright/index.ts`
// mounts (`src/app.css` imports `$lib/styles/*.css`), the CT harness itself, and
// the mount-harness helpers `playwright/index.ts` imports directly (the rest of
// `src/lib/component-catalog/` is ordinary component code), and the dependency
// manifests (a Playwright/Svelte/Tailwind bump is a CT-contract change).
// `scripts/verify-changed.mjs` selects the local `ct-full` check from it.
// cloudlands-fe#2441 rewrote `tokens.css`, `app.css` and `run-ct-tests.mjs` with
// no CT run and was ejected from the merge queue with 40 CT failures. CI does
// not run component tests on PRs or in the merge queue (the full suite runs
// nightly and on manual dispatch, nightly-browser-tests.yml), so this list is a
// local relevance check only.
//
// Discovered CT specs are NOT contract paths: `verify:changed` selects the
// narrower `ct-related` lane for them (through the shared `isCtSpec`
// classifier), and a fixture edit selects only related tests.
export const CT_CONTRACT_FILES = Object.freeze([
  'src/app.css',
  'playwright-ct.config.ts',
  'scripts/run-ct-tests.mjs',
  'scripts/ct-browser.mjs',
  'scripts/playwright-os-deps-lib.mjs',
  'patches/playwright-core@1.58.2.patch',
  'src/test/ct-test.ts',
  'src/lib/component-catalog/capture-stability.ts',
  'src/lib/component-catalog/preview-definition.ts',
  // Every edit is a trigger, including script-only changes such as dist:all.
  'package.json',
  'pnpm-lock.yaml',
]);
// Directory prefixes; `isCtContractPath` subtracts the Vitest suites under
// `playwright/` (see isPlaywrightUnitTest).
export const CT_CONTRACT_DIRECTORIES = Object.freeze(['src/lib/styles/', 'playwright/']);

// Vitest suites colocated with the harness (`playwright/ct-port.test.ts`, …)
// are not harness inputs: Playwright discovers only `.ct.spec.ts` files and no
// CT run loads a `.test.*` module unless something imports it. cloudlands-fe#4060
// added a comment to `playwright/root-harness-import-guard.test.ts` and paid a
// 1.4-hour local component run plus about 1.5 hours of test-ct shards in the
// merge queue. A suite the harness did import would select no CT lane locally
// (as for `src/**/*.test.ts`), so keep shared harness code in non-.test modules.
// Matching is case-sensitive like Vitest's include glob, and `.spec.*` and
// snapshot files stay contract paths.
const PLAYWRIGHT_UNIT_TEST = /^playwright\/.*\.test\.[cm]?[jt]sx?$/;

export function isPlaywrightUnitTest(file) {
  return PLAYWRIGHT_UNIT_TEST.test(normalizeCtPath(file));
}

export function isCtContractPath(file) {
  const path = normalizeCtPath(file);
  if (CT_CONTRACT_FILES.includes(path)) return true;
  if (isPlaywrightUnitTest(path)) return false;
  return CT_CONTRACT_DIRECTORIES.some((directory) => path.startsWith(directory));
}

// The commit to diff `head` against: the merge-base of `base` and `head`, so
// the diff holds only what `head` changed since it branched (a three-dot
// diff), never the files `base` changed after that point. cloudlands-fe#4114
// (job 126070303811) repeated six specs only main had changed and hit its
// time limit. When no merge-base is reachable (a shallow clone with the two
// commits fetched at depth 1), `base` itself is the closest answer: the diff
// can only be wider, never miss a change of `head`. An unknown revision still
// fails in the diff that follows.
export function diffBase(base, head, { cwd = process.cwd() } = {}) {
  try {
    return (
      execFileSync('git', ['merge-base', base, head], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || base
    );
  } catch {
    return base;
  }
}
