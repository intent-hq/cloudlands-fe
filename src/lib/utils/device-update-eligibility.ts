/**
 * Update-eligibility predicates for the Devices page — decide when a remote
 * device's daemon is behind the app's pinned intentd version and when the
 * remote Update action may be offered.
 *
 * Keep this module dependency-light and side-effect free: it only compares
 * already-known values (no stores, services, or IPC).
 */

import { compareToPinnedVersion } from '$shared/intentd-version-compare';

/** The minimal connection shape the eligibility predicates need. */
export interface UpdateEligibilityConnection {
  id: string;
  /** True for the synthesized local sidecar entry — never update-eligible. */
  isLocal: boolean;
  /** The remote daemon's reported version, or null/absent until captured. */
  daemonVersion?: string | null;
}

/**
 * True when the connection's captured daemon version is strictly older than
 * the pinned sidecar version. Never true for the local entry, when either
 * version is missing, or when the comparison is `unknown` (unparsable).
 */
export function isDaemonBehindPin(
  conn: UpdateEligibilityConnection,
  pinnedVersion: string | null | undefined,
): boolean {
  if (conn.isLocal) return false;
  if (!conn.daemonVersion || !pinnedVersion) return false;
  return compareToPinnedVersion(conn.daemonVersion, pinnedVersion) === 'older';
}

/**
 * True when the remote Update action may be offered for `conn`: its daemon is
 * behind the pin ({@link isDaemonBehindPin}) AND it has a live, currently
 * connected client in main's pool (`connectedIds`).
 */
export function canRequestDeviceUpdate(
  conn: UpdateEligibilityConnection,
  connectedIds: readonly string[] | undefined,
  pinnedVersion: string | null | undefined,
): boolean {
  if (!isDaemonBehindPin(conn, pinnedVersion)) return false;
  return connectedIds?.includes(conn.id) ?? false;
}
