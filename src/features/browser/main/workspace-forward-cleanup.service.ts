/**
 * Workspace Forward Cleanup Service
 *
 * Closes tunnel forwards whose owning workspaces have all been archived or
 * deleted. Listens for `workspace:updated` (archive transitions) and
 * `workspace:deleted` daemon events on its own `events.subscribe` with a
 * strict subscription-id match — same pattern as workspace-path.service.ts —
 * and asks the {@link ForwardOwnershipRegistry} which ports lost their last
 * owner (refcount semantics; app-lifetime forwards are never touched).
 *
 * Started lazily from browser.ipc.ts the first time a tunnel provider is
 * handed out: forwards only need cleanup once one has been minted, and every
 * mint re-runs the (idempotent) subscribe so a transient initial failure
 * self-heals. On backend reconnect the subscription is replayed; the registry
 * itself is only reset on backend switch (browser.ipc.ts), where the
 * providers — and their forwards — are disposed anyway.
 *
 * Events alone are not enough (monorepo#2646): archive/delete events fired
 * while the client was disconnected (or before a subscribe resolved) are
 * lost, and a forward recorded after its owner's archive event slipped past
 * the event-driven cleanup. A reconciliation pass — fetch the daemon's
 * current workspaces (`workspace.list { includeArchived: true }`) and
 * release owners that are archived or gone, closing forwards left with no
 * owner — therefore runs after every subscribe attempt settles (initial
 * ensure + reconnect resubscribe), whenever a new workspace owner is
 * recorded (covering the record-after-archive race without waiting for a
 * reconnect), and on the next ensure call after a failed pass. Passes are
 * single-flight with trailing coalesce, so trigger bursts collapse into at
 * most one follow-up `workspace.list`.
 */

import { Logger } from '../../../shared/logger';
import {
  getBackendClient,
  onBackendNotification,
  onBackendReconnected,
} from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';
import type { ForwardOwnershipRegistry } from './tunnel-forward-ownership';

const logger = new Logger('WorkspaceForwardCleanup');

export interface WorkspaceForwardCleanupDeps {
  registry: ForwardOwnershipRegistry;
  /** Close the forward for `remotePort` on the live provider(s). */
  closeForward: (remotePort: number) => void;
}

let deps: WorkspaceForwardCleanupDeps | undefined;
let listenersAttached = false;
let subscriptionId: string | undefined;
// Epoch guard: bumped on reconnect so a pre-reconnect `events.subscribe`
// response resolving late can never overwrite the current connection's
// subscription id (same rationale as workspace-path.service.ts).
let subscribeEpoch = 0;
let subscribeInFlight = false;
// Reconciliation is single-flight with a trailing coalesce: triggers landing
// while a pass is in flight collapse into at most one follow-up pass.
let reconcileInFlight = false;
let reconcileQueued = false;
// Set when a pass aborted on a failed/malformed workspace.list so the next
// ensureWorkspaceForwardCleanup call retries even while the subscription is
// still active (subscribeToWorkspaceEvents early-returns in that case).
let reconcileFailed = false;

function cleanupWorkspace(workspaceId: string, reason: 'archived' | 'deleted'): void {
  if (!deps) return;
  const remotePorts = deps.registry.releaseWorkspace(workspaceId);
  for (const remotePort of remotePorts) {
    try {
      deps.closeForward(remotePort);
    } catch (error) {
      logger.warn('closing a workspace-owned tunnel forward failed', {
        workspaceId,
        remotePort,
        error: (error as Error).message,
      });
    }
  }
  if (remotePorts.length > 0) {
    logger.info('closed workspace-owned tunnel forwards', { workspaceId, reason, remotePorts });
  }
}

function handleBackendNotification(n: JsonRpcNotification): void {
  if (n.method !== 'events.event') return;
  const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
  const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
  // Strict match: the shared client also carries notifications for
  // renderer-proxied subscriptions; only our own subscription's events count.
  if (!subscriptionId || subId !== subscriptionId) return;
  const event = params?.event as { type?: unknown; data?: unknown } | undefined;
  if (!event) return;
  const data = event.data as { workspaceId?: unknown; changes?: unknown } | undefined;
  const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
  if (!workspaceId) return;
  if (event.type === 'workspace:deleted') {
    cleanupWorkspace(workspaceId, 'deleted');
    return;
  }
  if (event.type !== 'workspace:updated') return;
  // Archive detection mirrors the renderer bridge: the wire delta carries
  // `changes.archived` / `changes.status` only when they actually changed.
  const changes = data?.changes as { status?: unknown; archived?: unknown } | undefined;
  if (changes?.archived === true || changes?.status === 'Archived') {
    cleanupWorkspace(workspaceId, 'archived');
  }
}

/**
 * One reconciliation pass (monorepo#2646): fetch every workspace (archived
 * included) and release forward ownership for owners that are archived or no
 * longer exist — the daemon's current state stands in for any archive/delete
 * events lost while disconnected, and sweeps ownership recorded after its
 * owner's archive event (the record-after-archive race).
 */
