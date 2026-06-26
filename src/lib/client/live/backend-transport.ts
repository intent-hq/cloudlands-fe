/**
 * Renderer-side wrapper around the main-process JSON-RPC bridge.
 *
 * The renderer cannot open a UDS socket, so it reaches the intentd daemon through
 * the `backend:*` IPC channels exposed by the preload bridge. This module is the
 * single place that talks to `window.electronAPI` for the live transport; the
 * LiveAppClient domains build on top of it.
 *
 * Note: this intentionally uses the real `window.electronAPI` (not the mock IPC
 * router used by `$lib/electron-bridge`), since migrated domains must reach the
 * live main-process client.
 */
import { IPC_CHANNELS } from "$shared/ipc-registry";

const BACKEND = IPC_CHANNELS.BACKEND;

/** Serializable error payload returned by the main-process bridge. */
export interface BackendErrorPayload {
  code: string;
  message: string;
  data?: unknown;
}

interface BackendResult<T> {
  ok: boolean;
  result?: T;
  error?: BackendErrorPayload;
}

/** Error thrown when a backend request fails, preserving the daemon string code. */
export class BackendError extends Error {
  readonly code: string;
  readonly data: unknown;
  constructor(payload: BackendErrorPayload) {
    super(payload.message);
    this.name = "BackendError";
    this.code = payload.code;
    this.data = payload.data;
  }
}

function electronAPI(): Window["electronAPI"] | undefined {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

/** Whether the live backend bridge is reachable in this environment. */
export function isBackendAvailable(): boolean {
  return !!electronAPI();
}

function unwrap<T>(response: BackendResult<T> | undefined): T {
  if (!response || !response.ok) {
    throw new BackendError(
      response?.error ?? { code: "TRANSPORT_ERROR", message: "Backend request failed" },
    );
  }
  return response.result as T;
}

/** Forward a JSON-RPC request to the daemon via the main process. */
export async function backendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
  const api = electronAPI();
  if (!api) throw new BackendError({ code: "UNAVAILABLE", message: "Backend bridge unavailable" });
  const response = (await api.invoke(BACKEND.REQUEST, { method, params })) as BackendResult<T>;
  return unwrap(response);
}

/** Subscribe to daemon events (`events.subscribe`). Returns its raw result. */
export async function backendSubscribe<T = { subscriptionId?: string }>(
  params: unknown,
): Promise<T> {
  const api = electronAPI();
  if (!api) throw new BackendError({ code: "UNAVAILABLE", message: "Backend bridge unavailable" });
  const response = (await api.invoke(BACKEND.SUBSCRIBE, params)) as BackendResult<T>;
  return unwrap(response);
}

/** Unsubscribe from daemon events (`events.unsubscribe`). Best-effort. */
export async function backendUnsubscribe(subscriptionId: string): Promise<void> {
  const api = electronAPI();
  if (!api) return;
  try {
    await api.invoke(BACKEND.UNSUBSCRIBE, { subscriptionId });
  } catch {
    // Unsubscribe is best-effort; ignore transport errors on teardown.
  }
}

/** Daemon JSON-RPC notification forwarded from the main process. */
export interface BackendNotification {
  method: string;
  params?: unknown;
}

/** Listen for daemon notifications. Returns a disposer. */
export function onBackendNotification(handler: (n: BackendNotification) => void): () => void {
  const api = electronAPI();
  if (!api) return () => {};
  const listenerId = api.on(BACKEND.NOTIFICATION, (payload: BackendNotification) =>
    handler(payload),
  );
  return () => api.offById(BACKEND.NOTIFICATION, listenerId);
}
