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
}
