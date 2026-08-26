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
 * Started lazily per originating backend client from browser.ipc.ts the first
 * time its tunnel provider is handed out. Each client owns its subscription,
 * reconnect, and reconciliation state; a pooled-client disconnect tears down
 * only that state. Every mint re-runs the idempotent subscribe so a transient
 * initial failure self-heals.
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
import type { JsonRpcClient, JsonRpcNotification } from '../../backend/main/json-rpc-client';
import type { ForwardOwnershipRegistry } from './tunnel-forward-ownership';
import type { TunnelProvider } from './loopback-url-resolver';

const logger = new Logger('WorkspaceForwardCleanup');

export interface WorkspaceForwardCleanupDeps {
  registry: ForwardOwnershipRegistry;
  /** Close the forward on the exact provider that owned it. */
  closeForward: (remotePort: number, provider?: TunnelProvider) => void;
  /** Originating pooled client; defaults to the primary client for legacy callers. */
  client?: JsonRpcClient;
  /** Backend id used to scope stable notification/reconnect listeners. */
  backendId?: string;
  /** Provider owned by this client and cleanup state. */
  provider?: TunnelProvider;
}

class WorkspaceForwardCleanupState {
  readonly providers = new Set<TunnelProvider>();
  private subscriptionId: string | undefined;
  private subscribeEpoch = 0;
  private subscribeInFlight = false;
  private reconcileInFlight = false;
  private reconcileQueued = false;
  private reconcileFailed = false;
  private disposed = false;
  private readonly disposeNotification: () => void;
  private readonly disposeReconnect: () => void;

  constructor(private readonly deps: WorkspaceForwardCleanupDeps & { client: JsonRpcClient }) {
    if (deps.provider) this.providers.add(deps.provider);
    this.disposeNotification = onBackendNotification(
      (notification) => this.handleBackendNotification(notification),
      deps.backendId,
    );
    this.disposeReconnect = onBackendReconnected(() => this.handleReconnect(), deps.backendId);
  }

  addProvider(provider?: TunnelProvider): void {
    if (provider) this.providers.add(provider);
  }

  ensure(): void {
    void this.subscribeToWorkspaceEvents();
  }

  dispose(): void {
    this.disposed = true;
    this.subscribeEpoch += 1;
    this.disposeNotification();
    this.disposeReconnect();
  }

  reconcile(): void {
    void this.reconcileOwnedForwards();
  }

  private cleanupWorkspace(workspaceId: string, reason: 'archived' | 'deleted'): void {
    const providers = this.providers.size > 0 ? this.providers : undefined;
    const forwards = this.deps.registry.releaseWorkspaceForProviders(workspaceId, providers);
    for (const { provider, remotePort } of forwards) {
      try {
        if (provider) this.deps.closeForward(remotePort, provider);
        else this.deps.closeForward(remotePort);
      } catch (error) {
        logger.warn('closing a workspace-owned tunnel forward failed', {
          workspaceId,
          remotePort,
          error: (error as Error).message,
        });
      }
    }
    if (forwards.length > 0) {
      const remotePorts = forwards.map(({ remotePort }) => remotePort);
      logger.info('closed workspace-owned tunnel forwards', { workspaceId, reason, remotePorts });
    }
  }

  private handleBackendNotification(n: JsonRpcNotification): void {
    if (n.method !== 'events.event') return;
    const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
    const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
    if (!this.subscriptionId || subId !== this.subscriptionId) return;
    const event = params?.event as { type?: unknown; data?: unknown } | undefined;
    if (!event) return;
    const data = event.data as { workspaceId?: unknown; changes?: unknown } | undefined;
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
    if (!workspaceId) return;
    if (event.type === 'workspace:deleted') {
      this.cleanupWorkspace(workspaceId, 'deleted');
      return;
    }
    if (event.type !== 'workspace:updated') return;
    const changes = data?.changes as { status?: unknown; archived?: unknown } | undefined;
    if (changes?.archived === true || changes?.status === 'Archived') {
      this.cleanupWorkspace(workspaceId, 'archived');
    }
  }

