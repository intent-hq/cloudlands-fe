import {
  bindAgentRecoveryReadOwner,
  trackAgentRecoveryRead,
  isAgentReadAuthorityError,
} from './agent-recovery-read-lane';
import { installAgentRecoveryWorkspaceScope } from './agent-recovery-workspace-scope';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
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
  subscribeToAgentFailures,
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
  const key = agentQueueRecoveryKey(workspaceId, agentId);
  let unbind = () => {};
  const handle = scope.registerResource({
    key,
    workspaceId,
    eventTypes: ['agent:queue:*', 'agent:deleted', 'agent:delete-scheduled'],
    isCurrent: owner.isCurrent,
    read: ({ request, lifetime }) =>
      trackAgentRecoveryRead(
        agentQueueRecoveryKey(workspaceId, agentId),
        () => request<{ queue: QueuedMessage[] }>('agent.getQueue', { workspaceId, agentId }),
        lifetime,
      ),
    apply: ({ queue }) => {
      owner.dispatch(replaceAgentQueue(agentId, queue, workspaceId));
    },
    invalidate: () => {},
    retire: () => {
      unbind();
      owner.dispatch(clearAgentQueue(agentId));
    },
  });
  unbind = bindAgentRecoveryReadOwner(key, scope);
  return {
    ...handle,
    get status() {
      return handle.status;
    },
    dispose: () => {
      unbind();
      handle.dispose();
    },
  };
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
  const handles = new Map<string, RendererRecoveryHandle>();
  const readBindings = new Map<string, () => void>();
  const bindRead = (key: string) => {
    readBindings.get(key)?.();
    readBindings.set(key, bindAgentRecoveryReadOwner(key, scope));
  };
  const principal = selectPrincipalActionContext.select(store.getState());
  let disposed = false;
  let syncing = false;
  const current = () =>
    !disposed &&
    scope.isCurrent() &&
    principal === selectPrincipalActionContext.select(store.getState());
  const workspaceAuthority = installAgentRecoveryWorkspaceScope(current);
  const retiredWorkspaces = workspaceAuthority.retired;
  const workspaceHandles = new Map<string, RendererRecoveryHandle>();
  const retireWorkspace = (workspaceId: string) => {
    if (!current() || retiredWorkspaces.has(workspaceId)) return;
    retiredWorkspaces.add(workspaceId);
    // Subscription owners admit watched children from other workspaces, while
    // their authority and protected snapshot still belong to the parent's home.
    for (const [key, demand] of demands) {
      if (demand.kind === 'subscriptions' && demand.workspaceId === workspaceId)
        handles.get(key)?.captureLifetime().isCurrent();
    }
    for (const key of [
      AGENT_ACTIVE_STREAMS_RECOVERY_KEY,
      AGENT_FAILURES_RECOVERY_KEY,
      AGENT_PERMISSIONS_RECOVERY_KEY,
    ]) {
      const handle = handles.get(key);
      const stale = handle?.status.stale;
      handle?.changeLifetime();
      if (stale) handle?.invalidate();
    }
    activeStreamsTracker.retireWorkspace(workspaceId);
    for (const entry of listAgentFailureEntries())
      if (entry.workspaceId === workspaceId) removeAgentFailure(entry.agentId);
    const state = store.getState();
    for (const request of getItems(state.permission.requests))
      if (
        (request.workspaceId ?? state.agentSessions.byAgentId[request.sessionId]?.workspaceId) ===
        workspaceId
      )
        store.dispatch(removePermissionRequest(request.requestId));
    pendingPermissions = pendingPermissions.filter(
      (request) =>
        (request.workspaceId ?? state.agentSessions.byAgentId[request.sessionId]?.workspaceId) !==
        workspaceId,
    );
  };
  const ensureWorkspaceAuthority = (workspaceId: string) => {
    if (!workspaceHandles.has(workspaceId)) {
      workspaceHandles.set(
        workspaceId,
        scope.registerResource({
          key: `agent-workspace-authority:${JSON.stringify([workspaceId])}`,
          workspaceId,
          eventTypes: [],
          active: false,
          isCurrent: current,
          read: async () => null,
          apply: () => {},
          invalidate: () => {},
          retire: () => {
            retireWorkspace(workspaceId);
          },
        }),
      );
    }
    return workspaceHandles.get(workspaceId);
  };
  const acceptsEvent = (notification: { params?: unknown }) => {
    const workspaceId = (notification.params as { event?: { workspaceId?: string } })?.event
      ?.workspaceId;
    return !workspaceId || workspaceAuthority.current(workspaceId);
  };
  const owner: Owner = { isCurrent: current, dispatch: (action) => store.dispatch(action) };
  const active = scope.registerResource({
    key: AGENT_ACTIVE_STREAMS_RECOVERY_KEY,
    acceptsEvent,
    workspaceId: null,
    eventTypes: [
      'agent:status-changed',
      'agent:idle',
      'agent:failed',
      'agent:deleted',
      'agent:delete-scheduled',
    ],
    isCurrent: current,
    read: ({ request, lifetime }) =>
      trackAgentRecoveryRead(
        AGENT_ACTIVE_STREAMS_RECOVERY_KEY,
        () => request<{ streams: ActiveStream[] }>('agent.listActive', {}),
        lifetime,
      ),
    apply: ({ streams }) => {
      activeStreamsTracker.replaceSnapshot(streams);
    },
    invalidate: () => {},
    retire: () => {
      activeStreamsTracker.replaceSnapshot([]);
    },
  });
  handles.set(AGENT_ACTIVE_STREAMS_RECOVERY_KEY, active);
  bindRead(AGENT_ACTIVE_STREAMS_RECOVERY_KEY);
  const failure = scope.registerResource({
    key: AGENT_FAILURES_RECOVERY_KEY,
    acceptsEvent,
    workspaceId: null,
    eventTypes: ['agent:failed', 'agent:status-changed', 'agent:deleted', 'agent:delete-scheduled'],
    isCurrent: current,
    read: async ({ request, lifetime }) =>
      trackAgentRecoveryRead(
        AGENT_FAILURES_RECOVERY_KEY,
        async () => {
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
          const snapshots = await Promise.allSettled(
            [...targets.values()]
              .filter((target) => workspaceAuthority.current(target.workspaceId))
              .map(async ({ agentId, workspaceId }) => {
                const entry = getAgentFailureEntry(agentId);
                const authority = ensureWorkspaceAuthority(workspaceId);
                try {
                  const result = await request<{ agent: Record<string, unknown> }>('agent.get', {
                    agentId,
                    workspaceId,
                  });
                  return { agentId, workspaceId, entry, session: normalizeAgent(result.agent) };
                } catch (error) {
                  const clearDenied = (failure: unknown) => {
                    if (
                      !current() ||
                      !workspaceAuthority.current(workspaceId) ||
                      workspaceHandles.get(workspaceId) !== authority ||
                      getAgentFailureEntry(agentId) !== entry
                    )
                      return false;
                    const e = failure as { rpcCode?: number; data?: { code?: string } };
                    if (e.rpcCode === -32003 || e.rpcCode === -32001) {
                      retireWorkspace(workspaceId);
                      return true;
                    }
                    if (e.rpcCode === -32602 && e.data?.code === 'not-found') {
                      removeAgentFailure(agentId);
                      return true;
                    }
                    return false;
                  };
                  if (clearDenied(error))
                    return { agentId, entry: undefined, session: null, workspaceId };
                  const code = error as { rpcCode?: number; data?: { code?: string } };
                  // A denial for a superseded entry cannot retire its replacement.
                  if (
                    code.rpcCode === -32003 ||
                    code.rpcCode === -32001 ||
                    (code.rpcCode === -32602 && code.data?.code === 'not-found')
                  )
                    return { agentId, entry, session: null, workspaceId };
                  const physical = getPhysicalRequestCompletion(error);
                  if (physical) {
                    const completion = await physical;
                    if (!completion.retired) {
                      for (const failure of completion.errors) clearDenied(failure);
                      // Point denials belong to this entry/workspace. Do not
                      // propagate them as authority loss for the global mirror.
                      if (completion.errors.some((failure) => isAgentReadAuthorityError(failure)))
                        return { agentId, entry, session: null, workspaceId };
                    }
                  }
                  throw error;
                }
              }),
          );
          const failed = snapshots.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
          return snapshots.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
          );
        },
        lifetime,
      ),
    apply: (snapshots) => {
      for (const { agentId, workspaceId, entry, session } of snapshots) {
        if (!workspaceAuthority.current(workspaceId)) continue;
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
  bindRead(AGENT_FAILURES_RECOVERY_KEY);
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
      if (!workspaceAuthority.current(workspaceId)) return false;
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
      const knownWorkspaces = new Set([
        ...getItems(state.workspace.workspaces).map((workspace) => workspace.id),
        ...Object.values(state.agentSessions.byAgentId).map((agent) => agent.workspaceId),
        ...listAgentFailureEntries().map((entry) => entry.workspaceId),
        ...activeStreamsTracker.getWorkspaceIds(),
        ...getItems(state.permission.requests).flatMap((request) =>
          request.workspaceId ? [request.workspaceId] : [],
        ),
      ]);
      for (const workspaceId of knownWorkspaces) ensureWorkspaceAuthority(workspaceId);
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
            acceptsEvent,
            workspaceId: null,
            eventTypes: ['agent:permission:*'],
            isCurrent: () =>
              current() &&
              permissionScope === selectPermissionRecoveryScope.select(store.getState()),
            read: ({ request, lifetime }) =>
              trackAgentRecoveryRead(
                AGENT_PERMISSIONS_RECOVERY_KEY,
                () => request<{ requests: PermissionRequest[] }>('agent.pendingPermissions', {}),
                lifetime,
              ),
            apply: ({ requests }) => {
              const latest = store.getState();
              const admitted = requests.flatMap((request) => {
                const workspaceId = latest.agentSessions.byAgentId[request.sessionId]?.workspaceId;
                return workspaceId &&
                  workspaceAuthority.current(workspaceId) &&
                  selectWorkspacePermissionContext.select(latest, workspaceId)
                  ? [{ ...request, workspaceId }]
                  : [];
              });
              const ids = new Set(admitted.map((request) => request.requestId));
              for (const request of getItems(latest.permission.requests))
                if (!ids.has(request.requestId))
                  store.dispatch(removePermissionRequest(request.requestId));
              store.dispatch(setPendingRequests(admitted));
              pendingPermissions = requests.filter(
                (request) =>
                  !latest.agentSessions.byAgentId[request.sessionId] &&
                  (!request.workspaceId || workspaceAuthority.current(request.workspaceId)),
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
          bindRead(AGENT_PERMISSIONS_RECOVERY_KEY);
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
          workspaceId: null,
          eventTypes: [
            'agent:subscriptions-changed',
            'agent:idle',
            'agent:failed',
            'agent:status-changed',
            'agent:deleted',
            'agent:delete-scheduled',
          ],
          isCurrent: () => current() && workspaceAuthority.current(workspaceId),
          acceptsEvent: (notification) => {
            const event = (
              notification.params as {
                event?: {
                  workspaceId?: string;
                  type?: string;
                  data?: { agentId?: string };
                };
              }
            )?.event;
            if (!event?.workspaceId || !workspaceAuthority.current(event.workspaceId)) return false;
            const changed = event.data?.agentId;
            if (event.type === 'agent:subscriptions-changed')
              return event.workspaceId === workspaceId && changed === agentId;
            const entry =
              store.getState().agentSubscriptionUI.entries[makeKey(workspaceId, agentId)];
            const watchesChild =
              !!changed &&
              (entry?.subscriptions.some((watch) => watch.actorIds.includes(changed)) ||
                entry?.delegationGroups.some((group) => group.expectedAgentIds.includes(changed)));
            return (
              !!watchesChild ||
              (event.workspaceId === workspaceId && (!changed || entry?.snapshotStatus !== 'ready'))
            );
          },
          read: ({ request, lifetime }) =>
            trackAgentRecoveryRead(
              key,
              () => request<WireResult>('agent.getSubscriptions', { workspaceId, agentId }),
              lifetime,
            ),
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
        bindRead(key);
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
  const stopFailures = subscribeToAgentFailures(sync);
  const stopStreams = activeStreamsTracker.subscribe(sync);
  sync();
  const stopMetadata = installAgentMetadataRecovery(scope, store);
  return () => {
    disposed = true;
    stop();
    stopFailures();
    stopStreams();
    stopMetadata();
    workspaceAuthority.dispose();
    for (const handle of workspaceHandles.values()) handle.dispose();
    for (const handle of handles.values()) handle.dispose();
    handles.clear();
    for (const unbind of readBindings.values()) unbind();
    readBindings.clear();
  };
}
