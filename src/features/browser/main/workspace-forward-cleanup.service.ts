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

async function subscribeToWorkspaceEvents(): Promise<void> {
  if (subscriptionId !== undefined || subscribeInFlight) return;
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
  }
}

/**
 * Idempotent start/retry: attaches the backend listeners once (first call
 * wins the deps) and re-attempts a failed/absent subscription on every call.
 */
export function ensureWorkspaceForwardCleanup(cleanupDeps: WorkspaceForwardCleanupDeps): void {
  if (!deps) deps = cleanupDeps;
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
}
