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

import { protocolMajor } from '$shared/protocol-version';

/** Outcome of comparing two protocolVersions by major segment. */
export type ProtocolComparison = 'match' | 'mismatch' | 'unknown';

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
