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
 * live-state). Once live, legacy events are ignored to avoid double-application.
 * A sequence gap (or an unseeded delta) triggers reconnect-to-resnapshot: the
 * reconciler resets and the subscription re-registers to obtain a fresh seq-0
 * snapshot, with a one-shot refetch bridging the stale-UI window.
 */
import type { SubscriptionHandler, Unsubscribe } from "../app-client";
import {
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
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

/** Configuration for {@link createDeltaSubscription}. */
export interface DeltaSubscriptionConfig<T> {
  /** Daemon event types for the coexisting legacy `events.subscribe` firehose. */
  eventTypes: string[];
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
 * Wire a dual-mode subscription: serves the legacy one-shot refetch until the
 * daemon proves live-state by sending a `subscription.push` for our id, then
 * reconciles snapshots/deltas incrementally. Returns the disposer.
 */
export function createDeltaSubscription<T>(config: DeltaSubscriptionConfig<T>): Unsubscribe {
  const { eventTypes, fetchAll, getId, normalize, matchLegacyEvent, handler } = config;
  const reconciler = new DeltaReconciler<T>(getId, normalize);

  let disposed = false;
  let live = false;
  let awaitingResnapshot = false;
  let subscriptionId: string | undefined;

  const emitLive = () => {
    if (!disposed) handler(reconciler.values());
  };

  const refetchEmit = () => {
    fetchAll()
      .then((items) => {
        if (!disposed) handler(items);
      })
      .catch(() => {
        // Refresh failures are non-fatal for the subscription.
      });
  };

  const register = () => {
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we still serve the refetch fallback.
      });
  };

  // Reconnect-to-resnapshot: drop local state, re-register for a fresh seq-0
  // snapshot, and bridge the stale-UI window with a one-shot refetch.
  const resnapshot = () => {
    if (awaitingResnapshot) return;
    awaitingResnapshot = true;
    reconciler.reset();
    if (subscriptionId) void backendUnsubscribe(subscriptionId);
    subscriptionId = undefined;
    register();
    refetchEmit();
  };

  // Initial snapshot (legacy behavior; replaced by a push once live).
  refetchEmit();

  const off = onBackendNotification((n) => {
    const push = parseSubscriptionPush(n.method, n.params);
    if (push) {
      // Ignore pushes for other channels (or before our id resolves).
      if (!subscriptionId || push.subscriptionId !== subscriptionId) return;
      live = true;
      if (push.kind === "snapshot") {
        awaitingResnapshot = false;
        reconciler.applySnapshot(push.seq, push.snapshot ?? []);
        emitLive();
      } else if (!awaitingResnapshot) {
        if (reconciler.applyDelta(push.seq, push.delta ?? {})) emitLive();
        else resnapshot();
      }
      return;
    }
    // Legacy firehose: only drives a refetch while not in live-state mode, so
    // the two paths never double-apply or diverge (R1 coexistence).
    if (!live && matchLegacyEvent(n.method, n.params)) refetchEmit();
  });

  register();

  return () => {
    disposed = true;
    off();
    if (subscriptionId) void backendUnsubscribe(subscriptionId);
  };
}
