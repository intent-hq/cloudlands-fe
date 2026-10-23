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
