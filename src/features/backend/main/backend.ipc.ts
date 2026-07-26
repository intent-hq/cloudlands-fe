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
import { app, BrowserWindow, ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { resolveBackendConfig } from './backend-connection';
import {
  JsonRpcClient,
  type ConnectionStatus,
  type JsonRpcNotification,
} from './json-rpc-client';
import { JsonRpcError } from './json-rpc-errors';
import { getOrCreateClientId, persistClientId } from './client-identity';
import { formatTransportInfo } from './transport-info';
import {
  getSidecarRunLog,
  onSidecarGaveUp,
  onSidecarStartupFailed,
  spawnSidecarOnDemand,
} from './intentd-sidecar';
import { registerBrowserExecReverseHandler } from '../../browser/main/browser-exec-reverse';

const logger = new Logger('Backend-IPC');
const BACKEND = IPC_CHANNELS.BACKEND;

let client: JsonRpcClient | null = null;
let handlersRegistered = false;

/** Liveness heartbeat interval; reconnect-on-close cannot detect half-open sockets. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Lazily create, wire, and start the shared main-process JSON-RPC client. */
export function getBackendClient(): JsonRpcClient {
  if (client) return client;
  // Dev (unpackaged) builds default to the loopback WebSocket transport; the
  // packaged app stays on UDS. Env overrides (`INTENTD_SOCKET`, `INTENTD_WS_URL`)
  // win either way — see `resolveBackendConfig`.
  const isDev = !app.isPackaged;
  const instance = new JsonRpcClient({
    config: resolveBackendConfig(process.env, { isDev }),
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
  instance.on('notification', (notification: JsonRpcNotification) =>
    broadcast(BACKEND.NOTIFICATION, notification),
  );
  instance.on('status', (status: ConnectionStatus) => {
    const transport = formatTransportInfo(instance.getConfig());
    broadcast(BACKEND.STATUS, { status, transport });
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
  });
  instance.on('error', (error: Error) =>
    logger.warn('Backend transport error', { error: error.message }),
  );
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
 * shared JsonRpcClient re-establishes the connection after a drop so consumers
 * that hold long-lived `events.subscribe` subscriptions (terminal registry,
 * script manager, ACP terminal handler) can re-issue them. Returns a disposer.
 */
export function onBackendReconnected(handler: () => void): () => void {
  const instance = getBackendClient();
  instance.on('reconnected', handler);
  return () => instance.off('reconnected', handler);
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

  logger.info('Backend bridge IPC handlers registered');
}

/** Dispose the shared client (used on shutdown). */
export function disposeBackendClient(): void {
  client?.dispose();
  client = null;
}
