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

const TMP_ENV_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const;
let originalEnv: Partial<Record<(typeof TMP_ENV_KEYS)[number], string | undefined>> = {};

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
  originalEnv = {};
  for (const key of TMP_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    process.env[key] = root;
  }
}

// Restore the inherited values so a watch-mode re-run of setup() does not
// mkdtemp under the root that teardown just deleted.
function restoreEnv(): void {
  for (const key of TMP_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fail(message: string): Error {
  process.exitCode = 1;
  console.error(message);
  return new Error(message);
}

// Failure-only evidence: a surviving fixture name alone cannot distinguish a
// late Git lock from an unrelated child cache (intent-hq/intent#6144). Bound the
// walk and log volume, never read file bodies or traverse symlink entries.
function survivorMetadata(root: string, survivors: string[]): string {
  const maxEntries = 32;
  const maxDepth = 3;
  const maxBytes = 4096;
  const lines: string[] = [];
  const limits = new Set<string>();
  let entries = 0;
  let bytes = 0;
  let stopped = false;

  function emit(value: Record<string, unknown>): boolean {
    const line = JSON.stringify(value);
    const size = Buffer.byteLength(line) + 1;
    // Reserve space for the bounded truncation summary below.
    if (bytes + size > maxBytes - 128) {
      limits.add('output limit');
      stopped = true;
      return false;
    }
    lines.push(line);
    bytes += size;
    return true;
  }

  function visit(relative: string, depth: number): void {
    if (stopped) return;
    if (entries >= maxEntries) {
      limits.add('entry limit');
      stopped = true;
      return;
    }
    entries++;
    const full = path.join(root, relative);
    try {
      const stat = fs.lstatSync(full);
      const type = stat.isSymbolicLink()
        ? 'symlink'
        : stat.isDirectory()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : 'other';
      if (!emit({ path: relative, type, size: stat.size, mtime: stat.mtime.toISOString() })) return;
      if (type !== 'directory') return;
      if (depth >= maxDepth) {
        limits.add('depth limit');
        return;
      }
      // Read incrementally: a wide directory must not require an unbounded
      // readdir allocation just to print the first few entries.
      const directory = fs.opendirSync(full);
      try {
        let entry: fs.Dirent | null;
        while (!stopped && (entry = directory.readSync())) {
          visit(path.join(relative, entry.name), depth + 1);
        }
      } finally {
        directory.closeSync();
      }
    } catch (error) {
      // Entries can vanish or become unreadable between enumeration and stat.
      // Only log errno, not an exception message that could contain file data.
      const code = (error as NodeJS.ErrnoException)?.code;
      emit({
        path: relative,
        error: typeof code === 'string' && /^E[A-Z0-9]{1,30}$/.test(code) ? code : 'unavailable',
      });
    }
  }

  for (const entry of survivors) {
    visit(entry, 0);
    if (stopped) break;
  }
  if (limits.size) lines.push(`... truncated (${[...limits].join(', ')})`);
  return lines.join('\n');
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
          survivorMetadata(root, survivors.sort()),
      );
    }
  } catch (err) {
    failure = fail(`Temp-dir hygiene: could not inspect ${root}: ${String(err)}`);
  }

  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (err) {
    failure ??= fail(`Temp-dir hygiene: could not remove ${root}: ${String(err)}`);
  } finally {
    restoreEnv();
    root = undefined;
  }

  if (failure) throw failure;
}
