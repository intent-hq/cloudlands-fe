/**
 * Runtime access to the intentd version pin (`intentd.version` at the FE repo
 * root — the same file `scripts/fetch-sidecar.cjs` uses to pick the bundled
 * sidecar release) plus a semver comparison helper for checking an adopted
 * daemon's reported version against the pin.
 *
 * Pin location:
 *   - Dev → `<fe-root>/intentd.version`, resolved relative to this module
 *     (both `src/…` under vitest and the tsc `dist/…` output sit one level
 *     under the FE root, so the same relative walk works for both).
 *   - Packaged → `process.resourcesPath/intentd.version` (copied by
 *     electron-builder `extraResources`, see electron-builder.yml).
 *
 * Keep this module dependency-light and side-effect free.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Parse the intentd.version pin file: `#`-comment and blank lines are ignored;
 * the remaining line must be a bare semver (no leading `v`). Mirrors
 * `parseVersionPin` in `scripts/fetch-sidecar-lib.mjs` — keep in sync.
 * Throws on malformed content.
 */
export function parseVersionPin(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length !== 1) {
    throw new Error(`intentd.version must contain exactly one version line, found ${lines.length}`);
  }
  const version = lines[0];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid intentd version pin "${version}" (expected e.g. 1.2.3 or 1.2.3-beta.1, no leading "v")`,
    );
  }
  return version;
}

/** Resolve the pin file location for the current posture. */
export function resolvePinFilePath(isPackaged: boolean, resourcesPath?: string): string {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, 'intentd.version');
  }
  // Dev/vitest: this module lives 4 levels below the FE root
  // (src|dist / features / backend / main).
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '../../../..', 'intentd.version');
}

/**
 * Read and parse the pinned intentd version. Returns `null` when the pin file
 * is missing or malformed (callers degrade to "no comparison" rather than
 * failing startup).
 */
export function readPinnedVersion(
  opts: { isPackaged: boolean; resourcesPath?: string } = { isPackaged: false },
): string | null {
  try {
    const pinFile = resolvePinFilePath(opts.isPackaged, opts.resourcesPath);
    return parseVersionPin(fs.readFileSync(pinFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Result of comparing a daemon version to the pinned version, from the
 * daemon's perspective: `older` = daemon is older than the pin.
 */
export type PinComparison = 'equal' | 'older' | 'newer' | 'unknown';

/** Parse `X.Y.Z[-pre][+build]` (tolerates a leading `v`). */
function parseSemver(version: string): { core: number[]; pre: string[] } | null {
  const match = version
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compare a daemon-reported version against the pinned version (semver
 * ordering, including prerelease identifiers per semver §11). Returns
 * `unknown` when either version is unparsable.
 */
export function compareToPinnedVersion(daemonVersion: string, pinned: string): PinComparison {
  const daemon = parseSemver(daemonVersion);
  const pin = parseSemver(pinned);
  if (!daemon || !pin) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (daemon.core[i] !== pin.core[i]) return daemon.core[i] < pin.core[i] ? 'older' : 'newer';
  }
  // Same core version: a release outranks any prerelease.
  if (daemon.pre.length === 0 && pin.pre.length === 0) return 'equal';
  if (daemon.pre.length === 0) return 'newer';
  if (pin.pre.length === 0) return 'older';
  const len = Math.max(daemon.pre.length, pin.pre.length);
  for (let i = 0; i < len; i++) {
    const a = daemon.pre[i];
    const b = pin.pre[i];
    // A shorter prerelease list sorts lower when all shared identifiers match.
    if (a === undefined) return 'older';
    if (b === undefined) return 'newer';
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b);
      if (diff !== 0) return diff < 0 ? 'older' : 'newer';
    } else if (aNumeric !== bNumeric) {
      // Numeric identifiers sort below alphanumeric ones.
      return aNumeric ? 'older' : 'newer';
    } else if (a !== b) {
      return a < b ? 'older' : 'newer';
    }
  }
  return 'equal';
}
