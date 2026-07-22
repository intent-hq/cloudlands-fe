/**
 * Electron-IPC implementation of the `BackendTransport` interface.
 *
 * The renderer cannot open a UDS socket, so it reaches the intentd daemon
 * through the `backend:*` IPC channels exposed by the preload bridge; the
 * main-process JSON-RPC client (`backend.ipc.ts`) does the actual socket work.
 *
 * Note: this intentionally uses the real `window.electronAPI` (not the mock
 * IPC router used by `$lib/electron-bridge`), since migrated domains must
 * reach the live main-process client.
 */
import { IPC_CHANNELS } from "$shared/ipc-registry";
import {
  BackendError,
  type BackendErrorPayload,
  type BackendNotification,
  type BackendRequestOptions,
  type BackendTransport,
} from "./backend-transport-types";

const BACKEND = IPC_CHANNELS.BACKEND;

interface BackendResult<T> {
  ok: boolean;
  result?: T;
  error?: BackendErrorPayload;
}

export function electronAPI(): Window["electronAPI"] | undefined {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

function unwrap<T>(response: BackendResult<T> | undefined): T {
  if (!response || !response.ok) {
    throw new BackendError(
      response?.error ?? { code: "TRANSPORT_ERROR", message: "Backend request failed" },
    );
  }
  return response.result as T;
}

/**
 * Create the Electron-IPC transport. The preload bridge is re-checked on
 * every call (rather than captured at construction) so availability tracks
 * the live `window.electronAPI` state, matching the legacy module behavior.
 */
export function createElectronIpcBackendTransport(): BackendTransport {
  return {
    isAvailable(): boolean {
      return !!electronAPI();
    },

    async request<T = unknown>(
      method: string,
      params?: unknown,
      options?: BackendRequestOptions,
    ): Promise<T> {
      const api = electronAPI();
      if (!api)
        throw new BackendError({ code: "UNAVAILABLE", message: "Backend bridge unavailable" });
      const invokePayload: { method: string; params?: unknown; timeoutMs?: number } = {
        method,
        params,
      };
      if (options?.timeoutMs !== undefined) invokePayload.timeoutMs = options.timeoutMs;
      const response = (await api.invoke(BACKEND.REQUEST, invokePayload)) as BackendResult<T>;
      return unwrap(response);
    },

    async subscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T> {
      const api = electronAPI();
      if (!api)
        throw new BackendError({ code: "UNAVAILABLE", message: "Backend bridge unavailable" });
      const response = (await api.invoke(BACKEND.SUBSCRIBE, params)) as BackendResult<T>;
      return unwrap(response);
    },

    async unsubscribe(subscriptionId: string): Promise<void> {
      const api = electronAPI();
      if (!api) return;
      try {
        await api.invoke(BACKEND.UNSUBSCRIBE, { subscriptionId });
      } catch {
        // Unsubscribe is best-effort; ignore transport errors on teardown.
      }
    },

    onNotification(handler: (notification: BackendNotification) => void): () => void {
      const api = electronAPI();
      if (!api) return () => {};
      const listenerId = api.on(BACKEND.NOTIFICATION, (payload: BackendNotification) =>
        handler(payload),
      );
      return () => api.offById(BACKEND.NOTIFICATION, listenerId);
    },

    /**
     * Fires when the main-process JSON-RPC client re-establishes the socket
     * after a drop (`{ status: 'connected', reconnected: true }` marker
     * broadcast by `backend.ipc.ts`).
     */
    onReconnected(handler: () => void): () => void {
      const api = electronAPI();
      if (!api) return () => {};
      const listenerId = api.on(
        BACKEND.STATUS,
        (payload: { status?: string; reconnected?: boolean } | undefined) => {
          if (payload?.status === "connected" && payload.reconnected === true) handler();
        },
      );
      return () => api.offById(BACKEND.STATUS, listenerId);
    },
  };
}
