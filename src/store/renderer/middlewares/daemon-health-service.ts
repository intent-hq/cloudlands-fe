/**
 * Daemon health service — middleware that bridges backend connection events
 * and periodic system.status polling into the daemon-health Redux slice.
 *
 * Sources:
 * - Main-process connection status: backend:status push events (ConnectionStatus: 'connecting' | 'connected' | 'disconnected').
 * - Periodic system.status polls for stats (clients, agents, maxAgents, listenMode, version, uptimeSeconds, etc.).
 *
 * The middleware auto-starts polling when the first action dispatches (boot-time
 * hydration) and listens to backend:status to transition health state.
 */

import type { StoreMiddleware } from '$lib/store-shim/types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  connectionStatusChanged,
  pollSystemStatus,
  systemStatusSuccess,
  systemStatusFailure,
  heartbeatFailed,
  spawnSidecarRequested,
  spawnSidecarFailed,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  fetchSidecarRunLogFailed,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type {
  BackendTransportInfo,
  SidecarRunLog,
  SystemStatusWirePayload,
} from '$store/renderer/slices/daemon-health/daemon-health-types';

const BACKEND = IPC_CHANNELS.BACKEND;

/** Poll interval for system.status while idle (10s). */
const POLL_INTERVAL_MS = 10_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let statusListener: ((payload: { status: string }) => void) | null = null;
let booted = false;
let pollInFlight = false;
// One-shot latch: the version-mismatch toast fires at most once per boot.
let versionMismatchNotified = false;
// Bumped on dispose so a poll that resolves after a dispose(+reboot) cycle
// cannot clear the in-flight flag or dispatch stale results.
let pollGeneration = 0;

/**
 * Poll system.status and dispatch success/failure.
 * Guards against overlapping in-flight polls (e.g. rapid pollSystemStatus dispatches).
 */
async function pollStatus(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  const generation = pollGeneration;
  try {
    const result = await backendRequest<SystemStatusWirePayload>('system.status');
    if (generation !== pollGeneration) return;
    appStore.dispatch(systemStatusSuccess(result));
  } catch (_error) {
    if (generation !== pollGeneration) return;
    // Poll failure — heartbeat/health-check failure while connected, or connection already down.
    // Dispatch failure action and, if we're still supposedly connected, also dispatch heartbeatFailed.
    //
    // V1 degraded-state derivation: we infer 'degraded' from a system.status poll failure while
    // the connection status is 'connected'. This is correct: the poll IS the application-level
    // health check. The main-process JSON-RPC client tears down the UDS socket on transport-level
    // heartbeat timeout, which lands us in the 'down' state via the backend:status disconnected event.
    // A poll failure while connected therefore means the daemon is reachable but slow/degraded.
    appStore.dispatch(systemStatusFailure());
    // Check current health state: if 'healthy', the poll failure is the first sign of degradation.
    const currentHealth = appStore.state.daemonHealth.health;
    if (currentHealth === 'healthy') {
      appStore.dispatch(heartbeatFailed());
    }
  } finally {
    if (generation === pollGeneration) {
      pollInFlight = false;
    }
  }
}

/**
 * Start periodic polling (idempotent).
 * Polls are routed through the pollSystemStatus action so the reducer's polling
 * flag and the middleware's poll trigger stay in sync.
 */
function startPolling(): void {
  if (pollTimer) return;
  // Immediate poll on start, then periodic.
  // Note: boot() runs inside the middleware before next(action), so this first
  // dispatch is re-entrant on the very first action. The store shim processes
  // nested dispatches synchronously, which is safe today — revisit if the shim's
  // dispatch semantics change.
  appStore.dispatch(pollSystemStatus());
  pollTimer = setInterval(() => {
    appStore.dispatch(pollSystemStatus());
  }, POLL_INTERVAL_MS);
}

/**
 * Stop periodic polling (idempotent).
 */
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Surface a one-time, dismissible, non-blocking notice when the main process
 * adopted an external daemon whose version differs from the bundled
 * intentd.version pin (warn-only — never blocks). The toast lib is imported
 * lazily to keep this middleware dependency-light.
 */
function maybeNotifyVersionMismatch(transport?: BackendTransportInfo): void {
  if (!transport?.versionMismatch || versionMismatchNotified) return;
  versionMismatchNotified = true;
  void import('$lib/components/ui/toast')
    .then(({ toast }) => {
      // The daemon may report its version with or without a leading "v"
      // (compareToPinnedVersion tolerates both) — normalize to avoid "vv".
      const daemonVersion = transport.daemonVersion
        ? ` (v${transport.daemonVersion.replace(/^v/, '')})`
        : '';
      toast.warning(
        `Connected to an external intentd daemon${daemonVersion} whose version differs from the bundled version. Some features may not work as expected.`,
        { duration: 15_000 },
      );
    })
    .catch(() => {
      // Toast not available yet (e.g. during initial load) — un-latch so a
      // later status event retries instead of losing the warning for the
      // whole session. The mismatch is still logged in the main process.
      versionMismatchNotified = false;
    });
}

