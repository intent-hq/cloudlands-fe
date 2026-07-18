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

import type { StoreMiddleware } from '@augmentcode/ag-redux-toolkit/types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  connectionStatusChanged,
  pollSystemStatus,
  systemStatusSuccess,
  systemStatusFailure,
  heartbeatFailed,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { SystemStatusWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';

const BACKEND = IPC_CHANNELS.BACKEND;

/** Poll interval for system.status while idle (10s). */
const POLL_INTERVAL_MS = 10_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let statusListener: ((payload: { status: string }) => void) | null = null;
let booted = false;

/**
 * Poll system.status and dispatch success/failure.
 */
async function pollStatus(): Promise<void> {
  appStore.dispatch(pollSystemStatus());
  try {
    const result = await backendRequest<SystemStatusWirePayload>('system.status');
    appStore.dispatch(systemStatusSuccess(result));
  } catch (_error) {
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
  }
}

/**
 * Start periodic polling (idempotent).
 */
function startPolling(): void {
  if (pollTimer) return;
  // Immediate poll on start, then periodic.
  void pollStatus();
  pollTimer = setInterval(() => {
    void pollStatus();
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
 * Boot-time setup: listen to backend:status and start polling.
 */
function boot(): void {
  if (booted) return;
  booted = true;

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return;

  // Listen for backend:status events (connection status changes).
  statusListener = (payload: { status: string }) => {
    appStore.dispatch(connectionStatusChanged(payload.status));
  };
  api.on(BACKEND.STATUS, statusListener);

  // Fetch initial connection status.
  void api.invoke(BACKEND.GET_STATUS).then((result: { status: string }) => {
    appStore.dispatch(connectionStatusChanged(result.status));
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
    // pollSystemStatus is already handled by the boot-time interval; no per-action routing needed.
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
}
