/**
 * PR-monitor read/cancel/flush surface (PROTOCOL v6.1, §6.9).
 *
 * Monitors are agent-owned (`ws.pr.monitor` is MCP-only); the FE reads via
 * `prMonitor.list`, cancels via `prMonitor.cancel`, flushes the pending
 * debounced changes via `prMonitor.flush`, and stays live by folding the
 * `prMonitor:*` event family into the list. Like `hook:*`, the family is not
 * part of the bridge firehose's bare-category expansion, so this module owns
 * its own `events.subscribe` with a `prMonitor:*` prefix filter, scoped to
 * one workspace.
 */
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PrMonitorService');

/** `lastSnapshot` merge-requirements projection (`prMonitor.list` rows). */
export interface PrMonitorSnapshot {
  state: string;
  isDraft: boolean;
  hasConflicts: boolean;
  isBehind: boolean;
  mergeable?: boolean | null;
  mergeBlockedReason?: string | null;
  checks: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    failingRequired: number;
    pendingRequired: number;
    /** "required" flags are only meaningful when true. */
    requiredKnown: boolean;
  };
  approvals: {
    decision: string;
    have: number;
    needed?: number | null;
    changesRequested: number;
  };
  threads: {
    unresolved: number;
    resolutionRequired?: boolean | null;
  };
  /** Additive: present (true) when the host reports the PR queued to merge;
   * absent when not queued or unknown. */
  isInMergeQueue?: boolean;
  rulesKnown: boolean;
}

/** Wire `prMonitor.list` row. Cancelled monitors are excluded server-side;
 * `title`/`url`/`lastSnapshot` are absent until the first successful poll. */
export interface PrMonitorRow {
  monitorId: string;
  workspaceId: string;
  agentId: string;
  /** `<owner>/<name>`. */
  repo: string;
  prNumber: number;
  state: 'active' | 'completed';
  pendingChanges: string[];
  hasPendingChanges: boolean;
  createdAt: string;
  updatedAt: string;
  pendingSince?: string;
  lastChangeAt?: string;
  lastPolledAt?: string;
  lastError?: string;
  title?: string;
  url?: string;
  lastSnapshot?: PrMonitorSnapshot;
}

/** `prMonitor:*` event payload (§6.5): canonical identity fields plus
 * per-type extras (`changes` on `prMonitor:changed`). */
export interface PrMonitorEventData {
  workspaceId?: string;
  agentId?: string;
  monitorId?: string;
  repo?: string;
  prNumber?: number;
  state?: string;
  changes?: string[];
}

export interface PrMonitorFoldResult {
  monitors: PrMonitorRow[];
  /** The event referenced an unknown monitor, or carried a change the list
   * cannot reconstruct (`lastSnapshot` never rides events) — re-run
   * `prMonitor.list` to converge. */
  needsRefetch: boolean;
}

/**
 * Pure fold of one `prMonitor:*` event into the current monitor list.
 * Events carry identity + state but never the snapshot/title fields, so
 * snapshot-bearing transitions request a refetch to converge.
 */
