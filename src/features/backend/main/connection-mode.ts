/**
 * Connection-mode state: whether the daemon the FE talks to is our spawned
 * sidecar or an external daemon we merely connect to.
 *
 * Resolved once during `startIntentdSidecar` (see `intentd-sidecar.ts`):
 *   - `sidecar`  → we spawned (and supervise) the daemon.
 *   - `external` → we connect to a daemon we do not manage (adopted an
 *     already-running daemon on the UDS socket, an env transport override, or
 *     the two-terminal dev flow).
 *   - `unknown`  → not resolved yet (before startup, or startup could not
 *     determine a posture).
 *
 * Keep this module dependency-light (no logger, no side effects) so it can be
 * imported from anywhere in the main process without pulling in the sidecar
 * manager's process-lifecycle state.
 */

/** FE↔daemon connection mode. */
export type ConnectionMode = 'sidecar' | 'external' | 'unknown';

/**
 * Version handshake outcome for an adopted external daemon: the version the
 * daemon reported, the `intentd.version` pin, and whether they differ.
 * Recorded during `startIntentdSidecar` alongside the `external` mode so the
 * transport payload (backend:status / backend:get-status) can surface a
 * non-blocking version-mismatch notice in the renderer.
 */
export interface DaemonVersionInfo {
  daemonVersion: string | null;
  pinnedVersion: string | null;
  versionMismatch: boolean;
}

let connectionMode: ConnectionMode = 'unknown';
let daemonVersionInfo: DaemonVersionInfo | null = null;

/** Current connection mode (resolved during `startIntentdSidecar`). */
export function getConnectionMode(): ConnectionMode {
  return connectionMode;
}

/** Set the connection mode (called by the sidecar manager during startup). */
export function setConnectionMode(mode: ConnectionMode): void {
  connectionMode = mode;
}

/** Version info for the adopted external daemon, or null (sidecar/unresolved). */
export function getDaemonVersionInfo(): DaemonVersionInfo | null {
  return daemonVersionInfo;
}

/** Record the adoption version handshake outcome (sidecar manager, startup). */
export function setDaemonVersionInfo(info: DaemonVersionInfo | null): void {
  daemonVersionInfo = info;
}

/**
 * Test seam: reset module state for testing.
 * @internal
 */
export function __resetConnectionModeForTesting(): void {
  connectionMode = 'unknown';
  daemonVersionInfo = null;
}
