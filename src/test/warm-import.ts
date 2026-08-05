import { beforeAll } from 'vitest';

/**
 * Pre-warms a lazily imported module graph before any test in the file runs.
 *
 * Suites that render components via `await import('../Foo.svelte')` inside a
 * render helper (deferred so hoisted `vi.mock` declarations apply first) pay
 * the full cost of compiling and evaluating the component and its transitive
 * dependency graph inside the FIRST test that renders. On loaded CI runners
 * that cold import alone can exceed the test timeout, producing spurious
 * timeout flakes (intent-hq/monorepo#1464).
 *
 * Calling `warmImport(() => import('../Foo.svelte'))` at module top level
 * registers a file-level `beforeAll` that performs the import once under a
 * generous dedicated timeout, so every later `await import(...)` of the same
 * specifier is a module-cache hit and test bodies are billed only for their
 * own work. `vi.mock` registrations are hoisted and applied before the hook
 * runs, so the warmed graph observes the same mocks as the tests.
 *
 * @param importer thunk performing the dynamic import to warm; use the exact
 *   same specifier as the suite's render helper so the module cache key matches
 * @param timeoutMs `beforeAll` timeout for the warm-up (default 120s)
 */
export function warmImport(importer: () => Promise<unknown>, timeoutMs = 120_000): void {
  beforeAll(async () => {
    await importer();
  }, timeoutMs);
}
