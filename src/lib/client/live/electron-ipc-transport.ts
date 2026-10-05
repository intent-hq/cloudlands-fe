import {
  NativeReviewInputSchema,
  NativeReviewPreparedViewSchema,
  NativeReviewObservationSchema,
  NativeReviewTextCommandSchema,
  type NativeReviewInput,
  type NativeReviewSession,
  type NativeReviewRetirement,
  type NativeReviewObservation,
} from '$shared/types/native-review-operation';
import { z } from 'zod';
import { createRepositoryResourceTransport } from './repository-resource-transport';
import {
  SelectionRootSchema,
  SelectionPreviewSchema,
  SelectionObservationSchema,
  SelectionCommandSchema,
  type RepositorySelectionSession,
  type SelectionRetirement,
  type SelectionObservation,
} from '$shared/types/repository-selection';
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
  RepositoryRootIdentitySchema,
  type RepositoryRootIdentity,
} from '$shared/types/repository-context';
import {
  BackendError,
  type BackendErrorPayload,
  type BackendNotification,
  type BackendRequestOptions,
  type BackendTransport,
  type BoundRepositoryResult,
  type BoundRepositoryRoute,
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
    captureRepositorySelection,
    prepareNativeReview,
    captureRepositoryResource: createRepositoryResourceTransport(electronAPI),

    async captureRepositoryRoute(root: RepositoryRootIdentity): Promise<BoundRepositoryRoute> {
      const api = electronAPI();
      const unavailable = () =>
        new BackendError({
          code: 'REPOSITORY_ROUTE_UNAVAILABLE',
          message: 'Repository route unavailable',
        });
      if (!api) throw unavailable();
      const capturedRoot = Object.freeze(RepositoryRootIdentitySchema.parse(root));
      let id: string | undefined;
      let released = false;
      let retired = false;
      let overflow = false;
      const early = new Set<string>();
      const handlers = new Set<() => void>();
      const retire = () => {
        if (retired) return;
        retired = true;
        for (const handler of [...handlers]) {
          try {
            handler();
          } catch {
            /* Other owners still need retirement. */
          }
        }
        handlers.clear();
      };
      const listener = api.on(BACKEND.REPOSITORY.RETIRED, (payload: unknown) => {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('id' in payload) ||
          typeof payload.id !== 'string'
        )
          return;
        if (id === undefined && !overflow) {
          early.add(payload.id);
          if (early.size > 32) {
            overflow = true;
            early.clear();
            retire();
          }
        } else if (payload.id === id) retire();
      });
      const release = async () => {
        if (released) return;
        released = true;
        retire();
        api.offById(BACKEND.REPOSITORY.RETIRED, listener);
        if (!id) return;
        // Always address the original bridge, including cleanup after replacement.
        try {
          await api.invoke(BACKEND.REPOSITORY.RELEASE, { id, root: capturedRoot });
        } catch {
          /* Main also retires on document teardown and expiry. */
        }
      };
      try {
        const result = unwrap<{ id: string }>(
          await api.invoke(BACKEND.REPOSITORY.CAPTURE, { root: capturedRoot }),
        );
        if (typeof result.id !== 'string' || !result.id) throw unavailable();
        id = result.id;
        if (early.has(id)) retire();
        early.clear();
        if (electronAPI() !== api || overflow || retired) throw unavailable();
      } catch (error) {
        await release();
        throw error;
      }
      return {
        onRetired(handler) {
          if (released || retired || electronAPI() !== api) {
            handler();
            return () => {};
          }
          handlers.add(handler);
          return () => {
            handlers.delete(handler);
          };
        },
        async request<T>(
          method: string,
          params: Record<string, unknown>,
          options?: { timeoutMs?: number },
        ) {
          if (
            released ||
            retired ||
            electronAPI() !== api ||
            (options && 'localMachine' in options)
          )
            throw unavailable();
          const result = unwrap<BoundRepositoryResult<T>>(
            await api.invoke(BACKEND.REPOSITORY.REQUEST, {
              id,
              root: capturedRoot,
              method,
              params: toPlainJson(params),
              ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            }),
          );
          return {
            ...result,
            current: result.current && !released && !retired && electronAPI() === api,
          };
        },
        release,
      };
    },

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
      const invokePayload: {
        method: string;
        params?: unknown;
        timeoutMs?: number;
        localMachine?: boolean;
      } = {
        method,
        params: toPlainJson(params),
      };
      if (options?.timeoutMs !== undefined) invokePayload.timeoutMs = options.timeoutMs;
      if (options?.localMachine) invokePayload.localMachine = true;
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

    async unsubscribe(subscriptionId: string, workspaceId?: string): Promise<void> {
      const api = electronAPI();
      if (!api) return;
      try {
        await api.invoke(BACKEND.UNSUBSCRIBE, {
          subscriptionId,
          ...(workspaceId !== undefined ? { workspaceId } : {}),
        });
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

/** Original bridge and opaque main-owned selection reference. */
async function captureRepositorySelection(
  root: RepositoryRootIdentity,
): Promise<RepositorySelectionSession> {
  const api = electronAPI(),
    capturedRoot = SelectionRootSchema.parse(root);
  const unavailable = () =>
    new BackendError({
      code: 'REPOSITORY_SELECTION_UNAVAILABLE',
      message: 'REPOSITORY_SELECTION_UNAVAILABLE',
    });
  if (!api) throw unavailable();
  const channels = BACKEND.REPOSITORY_SELECTION;
  let id: string | undefined,
    ended = false,
    retirement: SelectionRetirement | undefined;
  let overflow = false;
  const early = new Map<string, SelectionRetirement>(),
    handlers = new Set<(kind: SelectionRetirement) => void>();
  const retire = (kind: SelectionRetirement) => {
    if (retirement === 'closed' || retirement === kind) return;
    retirement = kind;
    for (const handler of [...handlers]) {
      try {
        handler(kind);
      } catch {
        /* Notify all owners. */
      }
    }
    if (kind === 'closed') handlers.clear();
  };
  const listener = api.on(channels.RETIRED, (payload: unknown) => {
    const event = z
      .object({ id: z.string().min(1), kind: z.enum(['admission', 'closed']) })
      .strict()
      .safeParse(payload);
    if (!event.success) return;
    if (id === undefined) {
      if (early.get(event.data.id) !== 'closed') early.set(event.data.id, event.data.kind);
      if (early.size > 32) {
        overflow = true;
        early.clear();
        retire('closed');
      }
    } else if (event.data.id === id) retire(event.data.kind);
  });
  const release = async () => {
    if (ended) return;
    ended = true;
    retire('closed');
    api.offById(channels.RETIRED, listener);
    if (id) {
      try {
        await api.invoke(channels.RELEASE, { id, root: capturedRoot });
      } catch {
        /* Main has a bounded original owner. */
      }
    }
  };
  let preview;
  try {
    const raw = unwrap<unknown>(await api.invoke(channels.CAPTURE, { root: capturedRoot }));
    const known = z.object({ id: z.string().min(1).max(4096) }).safeParse(raw);
    if (known.success) id = known.data.id;
    const captured = z
      .object({ id: z.string().min(1), preview: SelectionPreviewSchema })
      .strict()
      .parse(raw);
    id = captured.id;
    preview = captured.preview;
    const before = early.get(id);
    early.clear();
    if (before) retire(before);
    if (
      ended ||
      overflow ||
      retirement ||
      electronAPI() !== api ||
      JSON.stringify(preview.root) !== JSON.stringify(capturedRoot)
    )
      throw unavailable();
  } catch (error) {
    await release();
    throw error;
  }
  let retained: SelectionObservation | undefined, claim: string | undefined;
  let pending: Promise<SelectionObservation> | undefined;
  const call = (
    dispatch: () => Promise<BackendResult<unknown> | undefined>,
  ): Promise<SelectionObservation> => {
    if (ended || retirement === 'closed' || electronAPI() !== api || pending)
      return Promise.reject(unavailable());
    const task = (async () => {
      try {
        const result = SelectionObservationSchema.parse(unwrap(await dispatch()));
        if (retained?.attempt?.status !== 'settled') retained = result;
      } catch {
        retained = {
          ...(retained ?? { attempt: null, current: false }),
          uncertain: retained?.attempt?.status !== 'settled',
        };
      }
      return {
        ...retained,
        current: !!retained.current && !ended && !retirement && electronAPI() === api,
      };
    })();
    pending = task;
    void task.finally(() => {
      if (pending === task) pending = undefined;
    });
    return task;
  };
  return {
    preview,
    onRetired(handler) {
      if (ended || electronAPI() !== api) retire('closed');
      if (retirement) handler(retirement);
      if (retirement !== 'closed') handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    confirm(command) {
      const selected = SelectionCommandSchema.parse(command),
        key = JSON.stringify(selected);
      if (claim !== undefined) {
        if (claim !== key) return Promise.reject(unavailable());
        return (
          pending ??
          Promise.resolve({
            ...(retained ?? { attempt: null, uncertain: true }),
            current: !!retained?.current && !ended && !retirement && electronAPI() === api,
          })
        );
      }
      if (retirement || ended || pending || electronAPI() !== api)
        return Promise.reject(unavailable());
      claim = key;
      return call(() =>
        api.invoke(channels.CONFIRM, { id, root: capturedRoot, command: selected }),
      );
    },
    reconcile: () => call(() => api.invoke(channels.RECONCILE, { id, root: capturedRoot })),
    release,
  };
}

/** Original native preparation and its one immutable text claim. */
async function prepareNativeReview(input: NativeReviewInput): Promise<NativeReviewSession> {
  const api = electronAPI(),
    capturedInput = NativeReviewInputSchema.parse(input);
  if (!api)
    throw new BackendError({
      code: 'NATIVE_REVIEW_UNAVAILABLE',
      message: 'NATIVE_REVIEW_UNAVAILABLE',
    });
  return captureNativeReview(
    api,
    capturedInput.review.root,
    { input: capturedInput },
    !!capturedInput.review.companion,
  );
}
async function captureNativeReview(
  api: NonNullable<ReturnType<typeof electronAPI>>,
  capturedRoot: NativeReviewInput['review']['root'],
  payload:
    | { input: NativeReviewInput }
    | { companionOf: string; root: NativeReviewInput['review']['root'] },
  marked = false,
): Promise<NativeReviewSession> {
  const unavailable = () =>
    new BackendError({
      code: 'NATIVE_REVIEW_UNAVAILABLE',
      message: 'NATIVE_REVIEW_UNAVAILABLE',
    });
  if (electronAPI() !== api) throw unavailable();
  const channels = BACKEND.NATIVE_REVIEW;
  let id: string | undefined,
    ended = false,
    retirement: NativeReviewRetirement | undefined;
  let companionTask: Promise<NativeReviewSession> | undefined;
  const isClosed = () => retirement === 'closed';
  let overflow = false;
  const early = new Map<string, NativeReviewRetirement>(),
    handlers = new Set<(kind: NativeReviewRetirement) => void>();
  const retire = (kind: NativeReviewRetirement) => {
    if (retirement === 'closed' || retirement === kind) return;
    retirement = kind;
    for (const handler of [...handlers]) {
      try {
        handler(kind);
      } catch {
        /* Notify all owners. */
      }
    }
    if (kind === 'closed') handlers.clear();
  };
  const listener = api.on(channels.RETIRED, (payload: unknown) => {
    const event = z
      .object({ id: z.string().min(1), kind: z.enum(['admission', 'closed']) })
      .strict()
      .safeParse(payload);
    if (!event.success) return;
    if (id === undefined) {
      if (early.get(event.data.id) !== 'closed') early.set(event.data.id, event.data.kind);
      if (early.size > 32) {
        overflow = true;
        early.clear();
        retire('closed');
      }
    } else if (event.data.id === id) retire(event.data.kind);
  });
  const release = async () => {
    if (ended) return;
    ended = true;
    retire('closed');
    api.offById(channels.RETIRED, listener);
    void companionTask?.then(
      (child) => child.release(),
      () => {},
    );
    if (id) {
      try {
        await api.invoke(channels.RELEASE, { id, root: capturedRoot });
      } catch {
        /* Main has a bounded original owner. */
      }
    }
  };
  let preview;
  try {
    const raw = unwrap<unknown>(await api.invoke(channels.PREPARE, payload));
    const known = z.object({ id: z.string().min(1).max(4096) }).safeParse(raw);
    if (known.success) id = known.data.id;
    const captured = z
      .object({ id: z.string().min(1), preview: NativeReviewPreparedViewSchema })
      .strict()
      .parse(raw);
    id = captured.id;
    preview = captured.preview;
    const before = early.get(id);
    early.clear();
    if (before) retire(before);
    if (
      ended ||
      overflow ||
      retirement ||
      electronAPI() !== api ||
      JSON.stringify(preview.root) !== JSON.stringify(capturedRoot)
    )
      throw unavailable();
  } catch (error) {
    await release();
    throw error;
  }
  let retained: NativeReviewObservation | undefined, claim: string | undefined;
  let pending: Promise<NativeReviewObservation> | undefined;
  const call = (
    dispatch: () => Promise<BackendResult<unknown> | undefined>,
  ): Promise<NativeReviewObservation> => {
    if (ended || retirement === 'closed' || electronAPI() !== api || pending)
      return Promise.reject(unavailable());
    let finish!: (value: NativeReviewObservation) => void;
    const task = new Promise<NativeReviewObservation>((resolve) => {
      finish = resolve;
    });
    pending = task; // Reserve before an IPC implementation can call back synchronously.
    void (async () => {
      try {
        const result = NativeReviewObservationSchema.parse(unwrap(await dispatch()));
        retained = result;
      } catch {
        retained = {
          ...(retained ?? { execute: null, reconciliation: null, current: false }),
          uncertain:
            retained?.uncertain ||
            (retained?.execute?.state !== 'settled' &&
              retained?.reconciliation?.state !== 'settled'),
        };
      }
      return {
        ...retained,
        current: !!retained.current && !ended && !retirement && electronAPI() === api,
      };
    })().then(finish, () =>
      finish({
        ...(retained ?? { execute: null, reconciliation: null }),
        current: false,
        uncertain: true,
      }),
    );
    void task.finally(() => {
      if (pending === task) pending = undefined;
    });
    return task;
  };
  return {
    ...(marked
      ? {
          prepareCompanion() {
            if (companionTask) return companionTask;
            companionTask = Promise.resolve().then(async () => {
              if (!id || ended || retirement === 'closed' || pending || electronAPI() !== api)
                throw unavailable();
              const child = await captureNativeReview(api, capturedRoot, {
                companionOf: id,
                root: capturedRoot,
              });
              if (ended || isClosed() || electronAPI() !== api) {
                await child.release();
                throw unavailable();
              }
              return child;
            });
            return companionTask;
          },
        }
      : {}),
    preview,
    onRetired(handler) {
      if (ended || electronAPI() !== api) retire('closed');
      if (retirement) handler(retirement);
      if (retirement !== 'closed') handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    confirm(command) {
      const selected = NativeReviewTextCommandSchema.parse(command),
        key = JSON.stringify(selected);
      if (claim !== undefined) {
        if (claim !== key) return Promise.reject(unavailable());
        return (
          pending ??
          Promise.resolve({
            ...(retained ?? { execute: null, reconciliation: null, uncertain: true }),
            current: !!retained?.current && !ended && !retirement && electronAPI() === api,
          })
        );
      }
      if (retirement || ended || pending || electronAPI() !== api)
        return Promise.reject(unavailable());
      claim = key;
      return call(() =>
        api.invoke(channels.EXECUTE, { id, root: capturedRoot, command: selected }),
      );
    },
    reconcile: () => call(() => api.invoke(channels.RECONCILE, { id, root: capturedRoot })),
    release,
  };
}
