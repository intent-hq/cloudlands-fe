// Single source of truth for the Node flags vitest.config.ts passes to every
// test fork (`test.execArgv`), and the helper src/test-setup.ts uses to keep
// them out of `process.execArgv` inside the fork.
//
// V8 flags are process-wide, so a fork started with `--no-sparkplug` already
// runs without Sparkplug; `process.execArgv` only matters for what the fork's
// children and worker_threads inherit. Node validates a Worker's `execArgv`
// only when it is passed explicitly, and rejects per-process V8 flags with
// ERR_WORKER_INVALID_EXEC_ARGV — the shape `@lix-js/sdk` (via
// @inlang/paraglide-js) uses: `new Worker(url, { execArgv: process.execArgv })`.
// Stripping the fork-only flags at setup time makes that construction succeed
// without test authors knowing about the Sparkplug workaround.

/**
 * Flags vitest passes to each test fork. Node 24's V8 Sparkplug/GC regression
 * (nodejs/node#62393) SIGSEGVs long test runs; disabling Sparkplug avoids it
 * until the pinned runtime contains the upstream fix.
 * @type {readonly string[]}
 */
export const FORK_EXEC_ARGV = Object.freeze(['--no-sparkplug']);

/**
 * Splits `execArgv` into the entries to keep and the fork-only flags removed.
 * Pure and idempotent: never mutates its input, and running it over `kept`
 * again removes nothing.
 * @param {readonly string[]} execArgv
 * @returns {{ kept: string[]; removed: string[] }}
 */
export function stripForkExecArgv(execArgv) {
  /** @type {string[]} */
  const kept = [];
  /** @type {string[]} */
  const removed = [];
  for (const arg of execArgv) {
    (FORK_EXEC_ARGV.includes(arg) ? removed : kept).push(arg);
  }
  return { kept, removed };
}
