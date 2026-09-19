/**
 * Guest sessions: the renderer-facing contract for daemons this app joined as
 * a GUEST through an `intent://invite` link (multiplayer). A guest session is
 * a credential the daemon minted for THIS user's own principal (identity
 * proven through a GitHub device flow), stored apart from the paired
 * (owner) backend registry in `shared/types/connections.ts`.
 *
 * Tokens never cross IPC: the record carries the daemon's dial envelope and
 * the principal identity only.
 */

/**
 * One workspace joined on a guest host, as recorded locally at join time
 * (the invite's `workspaceId` / `workspaceTitle`). A per-workspace *Leave*
 * drops the entry; the session itself outlives its last workspace so a
 * re-invite from the same host reuses the credential.
 */
export interface GuestWorkspaceRef {
  id: string;
  title: string;
}

export interface GuestSessionRecord {
  /** Stable id; doubles as the window/backend id for the session's windows. */
  id: string;
  /** Display label (the daemon's hostname once captured, else `host:port`). */
  label: string;
  /** Primary remote host/IP (identity, with `port`). */
  host: string;
  /** Candidate hosts, primary first (every connect races all of them). */
  hosts: string[];
  port: number;
  /** Pinned self-signed cert fingerprint, SHA-256 colon-hex (PROTOCOL §1.2). */
  fingerprint: string;
  /** tc address of the daemon's tailcat tunnel endpoint (PROTOCOL §12.3), or null. */
  tcAddress: string | null;
  /** The remote machine's hostname (from `host.status`) once captured. */
  hostname: string | null;
  /** Principal id the daemon minted the credential for. */
  principalId: string;
  /** GitHub login the invitee proved during the device flow. */
  login: string;
  /**
   * Whether the stored credential is `safeStorage` ciphertext. `false` marks
   * the flagged plaintext fallback taken when OS encryption was unavailable
   * at join time — surfaced so the user can decide to forget and re-join.
   */
  tokenEncrypted: boolean;
  /** Workspaces joined on this host (local record, join order). */
  workspaces: GuestWorkspaceRef[];
  /** Last-writer-wins clock (ms since epoch) shared with keychain sync. */
  updatedAt: number;
}

/** Main→renderer push after any guest sessions mutation (`GuestSessionsListResult`). */
export const GUEST_SESSIONS_CHANGED_EVENT = 'guest-sessions:changed';

/**
 * Result of the `guest-sessions:list` IPC and the `guest-sessions:changed`
 * push. `openIds` are the sessions with a pooled client (a window for that
 * host was opened); `connectedIds` the subset whose client is currently
 * connected. The nav block shows "connected" / "not connected" for open
 * sessions only and no status at all for a session with no pooled client.
 * Both are token-free projections of main's pool.
 */
export interface GuestSessionsListResult {
  sessions: GuestSessionRecord[];
  openIds: string[];
  connectedIds: string[];
}

/** Params of the `guest-sessions:leave` IPC. */
export interface LeaveGuestSessionParams {
  id: string;
}

/**
 * Result of the `guest-sessions:leave` IPC. `revoked` reports whether the
 * best-effort `principal.revokeSelf` reached the host; the local delete and
 * window teardown happen regardless (there is no retry queue: the credential
 * is deleted with the session, so nothing could retry).
 */
export interface LeaveGuestSessionResult {
  id: string;
  revoked: boolean;
}

/** Params of the `guest-sessions:leave-workspace` IPC. */
export interface LeaveGuestWorkspaceParams {
  id: string;
  workspaceId: string;
}

/**
 * Result of the `guest-sessions:leave-workspace` IPC. `left` echoes the
 * host's `workspace.members.leave` answer (`false` when the membership was
 * already gone). The workspace is dropped from the local record either way;
 * a host that could not be reached or refused rejects the invoke and leaves
 * the record untouched so the user can retry.
 */
export interface LeaveGuestWorkspaceResult {
  id: string;
  workspaceId: string;
  left: boolean;
}
