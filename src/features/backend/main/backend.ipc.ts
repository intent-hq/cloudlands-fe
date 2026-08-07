/**
 * IPC bridge between the renderer's LiveAppClient and the main-process
 * JSON-RPC client for the intentd daemon.
 *
 * The renderer cannot open a UDS socket, so it reaches the daemon through these
 * channels:
 *   - `backend:request`   → forward a JSON-RPC request, return `{ ok, result }`
 *                           or `{ ok: false, error: { code, message, data } }`.
 *   - `backend:subscribe` → forward `events.subscribe`, return its result.
 *   - `backend:unsubscribe` → forward `events.unsubscribe`.
 *   - `backend:get-status` → current connection status.
 *   - `backend:spawn-sidecar` → spawn the app-managed sidecar on demand (the
 *     user chose the fallback in the daemon-loss UI, #439). Probes the socket
 *     first and never spawns alongside a live daemon; concurrent calls spawn
 *     at most once. Once mode flips to `sidecar` there is no mid-session
 *     auto-switching back — the JsonRpcClient target (socket path) is
 *     unchanged, so we simply stay connected to whatever serves the socket.
 * Daemon JSON-RPC notifications are broadcast to every window on
 * `backend:notification`; connection-status changes on `backend:status`. The
 * status payload carries a `reconnected: true` marker on the successful
 * `connected` transition following an earlier drop, so renderer consumers can
 * replay `events.subscribe` calls and refresh coarse state without a relaunch
 * (RESUB-1). Main-process consumers observe the same signal directly via
 * `onBackendReconnected(handler)`.
 */
import { EventEmitter } from 'node:events';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  captureFingerprint,
  PinMismatchError,
  resolveBackendConfig,
  type BackendConnectionConfig,
} from './backend-connection';
import { JsonRpcClient, type ConnectionStatus, type JsonRpcNotification } from './json-rpc-client';
import { JsonRpcError } from './json-rpc-errors';
import { getOrCreateClientId, persistClientId } from './client-identity';
import { formatTransportInfo } from './transport-info';
import {
  getSidecarRunLog,
  getSidecarStartupFailure,
  onSidecarGaveUp,
  onSidecarStartupFailed,
  spawnSidecarOnDemand,
} from './intentd-sidecar';
import * as connectionsStore from './connections-store';
import { registerBrowserExecReverseHandler } from '../../browser/main/browser-exec-reverse';
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';
import type {
  AddConnectionResult,
  ConnectionCertMismatchEvent,
  ConnectionsChangedEvent,
  ConnectionsListResult,
  ForgetConnectionResult,
  SwitchConnectionResult,
} from '../../../shared/types/connections';
import {
  ConnectionsAddSchema,
  ConnectionsCaptureFingerprintSchema,
  ConnectionsForgetSchema,
  ConnectionsListSchema,
  ConnectionsSwitchSchema,
} from '../../../main/ipc-schemas';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';

const logger = new Logger('Backend-IPC');
const BACKEND = IPC_CHANNELS.BACKEND;
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

let client: JsonRpcClient | null = null;
let handlersRegistered = false;

/**
 * Stable/persistent reconnect forwarder (T8). Main-process services
 * (terminal registry, script-process-manager, notification.service,
 * app-settings, ACP terminal) attach their reconnect/resubscribe handlers via
 * {@link onBackendReconnected} exactly ONCE at registration time. Historically
 * those handlers were attached directly to the live JsonRpcClient instance — so
 * after a {@link switchBackend} disposed that client and built a new one, the
 * handlers were stranded on the dead client and never re-attached, and a
 * post-switch daemon reconnect would silently fail to replay their
 * subscriptions.
 *
 * The forwarder is a single long-lived emitter that outlives every client swap.
 * Each freshly constructed client's `reconnected` event is piped into it, and
 * {@link switchBackend} emits one `reconnected` through it right after building
 * the new client so registered services re-subscribe against the new target
 * (a fresh client's FIRST connect is a plain `connected`, not a `reconnected`,
 * so without this nudge the swap would not trigger a resubscribe).
 */
const backendReconnectForwarder = new EventEmitter();
// One listener per main-process service; the default cap of 10 is comfortable
// today but raise the ceiling so adding services never trips a false leak warn.
backendReconnectForwarder.setMaxListeners(50);

