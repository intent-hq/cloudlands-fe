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

// The root must stay short: tests bind Unix sockets under os.tmpdir(), and
// sun_path is capped at 104 bytes (103 usable) on macOS. `mkdtemp` appends 6
// random characters, so the redirect adds `/v-XXXXXX` = 9 bytes.
const ROOT_TEMPLATE = 'v-';
const ROOT_ADDED_BYTES = 1 + ROOT_TEMPLATE.length + 6;

// Worst case on macOS, where os.tmpdir() is `/var/folders/xx/<30 chars>/T`
// (48 bytes). Longest socket paths under it in the unit suite:
//   scripts/vite-plugin-intentd-bridge.test.mjs
//     `/intentd-vite-<12 hex>.sock`                 = 31 bytes
//   src/features/backend/main/intentd-sidecar.test.ts
//     `/intentd-probe-<6 mkdtemp>/missing.sock`     = 34 bytes
// 48 + 9 + 34 = 91 <= 103.
const MACOS_TMPDIR_BYTES = 48;
const LONGEST_SOCKET_SUFFIX_BYTES = 34;
const MAX_UNIX_SOCKET_PATH_BYTES = 103;

export function setup(): void {
  const worstCase = MACOS_TMPDIR_BYTES + ROOT_ADDED_BYTES + LONGEST_SOCKET_SUFFIX_BYTES;
  if (worstCase > MAX_UNIX_SOCKET_PATH_BYTES) {
    throw new Error(
      `Temp-dir hygiene: redirected TMPDIR root would push macOS socket paths to ${worstCase} ` +
        `bytes (limit ${MAX_UNIX_SOCKET_PATH_BYTES}); shorten ROOT_TEMPLATE.`,
    );
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), ROOT_TEMPLATE));
  process.env.TMPDIR = root;
  process.env.TMP = root;
  process.env.TEMP = root;
}

function fail(message: string): Error {
  process.exitCode = 1;
  console.error(message);
  return new Error(message);
}

export function teardown(): void {
  if (!root) return;
  let failure: Error | undefined;

  // Inspect and report before touching anything, so a deletion error can
  // never mask a leak or the failure status.
  try {
    const survivors = fs.readdirSync(root).filter((entry) => !TOOL_CACHE_ENTRY.test(entry));
    if (survivors.length > 0) {
      failure = fail(
        `Temp-dir hygiene: ${survivors.length} entr${survivors.length === 1 ? 'y' : 'ies'} left in ` +
          `${root} after the unit run. Every test that creates a temp dir/file must remove it ` +
          `(afterEach + fs.rmSync(dir, { recursive: true, force: true })):\n  ` +
          survivors.sort().join('\n  '),
      );
    }
  } catch (err) {
    failure = fail(`Temp-dir hygiene: could not inspect ${root}: ${String(err)}`);
  }

  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (err) {
    failure ??= fail(`Temp-dir hygiene: could not remove ${root}: ${String(err)}`);
  }

  if (failure) throw failure;
}
