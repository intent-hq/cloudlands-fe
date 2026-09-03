/**
 * Update-eligibility predicates for the Devices page — decide when a
 * device's daemon is behind the app's pinned intentd version and when the
 * Update action may be offered. The synthesized local entry is evaluated
 * like a remote: its record only carries `daemonVersion`/`updateSupported`
 * for an adopted external daemon over UDS, so the spawned sidecar (which
 * carries neither) stays ineligible naturally.
 *
 * Keep this module dependency-light and side-effect free: it only compares
 * already-known values (no stores, services, or IPC).
 */

import { compareToPinnedVersion, isExactIntentdVersion } from '$shared/intentd-version-compare';

/** The minimal connection shape the eligibility predicates need. */
export interface UpdateEligibilityConnection {
  id: string;
  /** The daemon's reported version, or null/absent until captured. */
  daemonVersion?: string | null;
  /**
   * Whether the daemon reports self-update support (`updateSupported`
   * from `system.status`), or null/absent while unknown (capture pending, or
   * a daemon too old to report the field).
   */
  updateSupported?: boolean | null;
  exactVersionUpdateSupported?: boolean | null;
}

/**
 * True when the connection's captured daemon version is strictly older than
 * the pinned sidecar version. Never true when either version is missing or
 * when the comparison is `unknown` (unparsable).
 */
export function isDaemonBehindPin(
  conn: UpdateEligibilityConnection,
  pinnedVersion: string | null | undefined,
): boolean {
  if (!conn.daemonVersion || !pinnedVersion) return false;
  return compareToPinnedVersion(conn.daemonVersion, pinnedVersion) === 'older';
}

/**
 * True when the Update action may be offered for `conn`: its daemon is
 * behind the pin ({@link isDaemonBehindPin}), it explicitly reports
 * legacy and exact-version support (both flags must be true — unknown/absent is
 * NOT offered, e.g. a daemon too old to report the field or one not
 * sitter-supervised), AND it has a live, currently connected client in main's
 * pool (`connectedIds`).
 */
export function canRequestDeviceUpdate(
  conn: UpdateEligibilityConnection,
  connectedIds: readonly string[] | undefined,
  pinnedVersion: string | null | undefined,
): boolean {
  if (!pinnedVersion || !isExactIntentdVersion(pinnedVersion)) return false;
  if (!isDaemonBehindPin(conn, pinnedVersion)) return false;
  if (conn.updateSupported !== true || conn.exactVersionUpdateSupported !== true) return false;
  return connectedIds?.includes(conn.id) ?? false;
}