/**
 * Stable/persistent notification forwarder (T9). Same rationale as
 * {@link backendReconnectForwarder}, applied to the daemon `notification`
 * stream: long-lived main-process services (terminal registry,
 * script-process-manager, notification.service, app-settings, ACP terminal)
 * attach their notification listener exactly ONCE via
 * {@link onBackendNotification}. Historically each attached directly to the
 * live JsonRpcClient instance, so after a {@link switchBackend} disposed that
 * client the listener was stranded on the dead client — every daemon
 * `events.event` on the new client (terminal output/exit, script state/output,
 * `agent:idle`, `settings:changed`) was silently dropped for the rest of the
 * session. The forwarder outlives every client swap; each freshly built
 * client's `notification` event is piped into it.
 */
const backendNotificationForwarder = new EventEmitter();
backendNotificationForwarder.setMaxListeners(50);

/**
 * Stable/persistent status forwarder (T9). Mirrors
 * {@link backendNotificationForwarder} for the `status` stream that the
 * app-settings / notification.service `armStatusRetry` connect-retry hooks
 * need: a `status` listener attached to the live client would be stranded by a
 * switch, so it registers here instead and observes the new client's
 * transitions.
 */
const backendStatusForwarder = new EventEmitter();
backendStatusForwarder.setMaxListeners(50);

/**
 * Connection target for the NEXT `getBackendClient()` construction. `null`
 * means "resolve the local/env default" (startup + switch-back-to-local); a
 * non-null value is the pinned `wss` target selected by the last
 * {@link switchBackend}. The live client is always rebuilt from this after a
 * {@link disposeBackendClient}, so the active transport follows the switch.
 */
let currentConfig: BackendConnectionConfig | null = null;

/**
 * Identity of the remote connection the live client is pinned to, carried onto
 * the {@link ConnectionCertMismatchEvent} when {@link PinMismatchError} fires.
 * `null` while connected to the local sidecar (UDS has no cert to mismatch).
 */
let activeConnectionMeta: { id: string; host: string; port: number } | null = null;

/**
 * One-shot guard so a pinned-cert mismatch surfaces a single failure event per
 * client — the reconnect loop re-raises {@link PinMismatchError} on every retry
 * against an unchanged cert, but the renderer only needs one blocking modal.
 * Reset whenever a fresh client is constructed.
 */
let certMismatchNotified = false;

/**
 * Window-teardown seam for a backend switch (T4). Two split hooks, called
 * around the client swap so the outgoing backend's layout is captured while its
 * windows are still live and the incoming backend's windows only open once the
 * new client is connecting:
 *   - `captureAndClose(fromId)` — persist the outgoing backend's workspace/HUD
 *     windows under `fromId`, then destroy them all.
 *   - `restore(toId)` — restore `toId`'s saved sessions, or open a fresh window.
 * Injectable so switch-orchestration unit tests never pull in the Electron
 * window module.
 */
interface BackendWindowHooks {
  captureAndClose(fromBackendId: string): Promise<void>;
  restore(toBackendId: string): void | Promise<void>;
}
const defaultWindowHooks: BackendWindowHooks = {
  async captureAndClose(fromBackendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      captureAndCloseWindowsForBackendSwitch: (id: string) => Promise<void>;
    };
    await mod.captureAndCloseWindowsForBackendSwitch(fromBackendId);
  },
  async restore(toBackendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      restoreWindowsForBackend: (id: string) => void;
    };
    mod.restoreWindowsForBackend(toBackendId);
  },
};
let windowHooks: BackendWindowHooks = defaultWindowHooks;

/** @internal Test seam: override the window-teardown hooks. */
export function __setBackendWindowHooksForTesting(hooks: BackendWindowHooks | null): void {
  windowHooks = hooks ?? defaultWindowHooks;
}

