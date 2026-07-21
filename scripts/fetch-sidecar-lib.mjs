/**
 * Pure helpers for scripts/fetch-sidecar.cjs — kept side-effect free so they can be
 * unit-tested with vitest (scripts/fetch-sidecar-lib.test.ts).
 *
 * Asset names follow cargo-dist (axo "dist") conventions used by the intentd release
 * pipeline: `<app>-<target>.tar.xz` (unix) / `<app>-<target>.zip` (windows), each with a
 * companion `<asset>.sha256` checksum asset on the GitHub Release.
 */
import { createHash } from 'node:crypto';

export const INTENTD_APP_NAME = 'intentd';

/**
 * Single source of truth for the platform/arch → cargo-dist target triple mapping.
 * Keep in sync with the target list in intent-hq/intentd's release pipeline.
 */
export const TARGET_BY_PLATFORM_ARCH = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

/** Map a Node platform/arch pair to a cargo-dist target triple. Throws when unsupported. */
export function resolveTarget(platform, arch) {
  const target = TARGET_BY_PLATFORM_ARCH[`${platform}-${arch}`];
  if (!target) {
    const supported = Object.keys(TARGET_BY_PLATFORM_ARCH).join(', ');
    throw new Error(
      `Unsupported platform/arch "${platform}-${arch}" for intentd sidecar. Supported: ${supported}`,
    );
  }
  return target;
}

export function isWindowsTarget(target) {
  return target.includes('-windows-');
}

/**
 * Candidate release-asset names for a target, in preference order. Tolerant of
 * tar.xz/tar.gz/zip so cargo-dist packaging changes don't break the fetch.
 */
export function assetCandidates(target, appName = INTENTD_APP_NAME) {
  const extensions = isWindowsTarget(target)
    ? ['.zip', '.tar.xz', '.tar.gz']
    : ['.tar.xz', '.tar.gz', '.zip'];
  return extensions.map((ext) => `${appName}-${target}${ext}`);
}

/** cargo-dist publishes a per-asset checksum file named `<asset>.sha256`. */
export function checksumAssetName(assetName) {
  return `${assetName}.sha256`;
}

/** Name of the intentd binary inside the release archive (and staged sidecar). */
export function sidecarBinaryName(target, appName = INTENTD_APP_NAME) {
  return isWindowsTarget(target) ? `${appName}.exe` : appName;
}

/** Release tag for a pinned version (intentd tags are `vX.Y.Z[-beta.N]`). */
export function releaseTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * Parse the intentd.version pin file: `#`-comment and blank lines are ignored; the
 * remaining line must be a bare semver (no leading `v`).
 */
export function parseVersionPin(content) {
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

/**
 * Extract the expected sha256 hex digest for `assetName` from a checksum file.
 * Accepts: a bare hash, `sha256sum` lines (`<hash>  <file>` / `<hash> *<file>`), and
 * BSD-style lines (`SHA256 (<file>) = <hash>`). Returns lowercase hex, or null when no
 * entry for `assetName` is found.
 */
export function parseChecksumFile(content, assetName) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const isHash = (s) => /^[0-9a-fA-F]{64}$/.test(s);

  for (const line of lines) {
    const bsd = line.match(/^SHA256\s*\((.+)\)\s*=\s*([0-9a-fA-F]{64})$/);
    if (bsd) {
      if (bsd[1] === assetName) return bsd[2].toLowerCase();
      continue;
    }
    const parts = line.split(/\s+/);
    if (!isHash(parts[0])) continue;
    if (parts.length === 1) {
      // Bare hash: only trust it when the file has a single entry.
      if (lines.length === 1) return parts[0].toLowerCase();
      continue;
    }
    const fileName = parts.slice(1).join(' ').replace(/^\*/, '');
    if (fileName === assetName || fileName === `./${assetName}`) {
      return parts[0].toLowerCase();
    }
  }
  return null;
}

/** sha256 hex digest of a Buffer/Uint8Array. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
