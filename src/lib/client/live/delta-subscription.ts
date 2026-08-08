/**
 * Snapshot+delta subscription reconciliation for the live domain clients.
 *
 * Item 1 (parse): recognizes `method:"subscription.push"` envelopes
 * `{subscriptionId, kind, seq, snapshot?|delta?}` — `kind:"snapshot"` carries a
 * full collection; `kind:"delta"` carries `{added, updated, removedIds}`.
 *
 * Item 2 (reconcile): a snapshot replaces the channel's collection; a delta
 * upserts `added`/`updated` and deletes `removedIds`, all keyed by id. State is
 * held in the subscription seam (a `Map`) feeding the existing AppClient handler.
 *
 * Item 3 (channel-only, no legacy path): every subscription is backed
 * exclusively by a typed snapshot+delta channel of PROTOCOL §6.9 (e.g.
 * `workspace.subscribe`), registered unconditionally via a plain
 * `backendRequest` (the `chat.subscribe` precedent) — daemons are always
 * up to date and always advertise the channel, so there is no coexisting
 * `events.subscribe` firehose, no `fetchAll` refetch, and no liveState
 * capability gating (intent-hq/monorepo#1697). A failed registration retries
 * with capped exponential backoff — the channel is the only data path, so a
 * registration failure must keep retrying rather than silently going stale.
 * A sequence gap (or an unseeded delta) triggers resnapshot: the affected
 * channel's reconciler resets and it re-registers for a fresh seq-0 snapshot;
 * the handler is not re-invoked until that fresh snapshot lands, so
 * previously reconciled state is never flashed away by a transient gap.
 *
 * Item 4 (dynamic per-id channels): a `channel.dynamic` scope expands the
 * descriptor into ONE typed channel per desired id (e.g. one `note.subscribe`
 * per workspace), each with an independent subscriptionId/seq/registration-
 * generation. Ids added at runtime register a channel and merge its seq-0
 * snapshot into the emitted collection once it arrives; ids removed
 * unsubscribe and evict their entities immediately. Confirmed sibling
 * channels keep emitting while another channel is still registering or
 * recovering — there is no "every channel must be live" global gate. Pre-ack
 * pushes are buffered until the subscribe reply resolves (the chat-client
 * precedent) instead of dropped.
 */
import type { SubscriptionHandler, Unsubscribe } from "../app-client";
import { backendRequest, onBackendNotification, onBackendReconnected } from "./backend-transport";

/** Incremental change set carried by a `kind:"delta"` push. */
export interface DeltaPayload {
  added?: unknown[];
  updated?: unknown[];
  removedIds?: string[];
}

/** Parsed `subscription.push` envelope. */
export interface SubscriptionPush {
  subscriptionId: string;
  kind: "snapshot" | "delta";
  seq: number;
  snapshot?: unknown[];
  delta?: DeltaPayload;
}

