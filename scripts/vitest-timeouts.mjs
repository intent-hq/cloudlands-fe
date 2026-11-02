// The default vitest per-test and hook budget, shared by vitest.config.ts and by
// suites that size their own per-test budgets from it, so the two cannot drift.

/** std-env semantics (what vitest itself uses): `CI=false` in a dev shell means "not CI". */
export function isCiEnv(env = process.env) {
  return !!env.CI && env.CI !== 'false';
}

/** 30s locally; 60s on CI, where shared runners can starve a fork ~4x (intent-hq/monorepo#3082). */
export function defaultTestTimeoutMs(env = process.env) {
  return isCiEnv(env) ? 60_000 : 30_000;
}

/**
 * Default limit for Testing Library's async utilities (`waitFor`, `findBy*`,
 * `waitForElementToBeRemoved`), set suite-wide by src/test-setup.ts: half the test
 * budget, so 15s locally and 30s on CI. Testing Library's own 1s default ejected a
 * green cloudlands-fe#3915 from the merge queue when a cold first render ran past it
 * on a loaded runner (merge_group run 41182853681). Half leaves the rest of the test
 * budget for the wait to report a real hang with its own message (the last failed
 * assertion or the DOM it searched) before the test timeout fires.
 */
export function defaultAsyncUtilTimeoutMs(env = process.env) {
  return defaultTestTimeoutMs(env) / 2;
}
