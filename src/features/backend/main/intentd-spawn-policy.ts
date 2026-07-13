/**
 * Sidecar spawn-policy: the single source of truth for whether the Electron
 * main process should spawn intentd as a sidecar, and why.
 *
 * Extracted from `intentd-sidecar.ts` so callers that only need the decision
 * (e.g. `backend-connection.ts` picking a transport) don't pull in the sidecar
 * manager's process-lifecycle state (logger, child process handle, timers).
 * Keep this file dependency-light and free of side effects.
 */

/** Spawn-policy decision result. */
export interface ShouldSpawnDecision {
  shouldSpawn: boolean;
  reason: string;
}

/**
 * Decide whether to spawn the sidecar daemon.
 *
 * Returns `shouldSpawn: false` when:
 *   - `INTENTD_SIDECAR=0` (explicit disable)
 *   - Any transport override is set (`INTENTD_SOCKET`, `INTENTD_WS_URL`, `INTENTD_TCP`)
 *   - Dev build without `INTENTD_SIDECAR=1`
 *
 * Pure function for testability.
 */
export function shouldSpawnSidecar(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): ShouldSpawnDecision {
  const sidecarEnv = env.INTENTD_SIDECAR?.trim();
  if (sidecarEnv === '0') {
    return { shouldSpawn: false, reason: 'INTENTD_SIDECAR=0 disables spawning' };
  }
  if (env.INTENTD_SOCKET?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_SOCKET override disables spawning' };
  }
  if (env.INTENTD_WS_URL?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_WS_URL override disables spawning' };
  }
  if (env.INTENTD_TCP?.trim()) {
    return { shouldSpawn: false, reason: 'INTENTD_TCP override disables spawning' };
  }
  if (!isPackaged && sidecarEnv !== '1') {
    return { shouldSpawn: false, reason: 'dev build requires INTENTD_SIDECAR=1' };
  }
  return { shouldSpawn: true, reason: isPackaged ? 'packaged build' : 'INTENTD_SIDECAR=1' };
}
