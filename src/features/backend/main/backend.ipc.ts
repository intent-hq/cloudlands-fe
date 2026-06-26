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
 * Daemon JSON-RPC notifications are broadcast to every window on
 * `backend:notification`; connection-status changes on `backend:status`.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { JsonRpcError } from './json-rpc-errors';
import {
  JsonRpcClient,
  type ConnectionStatus,
  type JsonRpcNotification,
} from './json-rpc-client';

const logger = new Logger('Backend-IPC');
const BACKEND = IPC_CHANNELS.BACKEND;

let client: JsonRpcClient | null = null;
let handlersRegistered = false;

/** Lazily create, wire, and start the shared main-process JSON-RPC client. */
export function getBackendClient(): JsonRpcClient {
  if (client) return client;
  const instance = new JsonRpcClient();
  instance.on('notification', (notification: JsonRpcNotification) =>
    broadcast(BACKEND.NOTIFICATION, notification),
  );
  instance.on('status', (status: ConnectionStatus) => broadcast(BACKEND.STATUS, { status }));
  instance.on('error', (error: Error) =>
    logger.warn('Backend transport error', { error: error.message }),
  );
  client = instance;
  instance.start();
  return instance;
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
function toErrorPayload(error: unknown): { code: string; message: string; data: unknown } {
  if (error instanceof JsonRpcError) return error.toErrorPayload();
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'TRANSPORT_ERROR', message, data: { code: 'TRANSPORT_ERROR' } };
}

/** Register the backend bridge IPC handlers (idempotent). */
export function registerBackendHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(BACKEND.REQUEST, async (_event, payload: { method?: string; params?: unknown }) => {
    const method = payload?.method;
    if (typeof method !== 'string' || method.length === 0) {
      return { ok: false, error: { code: 'INVALID_PARAMS', message: 'method is required' } };
    }
    try {
      const result = await getBackendClient().request(method, payload?.params);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  });

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

  ipcMain.handle(BACKEND.GET_STATUS, async () => ({ status: getBackendClient().getStatus() }));

  logger.info('Backend bridge IPC handlers registered');
}

/** Dispose the shared client (used on shutdown). */
export function disposeBackendClient(): void {
  client?.dispose();
  client = null;
}
