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
  /** Last-writer-wins clock (ms since epoch) shared with keychain sync. */
  updatedAt: number;
}

/** Main→renderer push after any guest sessions mutation (`GuestSessionsListResult`). */
export const GUEST_SESSIONS_CHANGED_EVENT = 'guest-sessions:changed';

/**
 * Result of the `guest-sessions:list` IPC and the `guest-sessions:changed`
 * push. `connectedIds` are the sessions whose pooled client is currently
 * connected (a window for that host is open and live) — the nav block shows
 * "connected" / "not connected" from it and nothing for sessions with no
 * pooled client at all.
 */
export interface GuestSessionsListResult {
  sessions: GuestSessionRecord[];
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
