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
  /**
   * Raw numeric JSON-RPC code from the daemon, threaded through so the renderer
   * can detect the optimistic-concurrency conflict (`-32005`) precisely (§11.4-D).
   * Absent for non-JSON-RPC transport failures.
   */
  rpcCode?: number;
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
  readonly rpcCode?: number;
  constructor(payload: BackendErrorPayload) {
    super(payload.message);
    this.name = "BackendError";
    this.code = payload.code;
    this.data = payload.data;
    this.rpcCode = payload.rpcCode;
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

/**
 * Forward a JSON-RPC request to the daemon via the main process.
 *
 * `options.timeoutMs` overrides the shared JSON-RPC client's default request
 * timeout for a single call. Used for long-running daemon operations
 * (e.g. `git.pull`) whose own bound exceeds the flat 30s default so the
 * daemon's structured `{ok:false}` result wins over a transport timeout.
 */
export async function backendRequest<T = unknown>(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const api = electronAPI();
  if (!api) throw new BackendError({ code: "UNAVAILABLE", message: "Backend bridge unavailable" });
  const invokePayload: { method: string; params?: unknown; timeoutMs?: number } = { method, params };
  if (options?.timeoutMs !== undefined) invokePayload.timeoutMs = options.timeoutMs;
  const response = (await api.invoke(BACKEND.REQUEST, invokePayload)) as BackendResult<T>;
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

/**
 * Server capabilities advertised in the `client.hello` handshake. Confirmed on
 * the wire that the daemon nests these inside the `server` block, i.e. the live
 * flag lives at `result.server.capabilities.liveState` (NOT a top-level
 * `capabilities`). The full server block is `{locality, hasDisplay, osArch,
 * version, capabilities}`.
 */
export interface ServerCapabilities {
  liveState?: boolean;
}

let liveStateCapabilityPromise: Promise<boolean> | null = null;

/**
 * Resolve whether the connected daemon advertises snapshot/delta live-state via
 * `client.hello` (`server.capabilities.liveState === true`) — the PRIMARY,
 * up-front live-state signal. Cached for the process so the handshake runs once
 * and is shared across all subscriptions. Resolves `false` on any error so
 * callers fall back to runtime first-push detection (the safety net is never
 * regressed when the flag is absent or hello fails).
 */
export function detectLiveStateCapability(): Promise<boolean> {
  if (!liveStateCapabilityPromise) {
    liveStateCapabilityPromise = backendRequest<{
      server?: { capabilities?: ServerCapabilities };
    }>("client.hello", {})
      .then((result) => result?.server?.capabilities?.liveState === true)
      .catch(() => false);
  }
  return liveStateCapabilityPromise;
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

/**
 * Listen for backend reconnects. Fires when the main-process JSON-RPC client
 * re-establishes the socket after a drop (`{ status: 'connected', reconnected:
 * true }` marker broadcast by `backend.ipc.ts`). Renderer consumers that hold
 * long-lived `events.subscribe` subscriptions or hydrated state derived from
 * daemon events must re-issue their subscribes and, where appropriate, refresh
 * coarse state so anything missed during the outage converges (RESUB-1).
 * Returns a disposer.
 */
export function onBackendReconnected(handler: () => void): () => void {
  const api = electronAPI();
  if (!api) return () => {};
  const listenerId = api.on(
    BACKEND.STATUS,
    (payload: { status?: string; reconnected?: boolean } | undefined) => {
      if (payload?.status === "connected" && payload.reconnected === true) handler();
    },
  );
  return () => api.offById(BACKEND.STATUS, listenerId);
}