/**
 * Invoke backend:spawn-sidecar (#439 fallback). On failure, dispatch
 * spawnSidecarFailed so the daemon-loss UI surfaces the error; on success the
 * pending flag clears when the reconnect lands as a 'connected' status event.
 */
async function spawnSidecar(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) {
    appStore.dispatch(spawnSidecarFailed('electronAPI is not available'));
    return;
  }
  try {
    const result = (await api.invoke(BACKEND.SPAWN_SIDECAR)) as
      | { ok: boolean; spawned: boolean; reason?: string; error?: { message?: string } }
      | undefined;
    if (!result?.ok) {
      appStore.dispatch(
        spawnSidecarFailed(result?.error?.message ?? result?.reason ?? 'Failed to spawn sidecar'),
      );
    }
  } catch (error) {
    appStore.dispatch(spawnSidecarFailed(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Invoke backend:get-sidecar-run-log (main-process in-memory per-run capture)
 * and dispatch the contract-shaped payload or the failure into the slice.
 */
async function fetchSidecarRunLog(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) {
    appStore.dispatch(fetchSidecarRunLogFailed('electronAPI is not available'));
    return;
  }
  try {
    const log = (await api.invoke(BACKEND.GET_SIDECAR_RUN_LOG)) as SidecarRunLog;
    appStore.dispatch(fetchSidecarRunLogSucceeded(log));
  } catch (error) {
    appStore.dispatch(
      fetchSidecarRunLogFailed(error instanceof Error ? error.message : String(error)),
    );
  }
}

/**
 * Boot-time setup: listen to backend:status and start polling.
 */
function boot(): void {
  if (booted) return;
  booted = true;

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return;

  // Listen for backend:status events (connection status changes).
  // Disconnect broadcasts may additionally carry sidecarGaveUp /
  // sidecarStartupFailed / reason (#439).
  statusListener = (payload: {
    status: string;
    transport?: BackendTransportInfo;
    sidecarGaveUp?: boolean;
    sidecarStartupFailed?: boolean;
    reason?: string;
  }) => {
    appStore.dispatch(
      connectionStatusChanged(payload.status, payload.transport, {
        sidecarGaveUp: payload.sidecarGaveUp,
        sidecarStartupFailed: payload.sidecarStartupFailed,
        reason: payload.reason,
      }),
    );
    maybeNotifyVersionMismatch(payload.transport);
  };
  api.on(BACKEND.STATUS, statusListener);

  // Fetch initial connection status. Boot-time sidecar startup failures fire
  // before this renderer exists, so the broadcast alone is lossy — the main
  // process latches the failure and exposes it on the get-status response
  // (spec addendum), making delivery ordering-independent.
  void api
    .invoke(BACKEND.GET_STATUS)
    .then(
      (result: {
        status: string;
        transport?: BackendTransportInfo;
        sidecarStartupFailed?: boolean;
        sidecarStartupFailedReason?: string;
      }) => {
        appStore.dispatch(
          connectionStatusChanged(result.status, result.transport, {
            sidecarStartupFailed: result.sidecarStartupFailed,
            reason: result.sidecarStartupFailedReason,
          }),
        );
        maybeNotifyVersionMismatch(result.transport);
      },
    )
    .catch(() => {
      // Bridge not ready yet — status events + polling converge the state.
    });

  // Start polling.
  startPolling();
}

/**
 * Middleware that boots on the first action and routes pollSystemStatus triggers.
 */
export function createDaemonHealthMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!booted) boot();
    const result = next(action);
    // React to pollSystemStatus (from the interval or e.g. the status dropdown)
    // with an immediate poll; pollStatus() guards against overlapping polls.
    if (action.type === pollSystemStatus.type) {
      void pollStatus();
    }
    // User asked for the sidecar fallback from the daemon-loss UI (#439).
    if (action.type === spawnSidecarRequested.type) {
      void spawnSidecar();
    }
    // User asked for the last-run sidecar log from the daemon-loss dialog.
    if (action.type === fetchSidecarRunLogRequested.type) {
      void fetchSidecarRunLog();
    }
    return result;
  };
}

/**
 * Cleanup for tests (stop polling + remove listener).
 */
export function disposeDaemonHealthService(): void {
  stopPolling();
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api && statusListener) {
    api.off(BACKEND.STATUS, statusListener);
    statusListener = null;
  }
  booted = false;
  versionMismatchNotified = false;
  // Invalidate any in-flight poll so its late resolution can't dispatch stale
  // results or clear the flag for a rebooted service.
  pollGeneration++;
  pollInFlight = false;
}
