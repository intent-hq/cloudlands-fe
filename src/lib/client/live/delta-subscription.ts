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
 * Item 3 (coexist + reconnect): the legacy `events.subscribe` firehose keeps
 * running. Until a valid push is seen for our subscription we serve today's
 * one-shot refetch (dual-mode-safe — the default when the daemon has no
 * live-state). Event-driven refetches are coalesced (leading edge + one
 * trailing follow-up per window, single-flight) so an event storm while not
 * live cannot fan out one fetchAll per event (intent-hq/monorepo#1010).
 * Once live, legacy events are ignored to avoid double-application.
 * A sequence gap (or an unseeded delta) triggers reconnect-to-resnapshot: the
 * reconciler resets and the subscription re-registers to obtain a fresh seq-0
 * snapshot, with a one-shot refetch bridging the stale-UI window.
 *
 * Item 4 (typed channel): when the config carries a `channel` descriptor AND
 * the daemon advertises `capabilities.liveState`, the matching snapshot+delta
 * channel of PROTOCOL §6.9 (e.g. `workspace.subscribe`) is registered via a
 * plain `backendRequest` — the `chat.subscribe` precedent — alongside the
 * firehose. Its `subscription.push` frames are what actually flip a
 * subscription live; the capability flag alone never suppresses refetches
 * (intent-hq/monorepo#775).
 *
 * Item 5 (dynamic per-id channels): a `channel.dynamic` scope expands the
 * descriptor into ONE typed channel per desired id (e.g. one `note.subscribe`
 * per workspace), each with an independent subscriptionId/seq/registration-
 * generation. Ids added at runtime register a channel and merge its seq-0
 * snapshot into the emitted collection; ids removed unsubscribe and evict
 * their entities. The subscription is live ONLY while EVERY desired channel
 * is push-confirmed — any channel gap/loss drops back to bridging legacy
 * refetches (the #775 safety net never regresses). Pre-ack pushes are
 * buffered until the subscribe reply resolves (the chat-client precedent)
 * instead of dropped.
 */
import type { SubscriptionHandler, Unsubscribe } from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  detectLiveStateCapability,
  onBackendNotification,
  onBackendReconnected,
} from "./backend-transport";

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
 * via plain `backendRequest` (not `backendSubscribe`) when the daemon
 * advertises `capabilities.liveState`; its `subscription.push` frames drive
 * the reconciler.
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
  /** Daemon event types for the coexisting legacy `events.subscribe` firehose. */
  eventTypes: string[];
  /**
   * Optional typed §6.9 channel to register when the daemon advertises
   * liveState. Without it (or on legacy daemons) only the firehose +
   * refetch path runs, exactly as today.
   */
  channel?: TypedChannelDescriptor;
  /** One-shot refetch: initial snapshot, legacy refresh, and gap-recovery bridge. */
  fetchAll: () => Promise<T[]>;
  /** Stable id for an entity from its raw daemon shape. */
  getId: (raw: Record<string, unknown>) => string;
  /** Coerce a raw push entity into `T`; `null` drops it. */
  normalize: (raw: Record<string, unknown>) => T | null;
  /** Whether a legacy `events.event` notification warrants a refetch. */
  matchLegacyEvent: (method: string, params: unknown) => boolean;
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
}

/**
 * Bound for the pre-ack push buffer: pushes whose subscriptionId matches no
 * known registration are held (instead of dropped — PR #397 carry-over) and
 * replayed when a subscribe reply resolves to that id, the chat-client
 * buffering precedent.
 */
const MAX_BUFFERED_PUSHES = 32;

/**
 * Trailing window for coalescing legacy-event refetches. While a subscription
 * is not live, daemon event storms (e.g. the agent-lifecycle burst after a
 * restart) must not fan out one `fetchAll` per event — for the agents client
 * that is one `agent.list` per workspace per event, the intent-hq/monorepo#1010
 * slow-statement burst. Events arriving while a refetch is in flight (or a
 * follow-up is already scheduled) collapse into a single trailing refetch
 * this many ms after the in-flight one settles.
 */
const LEGACY_REFETCH_COALESCE_MS = 250;

/**
 * Wire a dual-mode subscription with runtime-only live-state detection: live
 * mode is entered per-subscription when the first valid `subscription.push`
 * for THIS subscription is observed; until then legacy `events.event` matches
 * keep serving today's one-shot refetch. A hello-time capability flag alone
 * must never silence refetches — when the typed channel is not actually wired
 * that would leave the UI permanently stale (intent-hq/monorepo#775). Once
 * live, snapshots/deltas reconcile incrementally. Returns the disposer.
 */
export function createDeltaSubscription<T>(config: DeltaSubscriptionConfig<T>): Unsubscribe {
  const { eventTypes, channel, fetchAll, getId, normalize, matchLegacyEvent, handler } = config;
  const dynamic = channel?.dynamic;
  // Static/legacy reconciler; the dynamic form holds one reconciler per
  // channel in `dynamicChannels` instead.
  const reconciler = new DeltaReconciler<T>(getId, normalize);

  let disposed = false;
  let live = false;
  let awaitingResnapshot = false;
  let subscriptionId: string | undefined;
  // Typed §6.9 channel state: registered only after the hello handshake
  // confirms liveState; its pushes are what actually flip `live`.
  let channelCapable = false;
  let channelSubscriptionId: string | undefined;
  // Registration-generation token: bumped whenever a new registration or a
  // teardown (unregister, reconnect, resnapshot, dispose) supersedes prior
  // in-flight `subscribeMethod` requests, so a slow stale resolve can neither
  // overwrite `channelSubscriptionId` from a newer registration nor leak a
  // daemon-side subscription — the stale id is best-effort unsubscribed.
  let channelGeneration = 0;
  // Stale-refetch guard: bumped whenever the live/legacy regime changes (a
  // push entering live mode, reconnect, resnapshot) so an in-flight
  // refetchEmit() started under an older regime is dropped at resolve-time
  // instead of overwriting newer reconciled state.
  let refetchEpoch = 0;
  // Dynamic form: one channel per desired id, keyed by id.
  const dynamicChannels = new Map<string, DynamicChannelState<T>>();
  // The id source has reported at least one (possibly empty) desired set.
  let idsInitialized = false;
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

  const emitLive = () => {
    if (!disposed) handler(currentValues());
  };

  // Legacy-event refetch coalescing (intent-hq/monorepo#1010): single-flight
  // tracking plus one trailing follow-up per coalesce window, so an event
  // storm while not live costs at most ~1 fetchAll per (window + fetch)
  // instead of one per event.
  let refetchInFlight = false;
  let refetchFollowUpWanted = false;
  let refetchFollowUpTimer: ReturnType<typeof setTimeout> | undefined;

  const refetchEmit = () => {
    const epoch = refetchEpoch;
    refetchInFlight = true;
    fetchAll()
      .then((items) => {
        if (!disposed && !live && epoch === refetchEpoch) handler(items);
      })
      .catch(() => {
        // Refresh failures are non-fatal for the subscription.
      })
      .finally(() => {
        refetchInFlight = false;
        if (!refetchFollowUpWanted || disposed) return;
        // Events arrived mid-flight: their changes may postdate the fetch
        // that just settled, so run exactly one trailing refetch after the
        // coalesce window (unless a push flips us live first).
        refetchFollowUpWanted = false;
        refetchFollowUpTimer = setTimeout(() => {
          refetchFollowUpTimer = undefined;
          if (!disposed && !live) refetchEmit();
        }, LEGACY_REFETCH_COALESCE_MS);
      });
  };

  // Legacy-event entry point: leading edge fires immediately; events landing
  // while a refetch is in flight collapse into the single trailing follow-up;
  // events landing while that follow-up is pending are already covered by it.
  const coalescedRefetchEmit = () => {
    if (refetchFollowUpTimer !== undefined) return;
    if (refetchInFlight) {
      refetchFollowUpWanted = true;
      return;
    }
    refetchEmit();
  };

  const register = () => {
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) {
          void backendUnsubscribe(subscriptionId);
        } else if (!dynamic && subscriptionId) {
          // The legacy id is a push-match target in the static form; replay
          // any pre-ack pushes that raced this reply.
          drainBufferedPushes(subscriptionId);
        }
        pruneForeignBufferedPushes();
      })
      .catch(() => {
        // Without a daemon subscription we still serve the refetch fallback.
      });
  };

  // A subscribe reply is still in flight somewhere, so an unmatched push may
  // be ours pre-ack — the buffering window. When nothing is pending, unmatched
  // pushes belong to other subscriptions and are dropped as before.
  const hasPendingRegistration = (): boolean => {
    if (subscriptionId === undefined) return true;
    if (dynamic) {
      for (const s of dynamicChannels.values()) if (s.subscriptionId === undefined) return true;
      return false;
    }
    return Boolean(channel) && channelCapable && channelSubscriptionId === undefined;
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
  // `chat.subscribe` precedent) — NOT `backendSubscribe`, which is the
  // `events.subscribe` firehose surface. Static form only; the dynamic form
  // registers per id via `registerDynamicChannel`.
  const registerChannel = () => {
    if (!channel || dynamic || !channelCapable) return;
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
        if (id) drainBufferedPushes(id);
        pruneForeignBufferedPushes();
      })
      .catch(() => {
        // Registration failure leaves `live` false, so legacy refetches keep
        // serving — the #775 safety net is never regressed.
      });
  };

  const unregisterChannel = () => {
    if (!channel || dynamic) return;
    // Invalidate any in-flight registration so its late resolve cleans up
    // after itself instead of resurrecting a subscription past teardown.
    channelGeneration += 1;
    if (!channelSubscriptionId) return;
    const id = channelSubscriptionId;
    channelSubscriptionId = undefined;
    void backendRequest(channel.unsubscribeMethod, { subscriptionId: id }).catch(() => {
      // Unsubscribe is best-effort.
    });
  };

  // Live-flip rule for the dynamic form: live ONLY while the id source has
  // reported a non-empty desired set and EVERY desired channel holds a
  // push-confirmed (seeded, gap-free) registration. An empty desired set
  // stays legacy — harmless refetches instead of a push-less "live" that
  // could flash a transiently-empty id source as an empty collection.
  const updateDynamicLive = () => {
    if (!dynamic) return;
    let nowLive = idsInitialized && dynamicChannels.size > 0;
    if (nowLive) {
      for (const s of dynamicChannels.values()) {
        if (!s.seeded || s.awaitingResnapshot) {
          nowLive = false;
          break;
        }
      }
    }
    if (nowLive === live) return;
    live = nowLive;
    refetchEpoch += 1;
  };

  const registerDynamicChannel = (id: string, state: DynamicChannelState<T>) => {
    if (!channel || !dynamic || !channelCapable) return;
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
        if (sid) drainBufferedPushes(sid);
        pruneForeignBufferedPushes();
      })
      .catch(() => {
        // This channel stays unconfirmed, so `live` stays false and legacy
        // refetches keep serving — the #775 safety net is never regressed.
      });
  };

  const unregisterDynamicChannel = (state: DynamicChannelState<T>) => {
    if (!channel) return;
    // Invalidate any in-flight registration so its late resolve cleans up
    // after itself instead of resurrecting a subscription past teardown.
    state.generation += 1;
    const sid = state.subscriptionId;
    state.subscriptionId = undefined;
    if (sid) {
      void backendRequest(channel.unsubscribeMethod, { subscriptionId: sid }).catch(() => {
        // Unsubscribe is best-effort.
      });
    }
  };

  // Per-channel gap recovery: reset just this channel and re-register it for
  // a fresh seq-0 snapshot; sibling channels keep their state. `live` drops
  // (all-channels rule) so a bridging refetch serves until recovery.
  const resnapshotDynamicChannel = (id: string, state: DynamicChannelState<T>) => {
    if (state.awaitingResnapshot) return;
    state.awaitingResnapshot = true;
    state.seeded = false;
    state.reconciler.reset();
    unregisterDynamicChannel(state);
    registerDynamicChannel(id, state);
    updateDynamicLive();
    refetchEmit();
  };

  // The id source reported the FULL desired id set: register channels for new
  // ids, tear down (and evict the entities of) ids that disappeared.
  const reconcileDesiredIds = (ids: readonly string[]) => {
    if (disposed || !channel || !dynamic) return;
    idsInitialized = true;
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
      };
      dynamicChannels.set(id, state);
      registerDynamicChannel(id, state);
      changed = true;
    }
    if (!changed) return;
    const wasLive = live;
    updateDynamicLive();
    // Removal while every remaining channel is confirmed keeps us live and
    // the emit evicts the removed ids' entities. An unconfirmed channel (an
    // addition, or an emptied set) that DROPS us out of live mode bridges
    // the stale window with a one-shot refetch; when we were already legacy
    // the running refetch/legacy-event path keeps serving as-is.
    if (live) emitLive();
    else if (wasLive) refetchEmit();
  };

  // Reconnect-to-resnapshot: drop local state, re-register for a fresh seq-0
  // snapshot, and bridge the stale-UI window with a one-shot refetch.
  const resnapshot = () => {
    if (awaitingResnapshot) return;
    awaitingResnapshot = true;
    // Drop back to legacy mode until the recovery seq-0 snapshot arrives —
    // symmetric with the reconnect reset — so a failed re-register cannot
    // leave legacy refetches suppressed; interim refetches are harmless
    // one-shots and the recovery push immediately re-enters live mode.
    live = false;
    refetchEpoch += 1;
    reconciler.reset();
    if (subscriptionId) void backendUnsubscribe(subscriptionId);
    subscriptionId = undefined;
    unregisterChannel();
    register();
    registerChannel();
    refetchEmit();
  };

  // Route a push (fresh or replayed from the pre-ack buffer) to its channel.
  // Dynamic form: apply against the matching per-id reconciler; the merged
  // collection is only emitted while `live` (all channels confirmed) —
  // otherwise legacy refetches keep serving. Static form: original semantics,
  // including the legacy id as a runtime first-push match target.
  const processPush = (push: SubscriptionPush) => {
    if (disposed) return;
    if (dynamic) {
      for (const [id, state] of dynamicChannels) {
        if (state.subscriptionId !== push.subscriptionId) continue;
        if (push.kind === "snapshot") {
          state.awaitingResnapshot = false;
          state.seeded = true;
          state.reconciler.applySnapshot(push.seq, push.snapshot ?? []);
          updateDynamicLive();
          if (live) emitLive();
        } else if (!state.awaitingResnapshot) {
          if (state.reconciler.applyDelta(push.seq, push.delta ?? {})) {
            if (live) emitLive();
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
    const isOurs =
      (channelSubscriptionId !== undefined && push.subscriptionId === channelSubscriptionId) ||
      (subscriptionId !== undefined && push.subscriptionId === subscriptionId);
    if (!isOurs) {
      if (hasPendingRegistration()) bufferPush(push);
      return;
    }
    if (!live) {
      live = true;
      refetchEpoch += 1;
    }
    if (push.kind === "snapshot") {
      awaitingResnapshot = false;
      reconciler.applySnapshot(push.seq, push.snapshot ?? []);
      emitLive();
    } else if (!awaitingResnapshot) {
      if (reconciler.applyDelta(push.seq, push.delta ?? {})) emitLive();
      else resnapshot();
    }
  };

  // Initial snapshot (legacy behavior; replaced by a push once live).
  refetchEmit();

  const off = onBackendNotification((n) => {
    const push = parseSubscriptionPush(n.method, n.params);
    if (push) {
      processPush(push);
      return;
    }
    // Legacy firehose: only drives a refetch while not in live-state mode, so
    // the two paths never double-apply or diverge (R1 coexistence). Bursts
    // are coalesced — see coalescedRefetchEmit.
    if (!live && matchLegacyEvent(n.method, n.params)) coalescedRefetchEmit();
  });

  // Reconnect (RESUB-1): the daemon dropped its subscription registry on
  // restart, so the stashed id points at nothing. Clear local state, re-
  // register for a fresh seq-0 snapshot, and bridge with a refetch so we
  // converge on anything missed during the outage. Skip the
  // `awaitingResnapshot` early-out so a reconnect racing an in-flight
  // resnapshot still re-registers. `live` drops back to false so a restarted
  // (possibly downgraded) daemon that never pushes again cannot leave legacy
  // refetches suppressed (#775); the next push re-enters live mode.
  const offReconnect = onBackendReconnected(() => {
    if (disposed) return;
    live = false;
    refetchEpoch += 1;
    awaitingResnapshot = false;
    reconciler.reset();
    subscriptionId = undefined;
    // The restarted daemon dropped its registry, so the stale channel id
    // points at nothing — no unsubscribe frame; just re-register. Bump the
    // generation so an in-flight pre-restart registration cannot land.
    channelGeneration += 1;
    channelSubscriptionId = undefined;
    // Pre-restart pushes reference ids from the dropped registry.
    bufferedPushes.length = 0;
    for (const [id, state] of dynamicChannels) {
      state.generation += 1;
      state.subscriptionId = undefined;
      state.seeded = false;
      state.awaitingResnapshot = false;
      state.reconciler.reset();
      registerDynamicChannel(id, state);
    }
    register();
    registerChannel();
    refetchEmit();
  });

  register();

  // Typed channel (opt-in): register only when the hello handshake confirms
  // liveState. The gate is registration-only — `live` still flips solely on
  // an observed push (PR #391 runtime-flip semantics stay intact). The
  // dynamic form additionally waits for the id source before registering.
  let offIds: Unsubscribe | undefined;
  if (channel) {
    detectLiveStateCapability()
      .then((capable) => {
        if (!capable || disposed) return;
        channelCapable = true;
        if (dynamic) offIds = dynamic.subscribeIds(reconcileDesiredIds);
        else registerChannel();
      })
      .catch(() => {
        // Treated as a legacy daemon; refetches keep serving.
      });
  }

  return () => {
    disposed = true;
    if (refetchFollowUpTimer !== undefined) {
      clearTimeout(refetchFollowUpTimer);
      refetchFollowUpTimer = undefined;
    }
    off();
    offReconnect();
    offIds?.();
    if (subscriptionId) void backendUnsubscribe(subscriptionId);
    unregisterChannel();
    for (const state of dynamicChannels.values()) unregisterDynamicChannel(state);
    dynamicChannels.clear();
  };
}