/** Liveness heartbeat interval; reconnect-on-close cannot detect half-open sockets. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Lazily create, wire, and start the shared main-process JSON-RPC client. */
export function getBackendClient(): JsonRpcClient {
  if (client) return client;
  // A fresh client starts with a clean cert-mismatch guard.
  certMismatchNotified = false;
  // Dev (unpackaged) builds default to the loopback WebSocket transport; the
  // packaged app stays on UDS. Env overrides (`INTENTD_SOCKET`, `INTENTD_WS_URL`)
  // win either way — see `resolveBackendConfig`. After a switch to a remote
  // backend, `currentConfig` pins the `wss` target selected by `switchBackend`;
  // it is `null` for the local sidecar (startup + switch-back-to-local).
  const isDev = !app.isPackaged;
  const instance = new JsonRpcClient({
    config: currentConfig ?? resolveBackendConfig(process.env, { isDev }),
    // Enable a liveness heartbeat: reconnect-on-close alone misses a silently
    // half-open socket. `host.status` is the transport-agnostic capability
    // probe (PROTOCOL.md §5.14) — answered on BOTH UDS and WSS — so it works
    // as a heartbeat regardless of which transport `resolveBackendConfig`
    // picked. `system.status` (PROTOCOL.md §5.7) is intentionally UDS-only.
    // A transport timeout/failure trips a reconnect.
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    healthCheck: async () => {
      await instance.request('host.status');
    },
    // §5.17 stable identity: present the persisted clientId on every
    // (re)connect so daemon-side client-scoped state (`drafts.*`, §5.16)
    // survives app restarts and renderer reloads.
    helloParams: async () => ({ clientId: await getOrCreateClientId() }),
    onHelloResult: (result) => {
      const clientId =
        result && typeof result === 'object'
          ? (result as { clientId?: unknown }).clientId
          : undefined;
      if (typeof clientId === 'string' && clientId.length > 0) {
        void persistClientId(clientId);
      }
    },
  });
  instance.on('notification', (notification: JsonRpcNotification) => {
    broadcast(BACKEND.NOTIFICATION, notification);
    // Pipe the live client's notifications through the stable forwarder so
    // main-process services (attached once via onBackendNotification) keep
    // receiving daemon events regardless of how many client swaps have
    // happened since they registered. See `backendNotificationForwarder`.
    backendNotificationForwarder.emit('notification', notification);
  });
  instance.on('status', (status: ConnectionStatus) => {
    const transport = formatTransportInfo(instance.getConfig());
    broadcast(BACKEND.STATUS, { status, transport });
    // Same stable-forwarder pipe for `status`; see `backendStatusForwarder`.
    backendStatusForwarder.emit('status', status);
  });
  // On reconnect the daemon has already dropped every in-memory subscription
  // (see intentd's event-bus lifecycle); broadcast a distinct `{ status:
  // 'connected', reconnected: true }` marker AFTER the plain status event so
  // renderer consumers can replay their `events.subscribe` calls and refresh
  // coarse state. This piggybacks on the existing `backend:status` channel to
  // avoid growing the preload allow-list surface. See RESUB-1.
  instance.on('reconnected', () => {
    const transport = formatTransportInfo(instance.getConfig());
    broadcast(BACKEND.STATUS, { status: 'connected', reconnected: true, transport });
    // Pipe the live client's reconnect through the stable forwarder so
    // main-process services (attached once via onBackendReconnected) replay
    // their subscriptions — regardless of how many client swaps have happened
    // since they registered. See `backendReconnectForwarder`.
    backendReconnectForwarder.emit('reconnected');
  });
  instance.on('error', (error: Error) => {
    // A pinned-cert mismatch (PROTOCOL §1.2) is NOT a transient transport blip:
    // the remote presented a certificate whose fingerprint differs from the one
    // captured at trust-on-first-use time. Surface a single blocking failure
    // event to the renderer instead of silently reconnecting into a changed
    // cert (spec "Trust-on-first-use flow", no silent re-trust).
    if (error instanceof PinMismatchError) {
      if (!certMismatchNotified && activeConnectionMeta) {
        certMismatchNotified = true;
        const payload: ConnectionCertMismatchEvent = {
          id: activeConnectionMeta.id,
          host: activeConnectionMeta.host,
          port: activeConnectionMeta.port,
          expectedFingerprint: error.expected,
          actualFingerprint: error.actual,
        };
        broadcast(CONNECTIONS.CERT_MISMATCH, payload);
      }
      logger.warn('Backend certificate fingerprint mismatch', {
        host: activeConnectionMeta?.host,
      });
      return;
    }
    logger.warn('Backend transport error', { error: error.message });
  });
  // FE-served reverse intents (PROTOCOL §5.14). `browser.exec` is dispatched
  // from the daemon back to us and executed against the ported browser action
  // pipeline. Screenshot assets are round-tripped through `note.saveAsset` via
  // this same client so the wire payload stays small (GAP-2b).
  registerBrowserExecReverseHandler(instance, {
    saveAsset: (params) => instance.request<{ url?: string } | undefined>('note.saveAsset', params),
  });
  client = instance;
  instance.start();
  return instance;
}

