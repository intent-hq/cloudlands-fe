/**
 * Semver comparison against the intentd version pin — shared between the main
 * process (adoption handshake in `features/backend/main`) and renderer code
 * (daemon-health UI). Reading the pin file itself is main-only
 * (`features/backend/main/intentd-version-pin.ts`); this module only compares
 * already-known version strings.
 *
 * Keep this module dependency-light and side-effect free.
 */

/**
 * Result of comparing a daemon version to the pinned version, from the
 * daemon's perspective: `older` = daemon is older than the pin.
 */
export type PinComparison = 'equal' | 'older' | 'newer' | 'unknown';

/** Exact published target syntax; never accepts aliases, build metadata, or leading v. */
export function isExactIntentdVersion(version: string): boolean {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.exec(
      version,
    );
  return (
    match !== null &&
    match[0] === version &&
    match.slice(1, 4).every((core) => BigInt(core) <= 18446744073709551615n)
  );
}

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