/** Parse a daemon notification into a `SubscriptionPush`, or `null` if it isn't one. */
export function parseSubscriptionPush(method: string, params: unknown): SubscriptionPush | null {
  if (method !== "subscription.push" || !params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const subscriptionId = typeof p.subscriptionId === "string" ? p.subscriptionId : undefined;
  const seq = typeof p.seq === "number" ? p.seq : undefined;
  if (!subscriptionId || seq === undefined) return null;
  if (p.kind === "snapshot") {
    return {
      subscriptionId,
      kind: "snapshot",
      seq,
      snapshot: Array.isArray(p.snapshot) ? p.snapshot : [],
    };
  }
  if (p.kind === "delta") {
    const raw = (p.delta && typeof p.delta === "object" ? p.delta : {}) as Record<string, unknown>;
    return {
      subscriptionId,
      kind: "delta",
      seq,
      delta: {
        added: Array.isArray(raw.added) ? raw.added : [],
        updated: Array.isArray(raw.updated) ? raw.updated : [],
        removedIds: Array.isArray(raw.removedIds) ? raw.removedIds.map((id) => String(id)) : [],
      },
    };
  }
  return null;
}

/**
 * Reconciles snapshot/delta pushes into an id-keyed collection. A snapshot
 * rebuilds the map; a contiguous delta upserts/removes by id. Returns `false`
 * from `applyDelta` when the push is unseeded or out of sequence so the caller
 * can request a fresh snapshot.
 */
export class DeltaReconciler<T> {
  private readonly items = new Map<string, T>();
  private expectedSeq = 0;
  private seeded = false;

  constructor(
    private readonly getId: (raw: Record<string, unknown>) => string,
    private readonly normalize: (raw: Record<string, unknown>) => T | null,
  ) {}

  /** Forget all state so the next snapshot rebuilds from scratch. */
  reset(): void {
    this.items.clear();
    this.expectedSeq = 0;
    this.seeded = false;
  }

  /** Replace the whole collection from a snapshot push (any seq is a full rebuild). */
  applySnapshot(seq: number, rawItems: unknown[]): void {
    this.items.clear();
    for (const raw of rawItems) this.upsert(raw);
    this.expectedSeq = seq + 1;
    this.seeded = true;
  }

  /** Apply a contiguous delta; `false` means a gap → caller should resnapshot. */
  applyDelta(seq: number, delta: DeltaPayload): boolean {
    if (!this.seeded || seq !== this.expectedSeq) return false;
    for (const raw of delta.added ?? []) this.upsert(raw);
    for (const raw of delta.updated ?? []) this.upsert(raw);
    for (const id of delta.removedIds ?? []) this.items.delete(String(id));
    this.expectedSeq = seq + 1;
    return true;
  }

  /** Current collection as an array. */
  values(): T[] {
    return [...this.items.values()];
  }

  private upsert(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const rec = raw as Record<string, unknown>;
    const id = this.getId(rec);
    if (!id) return;
    const normalized = this.normalize(rec);
    if (normalized !== null) this.items.set(id, normalized);
  }
}

/**
 * Dynamic per-id scope for a typed channel: expands the descriptor into one
 * channel per desired id (e.g. one `note.subscribe` per workspace). The
 * source MUST invoke the listener with the FULL desired id set — once the
 * set is known, and again on every change; ids absent from a later call are
 * unsubscribed and their entities evicted.
 */
export interface DynamicChannelScope {
  /** Subscribe to the desired id set; returns the disposer. */
  subscribeIds: (listener: (ids: readonly string[]) => void) => Unsubscribe;
  /** Registration params for one id, e.g. `(id) => ({ workspaceId: id })`. */
  paramsForId: (id: string) => Record<string, unknown>;
}

/**
 * Descriptor for a typed snapshot+delta channel (PROTOCOL §6.9). Registered
 * unconditionally via a plain `backendRequest` (the `chat.subscribe`
 * precedent) — daemons always advertise the channel, so there is no
 * capability gate; its `subscription.push` frames drive the reconciler.
 */
export interface TypedChannelDescriptor {
  /** Channel registration method, e.g. `"workspace.subscribe"`. */
  subscribeMethod: string;
  /** Channel teardown method, e.g. `"workspace.unsubscribe"`. */
  unsubscribeMethod: string;
  /**
   * Registration params (scope), e.g. `{ workspaceId }`; `{}` when global.
   * Ignored when `dynamic` is set.
   */
  params?: Record<string, unknown>;
  /** Dynamic form: one channel per id yielded by the source. */
  dynamic?: DynamicChannelScope;
}

/** Configuration for {@link createDeltaSubscription}. */
export interface DeltaSubscriptionConfig<T> {
  /** The typed §6.9 channel backing this subscription — the only data path. */
  channel: TypedChannelDescriptor;
  /** Stable id for an entity from its raw daemon shape. */
  getId: (raw: Record<string, unknown>) => string;
  /** Coerce a raw push entity into `T`; `null` drops it. */
  normalize: (raw: Record<string, unknown>) => T | null;
  /** Receives the reconciled collection on every change. */
  handler: SubscriptionHandler<T[]>;
}

/**
 * Per-id channel state for the dynamic descriptor form. Each desired id owns
 * an independent registration (subscriptionId + generation token) and an
 * independent reconciler whose seq stream is isolated from its siblings.
 */
interface DynamicChannelState<T> {
  /**
   * Per-channel registration-generation token: bumped whenever a newer
   * registration or a teardown (removal, resnapshot, reconnect, dispose)
   * supersedes prior in-flight `subscribeMethod` requests, so an out-of-order
   * subscribe reply is discarded and best-effort unsubscribed.
   */
  generation: number;
  subscriptionId?: string;
  reconciler: DeltaReconciler<T>;
  /** True once a snapshot seeded this channel (its push-confirmation). */
  seeded: boolean;
  /** Gap seen: deltas are ignored until the recovery snapshot lands. */
  awaitingResnapshot: boolean;
  /** Consecutive registration failures, feeding the backoff delay. */
  retryAttempt: number;
  /** Pending retry timer, cleared on a superseding registration/teardown. */
  retryTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Bound for the pre-ack push buffer: pushes whose subscriptionId matches no
 * known registration are held (instead of dropped — PR #397 carry-over) and
 * replayed when a subscribe reply resolves to that id, the chat-client
 * buffering precedent.
 */
const MAX_BUFFERED_PUSHES = 32;

/** Base delay for channel-registration retry backoff. */
const RETRY_BASE_MS = 1000;

/** Cap on the exponential registration-retry backoff. */
const RETRY_MAX_MS = 30_000;

/**
 * Exponential backoff (capped) for the given consecutive-failure count. The
 * channel is the only data path for a subscription (intent-hq/monorepo#1697:
 * fetchAll is gone), so a registration failure must keep retrying rather than
 * leaving the subscription permanently unseeded.
 */
function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/**
 * Wire a subscription backed exclusively by a typed §6.9 snapshot+delta
 * channel (intent-hq/monorepo#1697 — no legacy `events.subscribe` firehose,
 * no `fetchAll` refetch, no liveState capability gating: the channel is
 * registered unconditionally and retries with backoff on failure). Snapshot
 * and delta pushes reconcile into the collection incrementally; a sequence
 * gap resnapshots just the affected channel. Returns the disposer.
 */
export function createDeltaSubscription<T>(config: DeltaSubscriptionConfig<T>): Unsubscribe {
  const { channel, getId, normalize, handler } = config;
  const dynamic = channel.dynamic;
  // Static reconciler; the dynamic form holds one reconciler per channel in
  // `dynamicChannels` instead.
  const reconciler = new DeltaReconciler<T>(getId, normalize);

  let disposed = false;
  let channelSubscriptionId: string | undefined;
  // Registration-generation token: bumped whenever a new registration or a
  // teardown (unregister, reconnect, resnapshot, dispose) supersedes prior
  // in-flight `subscribeMethod` requests, so a slow stale resolve can neither
  // overwrite `channelSubscriptionId` from a newer registration nor leak a
  // daemon-side subscription — the stale id is best-effort unsubscribed.
  let channelGeneration = 0;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  // Dynamic form: one channel per desired id, keyed by id.
  const dynamicChannels = new Map<string, DynamicChannelState<T>>();
  // Pre-ack buffer (PR #397 carry-over): pushes that raced their subscribe
  // reply are held and replayed once a registration resolves to their id.
  const bufferedPushes: SubscriptionPush[] = [];

  const bufferPush = (push: SubscriptionPush) => {
    bufferedPushes.push(push);
    if (bufferedPushes.length > MAX_BUFFERED_PUSHES) bufferedPushes.shift();
  };

  const drainBufferedPushes = (id: string) => {
    const matched = bufferedPushes.filter((p) => p.subscriptionId === id);
    for (const p of matched) bufferedPushes.splice(bufferedPushes.indexOf(p), 1);
    for (const p of matched) processPush(p);
  };

  const currentValues = (): T[] => {
    if (!dynamic) return reconciler.values();
    const merged: T[] = [];
    for (const state of dynamicChannels.values()) merged.push(...state.reconciler.values());
    return merged;
  };

  const emit = () => {
    if (!disposed) handler(currentValues());
  };

  // A subscribe reply is still in flight somewhere, so an unmatched push may
  // be ours pre-ack — the buffering window. When nothing is pending, unmatched
  // pushes belong to other subscriptions and are dropped as before.
  const hasPendingRegistration = (): boolean => {
    if (dynamic) {
      for (const s of dynamicChannels.values()) if (s.subscriptionId === undefined) return true;
      return false;
    }
    return channelSubscriptionId === undefined;
  };

  // Once no registration awaits its ack, any push still buffered was drained
  // by none of our ids — it is provably foreign. Clear the buffer instead of
  // leaving it to capacity eviction, so a stale foreign entry can never
  // replay into a later registration that reuses its subscriptionId. Called
  // after each subscribe reply resolves (the only pending→resolved edges).
  const pruneForeignBufferedPushes = () => {
    if (bufferedPushes.length > 0 && !hasPendingRegistration()) bufferedPushes.length = 0;
  };

  // Typed channel registration goes through plain `backendRequest` (the
  // `chat.subscribe` precedent). Static form only; the dynamic form registers
  // per id via `registerDynamicChannel`. A failed registration retries with
  // capped exponential backoff — the channel is the only data path.
  const registerChannel = () => {
    if (dynamic) return;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    channelGeneration += 1;
    const generation = channelGeneration;
    backendRequest<{ subscriptionId?: string }>(channel.subscribeMethod, channel.params ?? {})
      .then((result) => {
        const id = result?.subscriptionId;
        if (generation !== channelGeneration || disposed) {
          // Stale resolve: a newer registration or a teardown superseded this
          // attempt while it was in flight. Never store the id — pushes for
          // the newer id must keep matching — and best-effort release the
          // daemon-side subscription this reply just created.
          if (id) {
            void backendRequest(channel.unsubscribeMethod, { subscriptionId: id }).catch(() => {
              // Unsubscribe is best-effort.
            });
          }
          return;
        }
        channelSubscriptionId = id;
        retryAttempt = 0;
        if (id) drainBufferedPushes(id);
        pruneForeignBufferedPushes();
      })
      .catch(() => {
        if (generation !== channelGeneration || disposed) return;
        const delay = retryDelayMs(retryAttempt);
        retryAttempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!disposed) registerChannel();
        }, delay);
      });
  };

  const unregisterChannel = () => {
    if (dynamic) return;
    // Invalidate any in-flight registration so its late resolve cleans up
    // after itself instead of resurrecting a subscription past teardown.
    channelGeneration += 1;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    if (!channelSubscriptionId) return;
    const id = channelSubscriptionId;
    channelSubscriptionId = undefined;
    void backendRequest(channel.unsubscribeMethod, { subscriptionId: id }).catch(() => {
      // Unsubscribe is best-effort.
    });
  };

  const registerDynamicChannel = (id: string, state: DynamicChannelState<T>) => {
    if (!dynamic) return;
    if (state.retryTimer !== undefined) {
      clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
    }
    state.generation += 1;
    const generation = state.generation;
    backendRequest<{ subscriptionId?: string }>(channel.subscribeMethod, dynamic.paramsForId(id))
      .then((result) => {
        const sid = result?.subscriptionId;
        if (disposed || dynamicChannels.get(id) !== state || generation !== state.generation) {
          // Stale resolve: the id was removed, re-registered, or torn down
          // while this attempt was in flight. Best-effort release the
          // daemon-side subscription this reply just created.
          if (sid) {
            void backendRequest(channel.unsubscribeMethod, { subscriptionId: sid }).catch(() => {
              // Unsubscribe is best-effort.
            });
          }
          return;
        }
        state.subscriptionId = sid;
        state.retryAttempt = 0;
        if (sid) drainBufferedPushes(sid);
        pruneForeignBufferedPushes();
      })
      .catch(() => {
        if (disposed || dynamicChannels.get(id) !== state || generation !== state.generation) {
          return;
        }
        const delay = retryDelayMs(state.retryAttempt);
        state.retryAttempt += 1;
        state.retryTimer = setTimeout(() => {
          state.retryTimer = undefined;
          if (!disposed && dynamicChannels.get(id) === state) registerDynamicChannel(id, state);
        }, delay);
      });
  };

  const unregisterDynamicChannel = (state: DynamicChannelState<T>) => {
    // Invalidate any in-flight registration so its late resolve cleans up
    // after itself instead of resurrecting a subscription past teardown.
    state.generation += 1;
    if (state.retryTimer !== undefined) {
      clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
    }
    const sid = state.subscriptionId;
    state.subscriptionId = undefined;
    if (sid) {
      void backendRequest(channel.unsubscribeMethod, { subscriptionId: sid }).catch(() => {
        // Unsubscribe is best-effort.
      });
    }
  };

  // Per-channel gap recovery: reset just this channel and re-register it for
  // a fresh seq-0 snapshot; sibling channels keep their state and keep
  // emitting — this channel's stale values simply drop out of the merged
  // collection until its recovery snapshot lands.
  const resnapshotDynamicChannel = (id: string, state: DynamicChannelState<T>) => {
    if (state.awaitingResnapshot) return;
    state.awaitingResnapshot = true;
    state.seeded = false;
    state.reconciler.reset();
    unregisterDynamicChannel(state);
    registerDynamicChannel(id, state);
    emit();
  };

  // The id source reported the FULL desired id set: register channels for new
  // ids, tear down (and evict the entities of) ids that disappeared.
  const reconcileDesiredIds = (ids: readonly string[]) => {
    if (disposed || !dynamic) return;
    const desired = new Set(ids);
    let changed = false;
    for (const [id, state] of [...dynamicChannels]) {
      if (desired.has(id)) continue;
      dynamicChannels.delete(id);
      unregisterDynamicChannel(state);
      changed = true;
    }
    for (const id of desired) {
      if (dynamicChannels.has(id)) continue;
      const state: DynamicChannelState<T> = {
        generation: 0,
        reconciler: new DeltaReconciler<T>(getId, normalize),
        seeded: false,
        awaitingResnapshot: false,
        retryAttempt: 0,
      };
      dynamicChannels.set(id, state);
      registerDynamicChannel(id, state);
      changed = true;
    }
    // A removed id's entities must be evicted immediately; an added id only
    // contributes once its own seq-0 snapshot lands (handled in processPush).
    if (changed) emit();
  };

  // Reset local state and re-register for a fresh seq-0 snapshot. No pushes
  // are emitted until that fresh snapshot lands, so a transient reconnect or
  // sequence gap never flashes the UI to an empty collection.
  const resnapshot = () => {
    reconciler.reset();
    unregisterChannel();
    registerChannel();
  };

  // Route a push (fresh or replayed from the pre-ack buffer) to its channel.
  // Dynamic form: apply against the matching per-id reconciler and emit the
  // merged collection immediately — confirmed sibling channels are not
  // gated on this one. Static form: applies directly to the single reconciler.
  const processPush = (push: SubscriptionPush) => {
    if (disposed) return;
    if (dynamic) {
      for (const [id, state] of dynamicChannels) {
        if (state.subscriptionId !== push.subscriptionId) continue;
        if (push.kind === "snapshot") {
          state.awaitingResnapshot = false;
          state.seeded = true;
          state.reconciler.applySnapshot(push.seq, push.snapshot ?? []);
          emit();
        } else if (!state.awaitingResnapshot) {
          if (state.reconciler.applyDelta(push.seq, push.delta ?? {})) {
            emit();
          } else {
            resnapshotDynamicChannel(id, state);
          }
        }
        return;
      }
      // No confirmed channel matches; hold it if a subscribe reply is still
      // pending (pre-ack window), otherwise it belongs to someone else.
      if (hasPendingRegistration()) bufferPush(push);
      return;
    }
    if (push.subscriptionId !== channelSubscriptionId) {
      if (hasPendingRegistration()) bufferPush(push);
      return;
    }
    if (push.kind === "snapshot") {
      reconciler.applySnapshot(push.seq, push.snapshot ?? []);
      emit();
    } else if (reconciler.applyDelta(push.seq, push.delta ?? {})) {
      emit();
    } else {
      resnapshot();
    }
  };

  const off = onBackendNotification((n) => {
    const push = parseSubscriptionPush(n.method, n.params);
    if (push) processPush(push);
  });

  // Reconnect (RESUB-1): the daemon dropped its subscription registry on
  // restart, so the stashed id points at nothing — no unsubscribe frame, just
  // re-register for a fresh seq-0 snapshot on a bumped generation so a
  // pre-restart in-flight registration cannot land.
  const offReconnect = onBackendReconnected(() => {
    if (disposed) return;
    channelGeneration += 1;
    channelSubscriptionId = undefined;
    retryAttempt = 0;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    reconciler.reset();
    // Pre-restart pushes reference ids from the dropped registry.
    bufferedPushes.length = 0;
    for (const [id, state] of dynamicChannels) {
      state.generation += 1;
      state.subscriptionId = undefined;
      state.seeded = false;
      state.awaitingResnapshot = false;
      state.retryAttempt = 0;
      if (state.retryTimer !== undefined) {
        clearTimeout(state.retryTimer);
        state.retryTimer = undefined;
      }
      state.reconciler.reset();
      registerDynamicChannel(id, state);
    }
    if (!dynamic) registerChannel();
  });

  // Registration is unconditional — daemons always advertise the channel
  // (intent-hq/monorepo#1697) — with a bounded-backoff retry on failure. The
  // dynamic form additionally waits for the id source before registering.
  const offIds: Unsubscribe | undefined = dynamic
    ? dynamic.subscribeIds(reconcileDesiredIds)
    : undefined;
  if (!dynamic) registerChannel();

  return () => {
    disposed = true;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    off();
    offReconnect();
    offIds?.();
    unregisterChannel();
    for (const state of dynamicChannels.values()) unregisterDynamicChannel(state);
    dynamicChannels.clear();
  };
}
