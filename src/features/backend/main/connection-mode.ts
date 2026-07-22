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

let connectionMode: ConnectionMode = 'unknown';

/** Current connection mode (resolved during `startIntentdSidecar`). */
export function getConnectionMode(): ConnectionMode {
  return connectionMode;
}

/** Set the connection mode (called by the sidecar manager during startup). */
export function setConnectionMode(mode: ConnectionMode): void {
  connectionMode = mode;
}

/**
 * Test seam: reset module state for testing.
 * @internal
 */
export function __resetConnectionModeForTesting(): void {
  connectionMode = 'unknown';
}
