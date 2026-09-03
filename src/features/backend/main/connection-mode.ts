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
  /** Source commit reported by the adopted daemon, when its build embeds one. */
  daemonBuildCommit?: string | null;
  pinnedVersion: string | null;
  versionMismatch: boolean;
}

/**
 * Identity of an adopted daemon classified as an ORPHANED SIDECAR (#2444):
 * a live daemon whose executable resolves inside the running app's own
 * bundle — a leftover from a crashed/force-quit prior app session, not a
 * genuinely external daemon. Recorded during `startIntentdSidecar` alongside
 * the `external` mode; consumed by the transport payload (renderer offer)
 * and the kill-and-restart recovery handler.
 */
export interface OrphanedSidecarState {
  /** Pid from the daemon's pidfile (verified alive at detection time). */
  pid: number;
  /** The orphan's executable path (inside our resources). */
  executablePath: string;
}

let connectionMode: ConnectionMode = 'unknown';
let daemonVersionInfo: DaemonVersionInfo | null = null;
let orphanedSidecarInfo: OrphanedSidecarState | null = null;
let localUpdateSupported: boolean | null = null;
let localExactVersionUpdateSupported: boolean | null = null;

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

/** Orphaned-sidecar classification for the adopted daemon, or null (#2444). */
export function getOrphanedSidecarInfo(): OrphanedSidecarState | null {
  return orphanedSidecarInfo;
}

/** Record (or clear) the orphaned-sidecar classification (sidecar manager / recovery). */
export function setOrphanedSidecarInfo(info: OrphanedSidecarState | null): void {
  orphanedSidecarInfo = info;
}

/**
 * Whether the adopted external local daemon reports self-update support
 * (`updateSupported` from its `system.status`), captured after each local
 * hello. `null` = unknown (capture pending, a daemon too old to report the
 * field, or sidecar/unresolved mode). Never persisted — the local connection
 * entry stays synthesized-only.
 */
export function getLocalUpdateSupported(): boolean | null {
  return localUpdateSupported;
}

/** Record (or clear) the local external daemon's updateSupported capture. */
export function setLocalUpdateSupported(supported: boolean | null): void {
  localUpdateSupported = supported;
}

/** Live exact-version capability of the adopted local daemon and its sitter. */
export function getLocalExactVersionUpdateSupported(): boolean | null {
  return localExactVersionUpdateSupported;
}

export function setLocalExactVersionUpdateSupported(supported: boolean | null): void {
  localExactVersionUpdateSupported = supported;
}

/**
 * Test seam: reset module state for testing.
 * @internal
 */
export function __resetConnectionModeForTesting(): void {
  connectionMode = 'unknown';
  daemonVersionInfo = null;
  orphanedSidecarInfo = null;
  localUpdateSupported = null;
  localExactVersionUpdateSupported = null;
}