export function foldPrMonitorEvent(
  monitors: PrMonitorRow[],
  eventType: string,
  data: PrMonitorEventData,
): PrMonitorFoldResult {
  const monitorId = data.monitorId;
  if (!monitorId) return { monitors, needsRefetch: false };

  if (eventType === 'prMonitor:cancelled') {
    const next = monitors.filter((m) => m.monitorId !== monitorId);
    return { monitors: next, needsRefetch: false };
  }

  const existing = monitors.find((m) => m.monitorId === monitorId);
  if (!existing) return { monitors, needsRefetch: true };

  switch (eventType) {
    case 'prMonitor:registered':
      return {
        monitors: monitors.map((m) =>
          m.monitorId === monitorId ? { ...m, state: 'active' as const } : m,
        ),
        needsRefetch: false,
      };
    case 'prMonitor:changed':
      // `changes` is the full accumulated pending list; the refreshed
      // lastSnapshot only arrives via prMonitor.list.
      return {
        monitors: monitors.map((m) =>
          m.monitorId === monitorId
            ? {
                ...m,
                pendingChanges: data.changes ?? m.pendingChanges,
                hasPendingChanges: (data.changes ?? m.pendingChanges).length > 0,
              }
            : m,
        ),
        needsRefetch: true,
      };
    case 'prMonitor:emitted':
      return {
        monitors: monitors.map((m) =>
          m.monitorId === monitorId ? { ...m, pendingChanges: [], hasPendingChanges: false } : m,
        ),
        needsRefetch: false,
      };
    case 'prMonitor:completed':
      // Terminal PR lifecycle (merged/closed): the row stays listed but the
      // final snapshot only arrives via prMonitor.list.
      return {
        monitors: monitors.map((m) =>
          m.monitorId === monitorId
            ? { ...m, state: 'completed' as const, pendingChanges: [], hasPendingChanges: false }
            : m,
        ),
        needsRefetch: true,
      };
    default:
      return { monitors, needsRefetch: false };
  }
}

/** `prMonitor.list` (§6.9) — active + completed monitors in the workspace. */
export async function listPrMonitors(workspaceId: string): Promise<PrMonitorRow[]> {
  const result = await backendRequest<{ monitors?: PrMonitorRow[] }>('prMonitor.list', {
    workspaceId,
  });
  return Array.isArray(result?.monitors) ? result.monitors : [];
}

/** `prMonitor.cancel` (§6.9) — the `prMonitor:cancelled` event drops the row. */
export async function cancelPrMonitor(workspaceId: string, monitorId: string): Promise<void> {
  await backendRequest('prMonitor.cancel', { workspaceId, monitorId });
}

/** `prMonitor.flush` (§6.9) — deliver the pending debounced changes now;
 * a no-op (`flushed: false`) when nothing is pending. `check: true` (§5.42,
 * additive) makes the daemon re-poll the PR first and flush anything that
 * changed vs. the emit baseline; omitted, semantics are unchanged. */
export async function flushPrMonitor(
  workspaceId: string,
  monitorId: string,
  check?: boolean,
): Promise<void> {
  await backendRequest('prMonitor.flush', {
    workspaceId,
    monitorId,
    ...(check !== undefined ? { check } : {}),
  });
}

/** `events.event` envelope subset this module consumes (§6.3). */
interface PrMonitorEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: PrMonitorEventData };
}

/** Handle returned by {@link subscribePrMonitors}. */
export interface PrMonitorsSubscription {
  /** On-demand `prMonitor.list` re-seed — e.g. to refresh `lastSnapshot`,
   * which `prMonitor:*` events never carry. */
  refetch: () => void;
  /** Tear down the subscription and notification listeners. */
  dispose: () => void;
}

/**
 * Live monitor list for one workspace: registers a `prMonitor:*`
 * `events.subscribe` with the `prMonitor.list` seed issued concurrently
 * (single RTT; an unconditional post-ack re-list — coalesced into the
 * in-flight seed's trailing run — closes the event-gap race), folds
 * subsequent events, and re-seeds after a backend reconnect (RESUB-1). The handler receives the full list on every change
 * (active + completed — callers filter). Returns a handle exposing an
 * on-demand `refetch` plus the disposer.
 */
