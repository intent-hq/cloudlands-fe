/**
 * Runtime access to the intentd version pin (`intentd.version` at the FE repo
 * root — the same file `scripts/fetch-sidecar.cjs` uses to pick the bundled
 * sidecar release). The semver comparison helper lives in the shared
 * `$shared/intentd-version-compare` module so renderer code can import it too.
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
      // i18n-ignore (developer-facing config error)
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