  private async runReconcilePass(): Promise<void> {
    if (this.disposed) return;
    const providers = this.providers.size > 0 ? this.providers : undefined;
    const ownedIds = this.deps.registry.ownedWorkspaceIds(providers);
    if (ownedIds.length === 0) {
      this.reconcileFailed = false;
      return;
    }
    const epoch = this.subscribeEpoch;
    let workspaces: unknown[];
    try {
      const result = (await this.deps.client.request('workspace.list', {
        includeArchived: true,
      })) as { workspaces?: unknown[] } | undefined;
      if (!Array.isArray(result?.workspaces)) {
        logger.warn('workspace.list for forward reconciliation returned no workspaces array');
        this.reconcileFailed = true;
        return;
      }
      workspaces = result.workspaces;
    } catch (error) {
      logger.warn('workspace.list for forward reconciliation failed', {
        error: (error as Error).message,
      });
      this.reconcileFailed = true;
      return;
    }
    if (this.disposed || epoch !== this.subscribeEpoch) return;
    const archivedById = new Map<string, boolean>();
    for (const raw of workspaces) {
      const row = raw as { id?: unknown; archived?: unknown; status?: unknown } | undefined;
      if (typeof row?.id !== 'string') {
        logger.warn('workspace.list for forward reconciliation returned a malformed row');
        this.reconcileFailed = true;
        return;
      }
      archivedById.set(row.id, row.archived === true || row.status === 'Archived');
    }
    this.reconcileFailed = false;
    for (const workspaceId of ownedIds) {
      const archived = archivedById.get(workspaceId);
      if (archived === undefined) this.cleanupWorkspace(workspaceId, 'deleted');
      else if (archived) this.cleanupWorkspace(workspaceId, 'archived');
    }
  }

  private async reconcileOwnedForwards(): Promise<void> {
    if (this.disposed) return;
    if (this.reconcileInFlight) {
      this.reconcileQueued = true;
      return;
    }
    this.reconcileInFlight = true;
    try {
      do {
        this.reconcileQueued = false;
        await this.runReconcilePass();
      } while (this.reconcileQueued && !this.disposed);
    } finally {
      this.reconcileInFlight = false;
    }
  }

  private async subscribeToWorkspaceEvents(): Promise<void> {
    if (this.disposed) return;
    if (this.subscriptionId !== undefined || this.subscribeInFlight) {
      if (this.subscriptionId !== undefined && this.reconcileFailed) this.reconcile();
      return;
    }
    this.subscribeInFlight = true;
    const epoch = this.subscribeEpoch;
    try {
      const result = (await this.deps.client.request('events.subscribe', {
        eventTypes: ['workspace:updated', 'workspace:deleted'],
      })) as { subscriptionId?: string } | undefined;
      if (this.disposed || epoch !== this.subscribeEpoch) return;
      this.subscriptionId = result?.subscriptionId;
      if (!this.subscriptionId) {
        logger.warn('events.subscribe for workspace forward cleanup returned no subscriptionId');
      }
    } catch (error) {
      logger.warn('events.subscribe for workspace forward cleanup failed', {
        error: (error as Error).message,
      });
    } finally {
      if (epoch === this.subscribeEpoch) this.subscribeInFlight = false;
      this.reconcile();
    }
  }

  private handleReconnect(): void {
    this.subscribeEpoch += 1;
    this.subscriptionId = undefined;
    this.subscribeInFlight = false;
    void this.subscribeToWorkspaceEvents();
  }
}

const cleanupStates = new Map<JsonRpcClient, WorkspaceForwardCleanupState>();
const registryStates = new Map<ForwardOwnershipRegistry, Set<WorkspaceForwardCleanupState>>();

function attachRegistryState(
  registry: ForwardOwnershipRegistry,
  state: WorkspaceForwardCleanupState,
): void {
  let states = registryStates.get(registry);
  if (!states) {
    states = new Set();
    registryStates.set(registry, states);
    registry.onWorkspaceOwnerRecorded = (provider) => {
      for (const candidate of registryStates.get(registry) ?? []) {
        if (!provider || candidate.providers.has(provider)) candidate.reconcile();
      }
    };
  }
  states.add(state);
}

/**
 * Idempotent per-client start/retry; re-attempts a failed/absent subscription
 * on every provider handout.
 */
export function ensureWorkspaceForwardCleanup(cleanupDeps: WorkspaceForwardCleanupDeps): void {
  const client = cleanupDeps.client ?? getBackendClient();
  let state = cleanupStates.get(client);
  if (!state) {
    state = new WorkspaceForwardCleanupState({ ...cleanupDeps, client });
    cleanupStates.set(client, state);
    attachRegistryState(cleanupDeps.registry, state);
  }
  state.addProvider(cleanupDeps.provider);
  state.ensure();
}

/** Tear down only one pooled client's listeners/subscription state. */
export function disposeWorkspaceForwardCleanupForClient(client: JsonRpcClient): void {
  const state = cleanupStates.get(client);
  if (!state) return;
  cleanupStates.delete(client);
  state.dispose();
  for (const [registry, states] of registryStates) {
    states.delete(state);
    if (states.size === 0) {
      registry.onWorkspaceOwnerRecorded = undefined;
      registryStates.delete(registry);
    }
  }
}

/** Tear down all client-scoped cleanup listeners/subscription state. */
export function resetWorkspaceForwardCleanup(): void {
  for (const client of [...cleanupStates.keys()]) disposeWorkspaceForwardCleanupForClient(client);
}

/** Test-only alias. */
export const __resetWorkspaceForwardCleanupForTesting = resetWorkspaceForwardCleanup;
