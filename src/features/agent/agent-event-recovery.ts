import { installAgentMetadataRecovery } from './agent-metadata-recovery';
type UnknownAction = { type: string; payload?: unknown };
import type { RendererRecoveryScope } from '$features/events/renderer-event-recovery';
import type { AgentSession, QueuedMessage } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { RendererRecoveryHandle } from '$features/events/renderer-event-recovery';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { selectPermissionRecoveryScope } from '$store/renderer/slices/permission/permission-selectors';
import { selectWorkspacePermissionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  removePermissionRequest,
  setPendingRequests,
  type PermissionRequest,
} from '$store/renderer/slices/permission/permission-slice';
import {
  deleteSubscriptionUI,
  makeKey,
  setSubscriptionSnapshot,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  mapResult,
  type WireResult,
} from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-snapshot';
import { activeStreamsTracker, type ActiveStream } from './services/active-streams-tracker';
import {
  getAgentFailureEntry,
  listAgentFailureEntries,
  recordAgentFailure,
  removeAgentFailure,
} from './agent-failure-registry';
import {
  clearAgentQueue,
  replaceAgentQueue,
} from '$store/renderer/slices/agent-queue/agent-queue-slice';
import {
  agentQueueRecoveryKey,
  agentSubscriptionsRecoveryKey,
  AGENT_PERMISSIONS_RECOVERY_KEY,
  AGENT_ACTIVE_STREAMS_RECOVERY_KEY,
  AGENT_FAILURES_RECOVERY_KEY,
} from './agent-recovery-keys';

interface Owner {
  isCurrent(): boolean;
  dispatch(action: UnknownAction): unknown;
}

/** Read the queue directly so canonical authority errors reach the recovery owner. */
export function registerAgentQueueRecovery(
  scope: RendererRecoveryScope,
  workspaceId: string,
  agentId: string,
  owner: Owner,
) {
  return scope.registerResource({
    key: agentQueueRecoveryKey(workspaceId, agentId),
    workspaceId,
    eventTypes: ['agent:queue:*', 'agent:deleted', 'agent:delete-scheduled'],
    isCurrent: owner.isCurrent,
    read: ({ request }) =>
      request<{ queue: QueuedMessage[] }>('agent.getQueue', { workspaceId, agentId }),
    apply: ({ queue }) => {
      owner.dispatch(replaceAgentQueue(agentId, queue, workspaceId));
    },
    invalidate: () => {},
    retire: () => {
      owner.dispatch(clearAgentQueue(agentId));
    },
  });
}

/** Update failure mirrors from metadata without replaying failure events or retries. */
export function reconcileAgentFailureSnapshot(sessions: readonly AgentSession[]): void {
  for (const session of sessions) {
    const id = String(session.id);
    if (session.status !== 'error' || session.parentAgentId || session.pendingDeleteAt) {
      removeAgentFailure(id);
      continue;
    }
    if (!session.stopReason) continue;
    const at = Date.parse(session.stopReasonTimestamp ?? '');
    const previous = getAgentFailureEntry(id);
    if (previous?.error === session.stopReason && (!Number.isFinite(at) || previous.at === at))
      continue;
    recordAgentFailure({
      agentId: id,
      workspaceId: session.workspaceId,
      error: session.stopReason,
      ...(Number.isFinite(at) ? { at } : {}),
    });
  }
}

export interface AgentRecoveryStore {
  getState(): StoreState;
  dispatch(action: UnknownAction): unknown;
  subscribe(listener: () => void): () => void;
}

