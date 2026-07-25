/**
 * Renderer-side entry point for the live backend transport.
 *
 * These module-level functions are the stable seam the LiveAppClient domains
 * build on. They delegate to the environment's `BackendTransport`
 * implementation selected by `backend-transport-factory.ts` — Electron IPC
 * (`electron-ipc-transport.ts`) when `window.electronAPI` exists. See
 * `backend-transport-types.ts` for the transport interface.
 */
import { resolveBackendTransport } from "./backend-transport-factory";
import type { BackendNotification } from "./backend-transport-types";

export type {
  BackendErrorPayload,
  BackendNotification,
  BackendRequestOptions,
  BackendTransport,
} from "./backend-transport-types";
export { BackendError } from "./backend-transport-types";
export { electronAPI } from "./electron-ipc-transport";

/** Whether the live backend bridge is reachable in this environment. */
export function isBackendAvailable(): boolean {
  return resolveBackendTransport().isAvailable();
}

/**
 * Forward a JSON-RPC request to the daemon.
 *
 * `options.timeoutMs` overrides the transport's default request timeout for a
 * single call. Used for long-running daemon operations (e.g. `git.pull`)
 * whose own bound exceeds the flat 30s default so the daemon's structured
 * `{ok:false}` result wins over a transport timeout.
 */
export async function backendRequest<T = unknown>(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  return resolveBackendTransport().request<T>(method, params, options);
}

/** Subscribe to daemon events (`events.subscribe`). Returns its raw result. */
export async function backendSubscribe<T = { subscriptionId?: string }>(
  params: unknown,
): Promise<T> {
  return resolveBackendTransport().subscribe<T>(params);
}

/** Unsubscribe from daemon events (`events.unsubscribe`). Best-effort. */
export async function backendUnsubscribe(subscriptionId: string): Promise<void> {
  return resolveBackendTransport().unsubscribe(subscriptionId);
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
 *
 * Identity note (§5.17): the empty params here are safe — the main-process
 * JsonRpcClient merges the persisted stable `clientId` into EVERY
 * `client.hello` it forwards, so this probe re-presents the same identity
 * rather than minting a fresh one (which would orphan `drafts.*` state,
 * §5.16).
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

/** Listen for daemon notifications. Returns a disposer. */
export function onBackendNotification(handler: (n: BackendNotification) => void): () => void {
  return resolveBackendTransport().onNotification(handler);
}

/**
 * Listen for backend reconnects. Fires when the transport re-establishes its
 * daemon connection after a drop (for Electron IPC: the `{ status:
 * 'connected', reconnected: true }` marker broadcast by `backend.ipc.ts`).
 * Renderer consumers that hold long-lived `events.subscribe` subscriptions or
 * hydrated state derived from daemon events must re-issue their subscribes
 * and, where appropriate, refresh coarse state so anything missed during the
 * outage converges (RESUB-1). Returns a disposer.
 */
export function onBackendReconnected(handler: () => void): () => void {
  return resolveBackendTransport().onReconnected(handler);
}

