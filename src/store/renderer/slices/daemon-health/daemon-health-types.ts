/**
 * Daemon Health Types
 *
 * Types for the daemon-health Redux slice.
 * Safe to import from any process.
 */

/**
 * Tri-state health value derived from connection + heartbeat status.
 */
export type DaemonHealth = 'healthy' | 'degraded' | 'down';

/**
 * system.status wire payload shape (intentd control.rs §5.7, §12.3).
 * New fields (maxAgents, version, uptimeSeconds) are optional for graceful
 * degradation when the daemon lacks them.
 */
export interface SystemStatusWirePayload {
  running: boolean;
  listenMode: string;
  transports: string[];
  port?: number | null;
  clients: number;
  agents: number;
  /** New in PR #244, may be missing on older daemons. */
  maxAgents?: number;
  /** New in PR #244, may be missing on older daemons. */
  version?: string;
  /** New in PR #244, may be missing on older daemons. */
  uptimeSeconds?: number;
  /** Daemon process CPU usage in percent (sysinfo convention, may exceed 100%). May be missing on older daemons. */
  cpuPercent?: number;
  /** Daemon process resident memory (RSS) in bytes. May be missing on older daemons. */
  memoryBytes?: number;
  fingerprint?: string | null;
  protocolVersion: string;
  host: {
    os: string;
    arch: string;
    hasDisplay: boolean;
    locality: 'local' | 'remote';
  };
}

/**
 * FE connection mode to the intentd daemon.
 * Additive transport info from backend:get-status and backend:status.
 *   - `sidecar-uds`  → local UDS to the daemon Electron spawned.
 *   - `external-uds` → local UDS to a daemon Electron did not spawn (adopted
 *     an already-running daemon, or an env socket override).
 *   - `external-ws`  → remote WebSocket (or TCP stub).
 */
export interface BackendTransportInfo {
  mode: 'sidecar-uds' | 'external-uds' | 'external-ws';
  target?: string;
  /** Version reported by an adopted external daemon (version handshake). */
  daemonVersion?: string;
  /** True when the adopted daemon's version differs from the bundled intentd.version pin (warn-only). */
  versionMismatch?: boolean;
}

/**
 * Stats payload exposed by selectors for the health dropdown menu.
 */
export interface DaemonHealthStats {
  clients: number;
  agents: number;
  maxAgents?: number;
  listenMode: string;
  port?: number | null;
  version?: string;
  /** Optional for backward compatibility with older daemons. */
  protocolVersion?: string;
  uptimeSeconds?: number;
  /** Daemon process CPU usage in percent (sysinfo convention, may exceed 100%). Optional for older daemons. */
  cpuPercent?: number;
  /** Daemon process resident memory (RSS) in bytes. Optional for older daemons. */
  memoryBytes?: number;
  os: string;
  arch: string;
  /** FE connection mode (sidecar UDS vs external WebSocket). Optional for backward compatibility. */
  transport?: BackendTransportInfo;
}

/**
 * Daemon health slice state.
 */
export interface DaemonHealthState {
  /** Tri-state health value. */
  health: DaemonHealth;
  /** Stats from last successful system.status poll, or null if never fetched. */
  stats: DaemonHealthStats | null;
  /** Timestamp of last successful update (ISO 8601), or null. */
  lastUpdated: string | null;
  /** Whether a poll is in flight. */
  polling: boolean;
  /**
   * Last-known transport info from backend:get-status / backend:status.
   * Kept at the top level (unlike stats.transport) so the connection mode
   * survives disconnects — the daemon-loss UI needs it while health is 'down'.
   */
  transport: BackendTransportInfo | null;
  /**
   * Daemon-reported connection locality from the last system.status poll
   * (`host.locality`, PROTOCOL §5.7/§5.14), or null before the first poll.
   * Authoritative over the FE transport heuristic: it reflects a forced
   * `server.locality` override (§5.12) the transport mode cannot see.
   */
  hostLocality: 'local' | 'remote' | null;
  /**
   * True when the sidecar supervisor exhausted its restart policy and stopped
   * restarting the daemon (#439). Cleared on the next successful connect.
   */
  sidecarGaveUp: boolean;
  /** Reason string from the sidecar give-up broadcast, if any. */
  sidecarGaveUpReason: string | null;
  /**
   * True when the app is in sidecar posture but the spawn could not happen at
   * all (binary not found, spawn error) — latched from the backend:status
   * `sidecarStartupFailed` extra. Cleared on the next successful connect.
   */
  sidecarStartupFailed: boolean;
  /** Reason string from the sidecar startup-failure broadcast, if any. */
  sidecarStartupFailedReason: string | null;
  /**
   * True once a successful connect has landed at any point since app launch.
   * Session-scoped latch (never cleared) so the daemon-loss UI can
   * distinguish "never connected since launch" from "connection lost".
   */
  hasEverConnected: boolean;
  /**
   * True while an on-demand sidecar spawn (backend:spawn-sidecar) is pending —
   * from the user's request until the daemon reconnects or the spawn fails.
   */
  sidecarSpawnPending: boolean;
  /** Error string when the last on-demand sidecar spawn failed. */
  sidecarSpawnError: string | null;
}

/**
 * backend:get-sidecar-run-log response — renderer-safe capture of the most
 * recent sidecar run for this app session (no env values).
 */
export interface SidecarRunLog {
  /** False when no sidecar run has ever been captured. */
  available: boolean;
  /** ISO timestamp of the most recent spawn, or null. */
  startedAt: string | null;
  /** ISO timestamp when the run ended; null while running. */
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  /** Spawn-level failure, e.g. "intentd binary not found". */
  spawnError: string | null;
  /** Tail of combined stdout+stderr, capped (e.g. last 400 lines). */
  lines: string[];
}