/**
 * Register a main-process listener for backend reconnects. Fires each time the
 * shared JsonRpcClient re-establishes the connection after a drop — AND once
 * per {@link switchBackend} — so consumers that hold long-lived
 * `events.subscribe` subscriptions (terminal registry, script manager,
 * notification/app-settings services, ACP terminal handler) can re-issue them.
 * Returns a disposer.
 *
 * The handler is attached to the stable {@link backendReconnectForwarder}, NOT
 * to the live client instance, so it survives client swaps: a service registers
 * once and keeps replaying subscriptions against whatever client is current,
 * even across an arbitrary number of backend switches.
 */
export function onBackendReconnected(handler: () => void): () => void {
  // Ensure the shared client exists (and is wired into the forwarder) so a
  // reconnect against the current transport actually reaches this handler.
  getBackendClient();
  backendReconnectForwarder.on('reconnected', handler);
  return () => backendReconnectForwarder.off('reconnected', handler);
}

/**
 * Register a main-process listener for daemon JSON-RPC notifications
 * (`events.event` and friends). Fires for every notification on whatever client
 * is currently live. Returns a disposer.
 *
 * Like {@link onBackendReconnected}, the handler is attached to the stable
 * {@link backendNotificationForwarder}, NOT to the live client instance, so it
 * survives client swaps: a service registers once and keeps receiving daemon
 * events against whatever client is current, even across an arbitrary number of
 * backend switches.
 */
export function onBackendNotification(
  handler: (notification: JsonRpcNotification) => void,
): () => void {
  // Ensure the shared client exists (and is wired into the forwarder) so
  // notifications on the current transport actually reach this handler.
  getBackendClient();
  backendNotificationForwarder.on('notification', handler);
  return () => backendNotificationForwarder.off('notification', handler);
}

/**
 * Register a main-process listener for backend connection-status transitions
 * (the same values broadcast on `backend:status`). Fires for every status
 * change on whatever client is currently live. Returns a disposer.
 *
 * Attached to the stable {@link backendStatusForwarder}, so a connect-retry
 * `status` listener (app-settings / notification.service `armStatusRetry`)
 * survives client swaps instead of stranding on the disposed client.
 */
export function onBackendStatus(handler: (status: ConnectionStatus) => void): () => void {
  getBackendClient();
  backendStatusForwarder.on('status', handler);
  return () => backendStatusForwarder.off('status', handler);
}

/** Broadcast a payload to every live renderer window. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (error) {
      logger.warn('Failed to broadcast backend message', {
        channel,
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Normalize a thrown error into a serializable IPC error payload. */
function toErrorPayload(error: unknown): {
  code: string;
  message: string;
  data: unknown;
  rpcCode?: number;
} {
  if (error instanceof JsonRpcError) return error.toErrorPayload();
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'TRANSPORT_ERROR', message, data: { code: 'TRANSPORT_ERROR' } };
}

// ============================================================================
// Multi-backend connect: switch orchestration + connections registry IPC.
// ============================================================================

/**
 * Reconcile the persisted active connection with the live transport at boot
 * (T8). On startup the shared client is always constructed from the local/env
 * default (`currentConfig` is `null`) — but the connections store may still
 * persist `activeId = <remote>` from a prior session. Left unreconciled,
 * `connections:list` would report a remote as active while the socket is
 * actually local, and the status menu / switch UI would show a lie.
 *
 * MVP decision: reset `activeId` to {@link LOCAL_CONNECTION_ID} at boot so the
 * persisted active id agrees with the live (local) transport. We deliberately
 * do NOT auto-reconnect a stored remote at boot: the local sidecar always
 * runs, whereas a remote may be unreachable, so defaulting to local is the safe
 * choice. (Alternative considered: auto-reconnect the stored remote at boot —
 * deferred; a user can re-select the remote from the switch UI.)
 *
 * Idempotent and fail-soft: a no-op when already local, and a store write
 * failure must never block app startup.
 */
