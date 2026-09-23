/**
 * Resolve the Playwright CT browser-context reuse mode for src/test/ct-test.ts.
 *
 * Kept as a pure function (no `process` access) so vitest can cover the
 * resolution without launching a browser.
 *
 * - `CT_CONTEXT_REUSE` unset, blank, or anything but `1` → `'none'`: every
 *   test gets a fresh browser context (the default).
 * - `CT_CONTEXT_REUSE=1` → `'when-possible'`: ct-core's per-worker
 *   context + page reuse. This is a measurement-only escape hatch for
 *   comparing suite wall time against the default; it brings back the reuse
 *   reset that has raced `mount()` on the merge queue (see ct-test.ts), so it
 *   is never set on CI.
 */
export type CtContextReuseMode = 'none' | 'when-possible';

const CT_CONTEXT_REUSE_DEFAULT: CtContextReuseMode = 'none';

export interface ResolveCtContextReuseModeOptions {
  env: Record<string, string | undefined>;
}

export function resolveCtContextReuseMode({
  env,
}: ResolveCtContextReuseModeOptions): CtContextReuseMode {
  return env.CT_CONTEXT_REUSE?.trim() === '1' ? 'when-possible' : CT_CONTEXT_REUSE_DEFAULT;
}