async function runReconcilePass(): Promise<void> {
  if (!deps) return;
  const ownedIds = deps.registry.ownedWorkspaceIds();
  if (ownedIds.length === 0) {
    reconcileFailed = false;
    return;
  }
  const epoch = subscribeEpoch;
  let workspaces: unknown[];
  try {
    const result = (await getBackendClient().request('workspace.list', {
      includeArchived: true,
    })) as { workspaces?: unknown[] } | undefined;
    if (!Array.isArray(result?.workspaces)) {
      // Never treat a malformed response as everything-deleted.
      logger.warn('workspace.list for forward reconciliation returned no workspaces array');
      reconcileFailed = true;
      return;
    }
    workspaces = result.workspaces;
  } catch (error) {
    // Best-effort: retried on the next reconnect/ensure/record trigger.
    logger.warn('workspace.list for forward reconciliation failed', {
      error: (error as Error).message,
    });
    reconcileFailed = true;
    return;
  }
  // A reconnect happened while the list was in flight: the response describes
  // the previous connection's backend — drop it; the reconnect-triggered
  // reconciliation runs against the new one.
  if (epoch !== subscribeEpoch) return;
  const archivedById = new Map<string, boolean>();
  for (const raw of workspaces) {
    const row = raw as { id?: unknown; archived?: unknown; status?: unknown } | undefined;
    if (typeof row?.id !== 'string') {
      // A row without a string id means the response shape is off — abort
      // rather than misclassify the ids it should have carried as deleted.
      logger.warn('workspace.list for forward reconciliation returned a malformed row');
      reconcileFailed = true;
      return;
    }
    archivedById.set(row.id, row.archived === true || row.status === 'Archived');
  }
  reconcileFailed = false;
  for (const workspaceId of ownedIds) {
    const archived = archivedById.get(workspaceId);
    if (archived === undefined) {
      cleanupWorkspace(workspaceId, 'deleted');
    } else if (archived) {
      cleanupWorkspace(workspaceId, 'archived');
    }
  }
}

async function reconcileOwnedForwards(): Promise<void> {
  if (reconcileInFlight) {
    reconcileQueued = true;
    return;
  }
  reconcileInFlight = true;
  try {
    do {
      reconcileQueued = false;
      await runReconcilePass();
    } while (reconcileQueued);
  } finally {
    reconcileInFlight = false;
  }
}

async function subscribeToWorkspaceEvents(): Promise<void> {
  if (subscriptionId !== undefined || subscribeInFlight) {
    // Already subscribed (or a subscribe is settling, whose finally kicks a
    // reconcile) — but a previously failed reconciliation still needs a
    // retry path while the subscription stays active.
    if (subscriptionId !== undefined && reconcileFailed) void reconcileOwnedForwards();
    return;
  }
  subscribeInFlight = true;
  const epoch = subscribeEpoch;
  try {
    const result = (await getBackendClient().request('events.subscribe', {
      eventTypes: ['workspace:updated', 'workspace:deleted'],
    })) as { subscriptionId?: string } | undefined;
    // A reconnect happened while this request was in flight: the result
    // belongs to the previous connection — drop it.
    if (epoch !== subscribeEpoch) return;
    subscriptionId = result?.subscriptionId;
    if (!subscriptionId) {
      logger.warn('events.subscribe for workspace forward cleanup returned no subscriptionId');
    }
  } catch (error) {
    // Best-effort: retried on the next ensureWorkspaceForwardCleanup call
    // (every tunnel-provider handout) and on reconnect.
    logger.warn('events.subscribe for workspace forward cleanup failed', {
      error: (error as Error).message,
    });
  } finally {
    if (epoch === subscribeEpoch) subscribeInFlight = false;
    // Reconcile after every subscribe attempt settles — success or failure:
    // it covers events lost during an outage (reconnect resubscribe), events
    // fired before the first subscribe resolved, and the record-after-archive
    // race (monorepo#2646). Ordered after the subscribe so live events take
    // over from where the reconciliation snapshot leaves off.
    void reconcileOwnedForwards();
  }
}

/**
 * Idempotent start/retry: attaches the backend listeners once (first call
 * wins the deps) and re-attempts a failed/absent subscription on every call.
 */
export function ensureWorkspaceForwardCleanup(cleanupDeps: WorkspaceForwardCleanupDeps): void {
  if (!deps) {
    deps = cleanupDeps;
    // A workspace owner recorded after its archive/delete event already
    // fired (the record-after-archive race, monorepo#2646) would otherwise
    // sit unexamined until the next reconnect — sweep it with a
    // reconciliation pass keyed off the record itself. Single-flight with
    // trailing coalesce keeps a mint burst at one trailing workspace.list.
    deps.registry.onWorkspaceOwnerRecorded = () => {
      void reconcileOwnedForwards();
    };
  }
  if (!listenersAttached) {
    listenersAttached = true;
    onBackendNotification(handleBackendNotification);
    onBackendReconnected(() => {
      // The daemon dropped in-memory subscriptions — re-subscribe. The epoch
      // bump invalidates any in-flight pre-reconnect subscribe response.
      subscribeEpoch += 1;
      subscriptionId = undefined;
      subscribeInFlight = false;
      void subscribeToWorkspaceEvents();
    });
  }
  void subscribeToWorkspaceEvents();
}

/** Test-only: reset module state (deps, listeners, subscription). */
export function __resetWorkspaceForwardCleanupForTesting(): void {
  deps = undefined;
  listenersAttached = false;
  subscriptionId = undefined;
  subscribeEpoch = 0;
  subscribeInFlight = false;
  reconcileInFlight = false;
  reconcileQueued = false;
  reconcileFailed = false;
}
