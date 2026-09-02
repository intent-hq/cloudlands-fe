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
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  BackendError,
  type BackendErrorPayload,
  type BackendNotification,
  type BackendRequestOptions,
  type BackendTransport,
} from './backend-transport-types';

const BACKEND = IPC_CHANNELS.BACKEND;

interface BackendResult<T> {
  ok: boolean;
  result?: T;
  error?: BackendErrorPayload;
}

export function electronAPI(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function unwrap<T>(response: BackendResult<T> | undefined): T {
  if (!response || !response.ok) {
    throw new BackendError(
      response?.error ?? { code: 'TRANSPORT_ERROR', message: 'Backend request failed' },
    );
  }
  return response.result as T;
}

/**
 * Serialize request params to plain JSON before they cross the IPC boundary.
 *
 * `ipcRenderer.invoke` structured-clones its arguments, and structured clone
 * throws on non-cloneable values such as Svelte 5 `$state` proxies ("An
 * object could not be cloned") — e.g. a proxied state array reaching
 * `settings.update` through a component callback. Params are JSON on the
 * wire anyway (JSON-RPC to the daemon), so a JSON round-trip is lossless.
 */
function toPlainJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Fan-outs that currently hold at least one subscriber.
 *
 * `createChannelFanout` collapses N subscribers onto ONE bridge listener, so
 * the preload listener registry — the only per-channel source the renderer can
 * read — now reports at most 1 per channel however many modules subscribe.
 * That turns the IPC count into a *tripwire* (more than 1 means the fan-out
 * broke) rather than a subscriber gauge, and moves the accumulation it was
 * added to catch (intent-hq/monorepo#2034) inside the handler Set, where
 * nothing outside this module can see it. This registry is the gauge.
 *
 * Membership tracks live subscriptions, not constructed transports: a fan-out
 * joins with its first subscriber and leaves with its last, so the registry is
 * bounded by what is actually subscribed and never accumulates entries for
 * transports that have gone idle.
 */
const subscribedFanouts = new Set<{ channel: string; size: () => number }>();

/**
 * Per-channel subscriber counts across every live channel fan-out, for the
 * renderer retention fingerprint.
 *
 * Read-only and O(live channels) — one `Set.size` read per entry, nothing is
 * traversed. Channels with no subscribers are absent rather than reported as
 * 0, since a fan-out only exists in the registry while it is subscribed to.
 * Keys are sorted so the emitted fingerprint field order is stable.
 */
export function inspectChannelFanoutSubscribers(): Record<string, number> {
  const counts = new Map<string, number>();
  for (const fanout of subscribedFanouts) {
    counts.set(fanout.channel, (counts.get(fanout.channel) ?? 0) + fanout.size());
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Multiplex one preload-bridge listener for `channel` across any number of
 * subscribers.
 *
 * The bridge listener is registered lazily with the FIRST subscriber and
 * removed with the LAST one, so a channel consumed by N renderer modules costs
 * exactly one `ipcRenderer` listener instead of N. Subscribers are stored as
 * per-subscription entries (not the caller's function) so subscribing the same
 * handler twice yields two independent subscriptions, and disposers are
 * idempotent so a double-dispose cannot drop a later subscriber's listener.
 * Handler exceptions are isolated: one throwing subscriber does not stop
 * delivery to the rest.
 */
function createChannelFanout<TPayload>(channel: string, label: string) {
  const handlers = new Set<(payload: TPayload) => void>();
  let listener: { api: NonNullable<Window['electronAPI']>; id: string } | null = null;
  // Identity for `subscribedFanouts`; `size` is read there, never here.
  const registration = { channel, size: () => handlers.size };

  return {
    subscribe(
      api: NonNullable<Window['electronAPI']>,
      handler: (payload: TPayload) => void,
    ): () => void {
      if (!listener) {
        const id = api.on(channel, (payload: TPayload) => {
          for (const entry of [...handlers]) {
            try {
              entry(payload);
            } catch (error) {
              console.warn(`[electron-ipc-transport] ${label} handler threw`, error);
            }
          }
        });
        listener = { api, id };
      }
      handlers.add(handler);
      subscribedFanouts.add(registration);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        handlers.delete(handler);
        if (handlers.size > 0) return;
        subscribedFanouts.delete(registration);
        if (listener) {
          listener.api.offById(channel, listener.id);
          listener = null;
        }
      };
    },
  };
}

/**
 * Create the Electron-IPC transport. The preload bridge is re-checked on
 * every call (rather than captured at construction) so availability tracks
 * the live `window.electronAPI` state, matching the legacy module behavior.
 */
export function createElectronIpcBackendTransport(): BackendTransport {
  // Every `backend:*` broadcast channel is consumed through ONE shared
  // preload-bridge listener that fans out to its subscribers, so the IPC
  // listener count per channel is 0 or 1 no matter how many modules subscribe
  // (`backend:status`, intent-hq/monorepo#1424; `backend:notification`,
  // intent-hq/monorepo#2034 — 11 renderer modules subscribe at boot and the
  // per-module listeners tripped ipcRenderer's default cap of 10).
  const reconnectedFanout = createChannelFanout<
    { status?: string; reconnected?: boolean } | undefined
  >(BACKEND.STATUS, 'onReconnected');
  const notificationFanout = createChannelFanout<BackendNotification>(
    BACKEND.NOTIFICATION,
    'onNotification',
  );

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
        throw new BackendError({ code: 'UNAVAILABLE', message: 'Backend bridge unavailable' });
      const invokePayload: { method: string; params?: unknown; timeoutMs?: number } = {
        method,
        params: toPlainJson(params),
      };
      if (options?.timeoutMs !== undefined) invokePayload.timeoutMs = options.timeoutMs;
      const response = (await api.invoke(BACKEND.REQUEST, invokePayload)) as BackendResult<T>;
      return unwrap(response);
    },

    async subscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T> {
      const api = electronAPI();
      if (!api)
        throw new BackendError({ code: 'UNAVAILABLE', message: 'Backend bridge unavailable' });
      const response = (await api.invoke(
        BACKEND.SUBSCRIBE,
        toPlainJson(params),
      )) as BackendResult<T>;
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

    /**
     * Daemon JSON-RPC notifications (`events.event` and friends). Subscribers
     * fan out from a single shared `backend:notification` IPC listener; the
     * listener is removed when the last subscriber disposes and re-registered
     * on the next subscribe (intent-hq/monorepo#2034).
     */
    onNotification(handler: (notification: BackendNotification) => void): () => void {
      const api = electronAPI();
      if (!api) return () => {};
      return notificationFanout.subscribe(api, (payload) => handler(payload));
    },

    /**
     * Fires when the main-process JSON-RPC client re-establishes the socket
     * after a drop (`{ status: 'connected', reconnected: true }` marker
     * broadcast by `backend.ipc.ts`). Subscribers fan out from a single
     * shared IPC listener; the listener is removed when the last subscriber
     * disposes and re-registered on the next subscribe.
     */
    onReconnected(handler: () => void): () => void {
      const api = electronAPI();
      if (!api) return () => {};
      return reconnectedFanout.subscribe(api, (payload) => {
        if (payload?.status !== 'connected' || payload.reconnected !== true) return;
        handler();
      });
    },
  };
}