export async function reconcileActiveConnectionOnBoot(): Promise<void> {
  try {
    const activeId = await connectionsStore.getActiveId();
    if (activeId !== LOCAL_CONNECTION_ID) {
      logger.info('Resetting persisted active backend to local at boot', { was: activeId });
      await connectionsStore.setActiveId(LOCAL_CONNECTION_ID);
    }
  } catch (error) {
    logger.warn('Failed to reconcile active backend at boot', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The connections list + active selection, as surfaced to the renderer. */
async function listConnections(): Promise<ConnectionsListResult> {
  const [connections, activeId] = await Promise.all([
    connectionsStore.list(),
    connectionsStore.getActiveId(),
  ]);
  return { connections, activeId };
}

/** Broadcast the current list + active selection to every window. */
async function broadcastConnectionsChanged(): Promise<void> {
  const payload: ConnectionsChangedEvent = await listConnections();
  broadcast(CONNECTIONS.CHANGED, payload);
}

/**
 * Resolve the transport config + cert-mismatch identity for a connection id.
 * `local` maps to the env/UDS default (no pinned cert); a remote id builds the
 * pinned `wss` config from its stored host/port/fingerprint + decrypted token.
 * Throws for an unknown/incomplete connection or a missing token — the caller
 * runs this BEFORE any teardown so a bad target never disrupts the live backend.
 */
async function buildConfigForConnection(id: string): Promise<{
  config: BackendConnectionConfig;
  meta: { id: string; host: string; port: number } | null;
}> {
  if (id === LOCAL_CONNECTION_ID) {
    return { config: resolveBackendConfig(process.env, { isDev: !app.isPackaged }), meta: null };
  }
  const record = (await connectionsStore.list()).find((c) => c.id === id && !c.isLocal);
  if (!record || record.host == null || record.port == null || record.fingerprint == null) {
    throw new Error(`Unknown or incomplete connection: ${id}`);
  }
  const token = await connectionsStore.getDecryptedToken(id);
  if (!token) {
    throw new Error(`No stored token for connection: ${id}`);
  }
  return {
    config: {
      transport: 'wss',
      host: record.host,
      port: record.port,
      token,
      fingerprint: record.fingerprint,
    },
    meta: { id, host: record.host, port: record.port },
  };
}

/**
 * Switch the live backend to `id` with a clean full teardown + reload:
 *   1. Resolve+validate the target config first (throws early on a bad id/token,
 *      leaving the current backend untouched).
 *   2. **Dispose the previous client and all its subscriptions BEFORE** the new
 *      target connects — no leaked socket/timers/listeners (spec acceptance:
 *      "fully disconnects the old daemon ... before connecting the new one").
 *   3. Capture + close the outgoing backend's windows while they are still live
 *      (T4 `captureAndClose`), then flip the store's active id and build+start
 *      the new client so every `getBackendClient()` caller and the status menu
 *      see the new target.
 *   4. Restore the incoming backend's windows (T4 `restore`) — after the client
 *      swap, so restored windows reconnect to the new daemon (or open fresh).
 *   5. Broadcast the changed list/active selection.
 */
export async function switchBackend(id: string): Promise<SwitchConnectionResult> {
  const fromId = await connectionsStore.getActiveId();
  // (1) Validate + resolve BEFORE any teardown.
  const { config, meta } = await buildConfigForConnection(id);

  // (2) Capture + close the outgoing backend's windows while they're still live.
  await windowHooks.captureAndClose(fromId);

  // (3) Dispose the previous client + subscriptions before connecting the new one.
  disposeBackendClient();

  // (4) Persist the new active target and build the new client.
  await connectionsStore.setActiveId(id);
  currentConfig = meta ? config : null; // null => local/env default on next build
  activeConnectionMeta = meta;
  getBackendClient(); // constructs, wires, and starts the new client

  // The new client's first connect is a plain `connected`, not a `reconnected`,
  // so its own `reconnected` event will not fire on this initial connect. Nudge
  // the stable forwarder once here so main-process services (attached via
  // onBackendReconnected) replay their `events.subscribe` calls against the new
  // client — their requests queue until the fresh socket connects (T8).
  backendReconnectForwarder.emit('reconnected');

  // (5) Restore the incoming backend's windows (now targeting the new daemon).
  await windowHooks.restore(id);

  // (6) Notify the renderer.
  await broadcastConnectionsChanged();
  return { activeId: id };
}

/** Register the backend bridge IPC handlers (idempotent). */
export function registerBackendHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(
    BACKEND.REQUEST,
    async (_event, payload: { method?: string; params?: unknown; timeoutMs?: number }) => {
      const method = payload?.method;
      if (typeof method !== 'string' || method.length === 0) {
        return { ok: false, error: { code: 'INVALID_PARAMS', message: 'method is required' } };
      }
      // `timeoutMs` is an optional per-call override forwarded verbatim to the
      // JSON-RPC client. Long daemon operations (e.g. `git.pull`, whose own
      // bound exceeds the flat 30s default) pass a larger value so the daemon's
      // structured `{ok:false}` result wins over a transport timeout.
      const timeoutMs = typeof payload?.timeoutMs === 'number' ? payload.timeoutMs : undefined;
      try {
        const result = await getBackendClient().request(method, payload?.params, { timeoutMs });
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: toErrorPayload(error) };
      }
    },
  );

  ipcMain.handle(BACKEND.SUBSCRIBE, async (_event, params: unknown) => {
    try {
      const result = await getBackendClient().request('events.subscribe', params);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  });

  ipcMain.handle(BACKEND.UNSUBSCRIBE, async (_event, params: { subscriptionId?: string }) => {
    try {
      const result = await getBackendClient().request('events.unsubscribe', params);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  });

  ipcMain.handle(BACKEND.GET_STATUS, async () => {
    const client = getBackendClient();
    const transport = formatTransportInfo(client.getConfig());
    // Boot-time startup failures fire before this module registers its
    // `onSidecarStartupFailed` listener and before any window exists, so the
    // broadcast alone is lossy. Expose the latched failure here so the
    // renderer's boot-time get-status fetch learns about it regardless of
    // ordering (PR #402 review; spec addendum under "Pinned IPC contract").
    const startupFailure = getSidecarStartupFailure();
    if (startupFailure) {
      return {
        status: client.getStatus(),
        transport,
        sidecarStartupFailed: true as const,
        sidecarStartupFailedReason: startupFailure.reason,
      };
    }
    return { status: client.getStatus(), transport };
  });

  ipcMain.handle(BACKEND.SPAWN_SIDECAR, async () => {
    try {
      // The on-demand sidecar always binds the local UDS socket. A WS/TCP
      // client keeps reconnecting to its original target and would never
      // reach the daemon we spawned, stranding the renderer on a pending
      // spawn — refuse instead.
      const transport = getBackendClient().getConfig().transport;
      if (transport !== 'uds') {
        return {
          ok: false,
          spawned: false,
          reason: `connection target is not a local socket (transport: ${transport})`,
        };
      }
      const result = await spawnSidecarOnDemand(
        process.env,
        app.isPackaged,
        process.resourcesPath,
        process.cwd(),
      );
      if (result.ok) {
        // The daemon-loss modal resolves as soon as the spawn kicked off; the
        // JsonRpcClient's ≤5s reconnect loop picks up the socket once the
        // daemon is serving and broadcasts `backend:status` as usual.
        const client = getBackendClient();
        broadcast(BACKEND.STATUS, {
          status: client.getStatus(),
          transport: formatTransportInfo(client.getConfig()),
        });
      }
      return result;
    } catch (error) {
      return { ok: false, spawned: false, error: toErrorPayload(error) };
    }
  });

  // Per-run sidecar log capture: the renderer's daemon-loss dialog offers to
  // show the captured stdout/stderr tail from the last sidecar run. The
  // payload is renderer-safe by construction (no env values, no secrets).
  ipcMain.handle(BACKEND.GET_SIDECAR_RUN_LOG, async () => getSidecarRunLog());

  // Sidecar posture but the spawn could not happen at all (binary not found,
  // spawn error): broadcast a `sidecarStartupFailed` marker on the status
  // channel (same pattern as `sidecarGaveUp`) so the renderer says the
  // app-managed intentd failed to start instead of "connection was lost".
  onSidecarStartupFailed((reason) => {
    const instance = getBackendClient();
    broadcast(BACKEND.STATUS, {
      status: instance.getStatus(),
      sidecarStartupFailed: true,
      reason,
      transport: formatTransportInfo(instance.getConfig()),
    });
  });

  // Crash-looping sidecar: the restart policy exhausted its attempts. Reuse
  // the `backend:status` channel with a `sidecarGaveUp` marker (same pattern
  // as `reconnected`) so the renderer surfaces the daemon-loss modal instead
  // of the sidecar dying invisibly (#439).
  onSidecarGaveUp((reason) => {
    const instance = getBackendClient();
    // Report the client's ACTUAL status: in the probe→spawn TOCTOU race the
    // crash-looping child lost the socket to an external daemon the client
    // has meanwhile connected to — hardcoding 'disconnected' would flip a
    // healthy renderer to 'down' until the next poll corrected it.
    broadcast(BACKEND.STATUS, {
      status: instance.getStatus(),
      sidecarGaveUp: true,
      reason,
      transport: formatTransportInfo(instance.getConfig()),
    });
  });

  registerConnectionsHandlers();

  logger.info('Backend bridge IPC handlers registered');
}

/**
 * Register the multi-backend connections registry IPC handlers (part of
 * {@link registerBackendHandlers}). Each channel validates its params against
 * the T0 Zod schema before touching the store/transport. The bearer token
 * crosses renderer→main only at capture/add time (the user just typed it); it
 * is consumed here and never echoed onto any returned connection shape.
 */
function registerConnectionsHandlers(): void {
  // List all connections (local first, then remotes) + the active selection.
  ipcMain.handle(
    CONNECTIONS.LIST,
    createValidatedHandler(ConnectionsListSchema, async () => listConnections(), CONNECTIONS.LIST),
  );

  // Trust-on-first-use: open a `wss` connection, read the presented cert's
  // fingerprint for the user to confirm, then close. On a structured capture
  // failure (timeout / connect-failed / no-certificate) reject so the renderer
  // surfaces the reason; on success return only the fingerprint (no token).
  ipcMain.handle(
    CONNECTIONS.CAPTURE_FINGERPRINT,
    createValidatedHandler(
      ConnectionsCaptureFingerprintSchema,
      async (_event, params) => {
        const result = await captureFingerprint(params);
        if (!result.ok) {
          throw new Error(result.error);
        }
        return { fingerprint: result.fingerprint };
      },
      CONNECTIONS.CAPTURE_FINGERPRINT,
    ),
  );

  // Add a remote connection (token encrypted at rest by the store). Broadcast
  // the refreshed list so every window reflects the new entry.
  ipcMain.handle(
    CONNECTIONS.ADD,
    createValidatedHandler(
      ConnectionsAddSchema,
      async (_event, params) => {
        const connection = await connectionsStore.add(params);
        await broadcastConnectionsChanged();
        return { connection } satisfies AddConnectionResult;
      },
      CONNECTIONS.ADD,
    ),
  );

  // Forget a remote connection. If it was the live backend, fall back to a full
  // switch to local (teardown + reload) rather than stranding the FE on a
  // connection that no longer exists; otherwise just broadcast the new list.
  ipcMain.handle(
    CONNECTIONS.FORGET,
    createValidatedHandler(
      ConnectionsForgetSchema,
      async (_event, { id }) => {
        const wasActive = (await connectionsStore.getActiveId()) === id;
        await connectionsStore.forget(id); // rejects the reserved local id
        if (wasActive) {
          await switchBackend(LOCAL_CONNECTION_ID);
        } else {
          await broadcastConnectionsChanged();
        }
        return { id } satisfies ForgetConnectionResult;
      },
      CONNECTIONS.FORGET,
    ),
  );

  // Switch the live backend (full teardown + reload; see `switchBackend`).
  ipcMain.handle(
    CONNECTIONS.SWITCH,
    createValidatedHandler(
      ConnectionsSwitchSchema,
      async (_event, { id }) => switchBackend(id),
      CONNECTIONS.SWITCH,
    ),
  );
}

/** Dispose the shared client (used on shutdown). */
export function disposeBackendClient(): void {
  client?.dispose();
  client = null;
}