export function subscribePrMonitors(
  workspaceId: string,
  handler: (monitors: PrMonitorRow[]) => void,
): PrMonitorsSubscription {
  let disposed = false;
  let subscriptionId: string | undefined;
  let monitors: PrMonitorRow[] = [];
  let refetchInFlight = false;
  let refetchQueued = false;
  // Monitors cancelled by a fold: a `prMonitor.list` response that was already
  // in flight when the `prMonitor:cancelled` event arrived can still carry the
  // row, so list responses filter these until the server stops returning them.
  const locallyCancelled = new Set<string>();
  // Guards against a late-resolving subscribe from a previous registration
  // (e.g. rapid reconnect flaps) overwriting the current subscriptionId.
  let registerEpoch = 0;

  const emit = () => {
    if (!disposed) handler(monitors);
  };

  const refetch = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (refetchInFlight) {
      refetchQueued = true;
      return Promise.resolve();
    }
    refetchInFlight = true;
    return listPrMonitors(workspaceId)
      .then((fetched) => {
        if (disposed) return;
        // Prune ids the server no longer returns (converged), then drop rows
        // cancelled locally while this list was in flight.
        for (const id of [...locallyCancelled]) {
          if (!fetched.some((m) => m.monitorId === id)) locallyCancelled.delete(id);
        }
        monitors = fetched.filter((m) => !locallyCancelled.has(m.monitorId));
        emit();
      })
      .catch((error) => {
        logger.warn('prMonitor.list failed', { workspaceId, error });
        // Still emit the cached list (empty on a failed initial seed) so the
        // consumer's workspace entry exists: the utility-footer readiness
        // gate treats a failed seed as ready-with-empty and never wedges
        // the reveal.
        emit();
      })
      .finally(() => {
        refetchInFlight = false;
        if (refetchQueued) {
          refetchQueued = false;
          refetch();
        }
      });
  };

  const register = () => {
    const epoch = ++registerEpoch;
    // Seed CONCURRENTLY with the subscribe (~1 RTT instead of 2 serial RTTs).
    // Event-gap race: response ordering proves nothing about SNAPSHOT
    // ordering — the list handler can snapshot before the subscription
    // window opens yet respond after the ack — so the ack handler always
    // re-lists. `refetch` is single-flight with a trailing coalesce: a seed
    // still in flight absorbs the re-list into one trailing `prMonitor.list`
    // that starts after the seed settles, converging every ordering. Folds
    // landing while a list is in flight are covered by the notification
    // handler's trailing-refetch clause.
    void refetch();
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ['prMonitor:*'], workspaceId })
      .then((result) => {
        const acked = result?.subscriptionId;
        if (disposed || epoch !== registerEpoch) {
          // Stale registration (disposed or superseded by a reconnect) —
          // drop the ack and release its server-side subscription.
          if (acked) void backendUnsubscribe(acked);
          return;
        }
        subscriptionId = acked;
        void refetch();
      })
      .catch((error) => {
        logger.warn('events.subscribe (prMonitor:*) failed', { workspaceId, error });
        // The concurrent seed already serves the one-shot snapshot.
      });
  };

  const offNotification = onBackendNotification((n) => {
    if (disposed || n.method !== 'events.event') return;
    const params = n.params as PrMonitorEventNotification | undefined;
    const event = params?.event;
    if (!event?.type?.startsWith('prMonitor:')) return;
    if (event.workspaceId !== workspaceId) return;
    // Match on our subscription id once known; before the ack lands, accept
    // any prMonitor event for this workspace (the folds are idempotent).
    if (subscriptionId && params?.subscriptionId && params.subscriptionId !== subscriptionId) {
      return;
    }
    const result = foldPrMonitorEvent(monitors, event.type, event.data ?? {});
    monitors = result.monitors;
    if (event.type === 'prMonitor:cancelled' && event.data?.monitorId) {
      locallyCancelled.add(event.data.monitorId);
    }
    emit();
    // A fold landing while a list request is in flight would be clobbered by
    // that older response — queue a trailing refetch (single-flight,
    // coalesced) so the list converges.
    if (result.needsRefetch || refetchInFlight) refetch();
  });

  // Subscriptions are per-connection (§6.1) — replay after a reconnect and
  // re-seed so anything missed during the outage converges.
  const offReconnected = onBackendReconnected(() => {
    if (disposed) return;
    subscriptionId = undefined;
    register();
  });

  register();

  return {
    refetch,
    dispose: () => {
      disposed = true;
      offNotification();
      offReconnected();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    },
  };
}