/** Installed once by the admitted global event owner; owns no raw bridge listener. */
export function installAgentEventRecovery(
  scope: RendererRecoveryScope,
  store: AgentRecoveryStore,
): () => void {
  const stopMetadata = installAgentMetadataRecovery(scope, store);
  const handles = new Map<string, RendererRecoveryHandle>();
  const principal = selectPrincipalActionContext.select(store.getState());
  let disposed = false;
  let syncing = false;
  const current = () =>
    !disposed &&
    scope.isCurrent() &&
    principal === selectPrincipalActionContext.select(store.getState());
  const owner: Owner = { isCurrent: current, dispatch: (action) => store.dispatch(action) };
  const active = scope.registerResource({
    key: AGENT_ACTIVE_STREAMS_RECOVERY_KEY,
    workspaceId: null,
    eventTypes: [
      'agent:status-changed',
      'agent:idle',
      'agent:failed',
      'agent:deleted',
      'agent:delete-scheduled',
    ],
    isCurrent: current,
    read: ({ request }) => request<{ streams: ActiveStream[] }>('agent.listActive', {}),
    apply: ({ streams }) => {
      activeStreamsTracker.replaceSnapshot(streams);
    },
    invalidate: () => {},
    retire: () => {
      activeStreamsTracker.replaceSnapshot([]);
    },
  });
  handles.set(AGENT_ACTIVE_STREAMS_RECOVERY_KEY, active);
  const failure = scope.registerResource({
    key: AGENT_FAILURES_RECOVERY_KEY,
    workspaceId: null,
    eventTypes: ['agent:failed', 'agent:status-changed', 'agent:deleted', 'agent:delete-scheduled'],
    isCurrent: current,
    read: async ({ request }) => {
      // This global mirror must also discover a *new* failed agent whose final
      // failure event was lost. The authorized workspace summary is the index;
      // no transcripts or unrestricted agent lists are requested.
      const { workspaces } = await request<{
        workspaces: Array<{
          id: string;
          agentSummary?: { agents?: Array<{ id: string; status: string }> };
        }>;
      }>('workspace.list', { includeArchived: true });
      const targets = new Map(listAgentFailureEntries().map((entry) => [entry.agentId, entry]));
      for (const workspace of workspaces) {
        for (const agent of workspace.agentSummary?.agents ?? []) {
          if (agent.status === 'error' || agent.status === 'failed')
            targets.set(agent.id, {
              agentId: agent.id,
              workspaceId: workspace.id,
              error: '',
              at: 0,
            });
        }
      }
      return Promise.all(
        [...targets.values()].map(async ({ agentId, workspaceId }) => {
          const entry = getAgentFailureEntry(agentId);
          try {
            const result = await request<{ agent: Record<string, unknown> }>('agent.get', {
              agentId,
              workspaceId,
            });
            return { agentId, entry, session: normalizeAgent(result.agent) };
          } catch (error) {
            const e = error as { rpcCode?: number; data?: { code?: string } };
            if (e.rpcCode === -32003 || (e.rpcCode === -32602 && e.data?.code === 'not-found'))
              return { agentId, entry, session: null };
            throw error;
          }
        }),
      );
    },
    apply: (snapshots) => {
      for (const { agentId, entry, session } of snapshots) {
        if (getAgentFailureEntry(agentId) !== entry) continue;
        if (session) reconcileAgentFailureSnapshot([session]);
        else removeAgentFailure(agentId);
      }
    },
    invalidate: () => {},
    retire: () => {
      for (const entry of listAgentFailureEntries()) removeAgentFailure(entry.agentId);
    },
  });
  handles.set(AGENT_FAILURES_RECOVERY_KEY, failure);
  const demands = new Map<
    string,
    { kind: 'queue' | 'subscriptions'; workspaceId: string; agentId: string }
  >();
  let permissionContext: string | null = null;
  let pendingPermissions: PermissionRequest[] = [];
  let permissionReceipt: RecoveryLifetime | undefined;
  const admitPending = () => {
    if (!pendingPermissions.length || !permissionReceipt?.commit(() => undefined)) return;
    const state = store.getState();
    const admitted: PermissionRequest[] = [];
    pendingPermissions = pendingPermissions.filter((request) => {
      const workspaceId = state.agentSessions.byAgentId[request.sessionId]?.workspaceId;
      if (!workspaceId) return true;
      if (selectWorkspacePermissionContext.select(state, workspaceId))
        admitted.push({ ...request, workspaceId });
      return false;
    });
    if (admitted.length)
      permissionReceipt.commit(() => {
        store.dispatch(setPendingRequests(admitted));
      });
  };
  const sync = () => {
    if (syncing || disposed || !scope.isCurrent()) return;
    syncing = true;
    try {
      const state = store.getState();
      if (principal !== selectPrincipalActionContext.select(state)) {
        for (const handle of handles.values()) handle.captureLifetime().isCurrent();
        return;
      }
      const permissionScope = selectPermissionRecoveryScope.select(state);
      if (permissionScope !== permissionContext) {
        handles.get(AGENT_PERMISSIONS_RECOVERY_KEY)?.dispose();
        handles.delete(AGENT_PERMISSIONS_RECOVERY_KEY);
        pendingPermissions = [];
        permissionReceipt = undefined;
        permissionContext = permissionScope;
        for (const request of getItems(state.permission.requests)) {
          if (
            !request.workspaceId ||
            !selectWorkspacePermissionContext.select(state, request.workspaceId)
          )
            store.dispatch(removePermissionRequest(request.requestId));
        }
        if (permissionScope) {
          const permission = scope.registerResource({
            key: AGENT_PERMISSIONS_RECOVERY_KEY,
            workspaceId: null,
            eventTypes: ['agent:permission:*'],
            isCurrent: () =>
              current() &&
              permissionScope === selectPermissionRecoveryScope.select(store.getState()),
            read: ({ request }) =>
              request<{ requests: PermissionRequest[] }>('agent.pendingPermissions', {}),
            apply: ({ requests }) => {
              const latest = store.getState();
              const admitted = requests.flatMap((request) => {
                const workspaceId = latest.agentSessions.byAgentId[request.sessionId]?.workspaceId;
                return workspaceId && selectWorkspacePermissionContext.select(latest, workspaceId)
                  ? [{ ...request, workspaceId }]
                  : [];
              });
              const ids = new Set(admitted.map((request) => request.requestId));
              for (const request of getItems(latest.permission.requests))
                if (!ids.has(request.requestId))
                  store.dispatch(removePermissionRequest(request.requestId));
              store.dispatch(setPendingRequests(admitted));
              pendingPermissions = requests.filter(
                (request) => !latest.agentSessions.byAgentId[request.sessionId],
              );
              permissionReceipt = permission.captureLifetime();
            },
            invalidate: () => {
              pendingPermissions = [];
            },
            retire: () => {
              pendingPermissions = [];
              for (const request of getItems(store.getState().permission.requests))
                store.dispatch(removePermissionRequest(request.requestId));
            },
          });
          handles.set(AGENT_PERMISSIONS_RECOVERY_KEY, permission);
        }
      }
      for (const [agentId, entry] of Object.entries(state.agentQueue.byAgentId)) {
        const workspaceId =
          entry.workspaceId ?? state.agentSessions.byAgentId[agentId]?.workspaceId;
        if (!workspaceId) continue;
        const key = agentQueueRecoveryKey(workspaceId, agentId);
        if (!handles.has(key)) {
          handles.set(key, registerAgentQueueRecovery(scope, workspaceId, agentId, owner));
          demands.set(key, { kind: 'queue', workspaceId, agentId });
        }
        handles.get(key)?.setActive(true);
      }
      for (const session of Object.values(state.agentSessions.byAgentId)) {
        const agentId = String(session.id),
          workspaceId = session.workspaceId;
        if (!state.agentSubscriptionUI.entries[makeKey(workspaceId, agentId)]) continue;
        const key = agentSubscriptionsRecoveryKey(workspaceId, agentId);
        if (handles.has(key)) continue;
        const handle = scope.registerResource({
          key,
          workspaceId,
          eventTypes: ['agent:subscriptions-changed', 'agent:deleted', 'agent:delete-scheduled'],
          isCurrent: current,
          read: ({ request }) =>
            request<WireResult>('agent.getSubscriptions', { workspaceId, agentId }),
          apply: (snapshot) => {
            const mapped = mapResult(snapshot);
            const waiting =
              mapped.subscriptions.length ||
              mapped.delegationGroups.length ||
              mapped.eventSubscriptions?.length;
            store.dispatch(
              setSubscriptionSnapshot(workspaceId, agentId, {
                ...mapped,
                waitingState: waiting ? 'waiting' : 'idle',
              }),
            );
          },
          invalidate: () => {},
          retire: () => {
            store.dispatch(deleteSubscriptionUI(workspaceId, agentId));
          },
        });
        handles.set(key, handle);
        demands.set(key, { kind: 'subscriptions', workspaceId, agentId });
      }
      for (const [key, demand] of demands) {
        const entry = state.agentQueue.byAgentId[demand.agentId];
        const demanded =
          demand.kind === 'queue'
            ? !!entry &&
              (entry.workspaceId ?? state.agentSessions.byAgentId[demand.agentId]?.workspaceId) ===
                demand.workspaceId
            : !!state.agentSubscriptionUI.entries[makeKey(demand.workspaceId, demand.agentId)];
        handles.get(key)?.setActive(demanded);
      }
      admitPending();
    } finally {
      syncing = false;
    }
  };
  const stop = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    stop();
    stopMetadata();
    for (const handle of handles.values()) handle.dispose();
    handles.clear();
  };
}
