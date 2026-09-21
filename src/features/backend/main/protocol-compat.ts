/**
 * Protocol-compatibility comparison for the multi-backend connect feature (T15).
 *
 * When the FE switches to a remote daemon we compare that daemon's reported
 * `protocolVersion` (from its `client.hello` handshake) against the LOCAL
 * bundled sidecar's `protocolVersion`. A **major-version** difference is a
 * warn-but-allow signal: the connection still proceeds, but the renderer
 * surfaces a non-blocking notice (see `ConnectionProtocolMismatchEvent`).
 *
 * `protocolVersion` is a dotted string whose first segment is the major
 * (e.g. `"1"`, `"2.2"` → majors `1`, `2`). Only the major segment is
 * significant here — minor bumps are backward-compatible by contract.
 *
 * Keep this module dependency-light and side-effect free so it is trivially
 * unit-testable without the Electron/transport module graph.
 */

/** Outcome of comparing two protocolVersions by major segment. */
export type ProtocolComparison = 'match' | 'mismatch' | 'unknown';

/**
 * Extract the numeric major segment of a protocolVersion string (the part
 * before the first `.`). Returns `null` when the value is absent or the major
 * segment is not a non-negative integer.
 */
export function protocolMajor(version: string | null | undefined): number | null {
  if (typeof version !== 'string') return null;
  const major = version.trim().split('.')[0];
  if (!/^\d+$/.test(major)) return null;
  return Number(major);
}

/**
 * Compare a local and a remote protocolVersion by major segment.
 *   - `match`    → same major (or, defensively, byte-identical strings).
 *   - `mismatch` → both parse and majors differ (warn-but-allow).
 *   - `unknown`  → either side is missing/unparsable; callers show no warning.
 */
export function compareProtocolMajor(
  localVersion: string | null | undefined,
  remoteVersion: string | null | undefined,
): ProtocolComparison {
  const local = protocolMajor(localVersion);
  const remote = protocolMajor(remoteVersion);
  if (local === null || remote === null) return 'unknown';
  return local === remote ? 'match' : 'mismatch';
}

/**
 * Whether a protocolVersion is at least `major.minor`, compared numerically
 * segment by segment (`10.10` ≥ `10.4`; any greater major passes regardless
 * of minor). A missing minor segment counts as `0`. Returns `false` when the
 * value is absent or its major/minor segments are not non-negative integers,
 * so callers gating an additive feature never send it to an unknown daemon.
 */
export function protocolVersionAtLeast(
  version: string | null | undefined,
  major: number,
  minor: number,
): boolean {
  if (typeof version !== 'string') return false;
  const [majorSegment, minorSegment = '0'] = version.trim().split('.');
  if (!/^\d+$/.test(majorSegment) || !/^\d+$/.test(minorSegment)) return false;
  const actualMajor = Number(majorSegment);
  if (actualMajor !== major) return actualMajor > major;
  return Number(minorSegment) >= minor;
}
