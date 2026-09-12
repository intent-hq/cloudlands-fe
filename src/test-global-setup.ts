/**
 * Vitest global setup: temp-dir hygiene guard.
 *
 * Every worker's `os.tmpdir()` is redirected into a private root created here
 * (TMPDIR/TMP/TEMP are read by `os.tmpdir()` on every call and are inherited by
 * the worker processes forked after this runs). Teardown fails the run if any
 * test left an entry behind, naming the survivors, then removes the root.
 *
 * Vitest 4 only logs a globalSetup teardown error ("error during close") and
 * leaves the exit code untouched, so the teardown also sets `process.exitCode`
 * — it runs in the main vitest process, and `Vitest.exit()` ends with a bare
 * `process.exit()` that honors it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let root: string | undefined;

// Per-user caches that tools spawned by tests (tsx, Playwright CLI) create
// under TMPDIR on their own; they are not test leaks.
const TOOL_CACHE_ENTRY = /^(tsx|playwright-transform-cache)-\d+$/;

export function setup(): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudlands-fe-vitest-'));
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
}

export function teardown(): void {
  if (!root) return;
  const survivors = fs.readdirSync(root).filter((entry) => !TOOL_CACHE_ENTRY.test(entry));
  fs.rmSync(root, { recursive: true, force: true });
  if (survivors.length > 0) {
    process.exitCode = 1;
    throw new Error(
      `Temp-dir hygiene: ${survivors.length} entr${survivors.length === 1 ? 'y' : 'ies'} left in ` +
        `${root} after the unit run. Every test that creates a temp dir/file must remove it ` +
        `(afterEach + fs.rmSync(dir, { recursive: true, force: true })):\n  ` +
        survivors.sort().join('\n  '),
    );
  }
}
