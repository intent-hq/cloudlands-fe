import { buffers, eventChannel } from 'redux-saga';
import { call, fork, join, put, take, takeEvery } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelSelector } from '@themislib/themis/saga';
import type { AgentSession } from '$shared/types/agent-session';
import type { createBackendAgentClient } from '$lib/client/live/backend-agent-client';
import type { DeltaSubscriptionStatus } from '$lib/client/live/delta-subscription-runtime';
import type { createAgentReadService } from '../../../../../features/agent/agent-read-service-factory';
import type { createAgentReadOwnership } from '../../../../../features/agent/agent-read-ownership-factory';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
  removeSession,
  pendingQuestionMarkersFromWorkspaceEvent,
} from '../agent-session-slice';
import {
  setAgents,
  setAgentsLoaded,
  workspaceAgentMetadataRetryRequested,
  workspaceAgentMetadataStatusChanged,
} from '../../workspace-agents/workspace-agents-slice';
import { eventReceived } from '../../workspace-events/workspace-events-slice';

type Lease = { workspaceId: string; agentId?: string };

/** One app-owned subscription runtime. Components dispatch leases; they never open channels. */
export function createAgentMetadataSaga<State>({
  contextSelector,
  client,
  reads,
  ownership,
}: {
  contextSelector: SelectorChannelSelector<string | null, [], State>;
  client: Pick<ReturnType<typeof createBackendAgentClient>, 'subscribeWorkspaces'>;
  reads: ReturnType<typeof createAgentReadService>;
  ownership: ReturnType<typeof createAgentReadOwnership>;
}) {
  return function* agentMetadataSaga() {
    const leases = new Map<string, Lease>();
    let context: string | null = null;
    let notifyIds: ((ids: readonly string[]) => void) | undefined;
    let retryWorkspace: ((workspaceId: string) => void) | undefined;
    const desiredIds = () => [...new Set([...leases.values()].map((lease) => lease.workspaceId))];
    const refreshIds = () => notifyIds?.(context ? desiredIds() : []);
    function releaseDetail(lease: Lease | undefined) {
      if (
        lease?.agentId &&
        ![...leases.values()].some(
          (other) => other.agentId === lease.agentId && other.workspaceId === lease.workspaceId,
        )
      ) {
        ownership.release(lease.agentId, lease.workspaceId);
      }
    }
    reads.start();
    try {
      yield* takeEvery(
        agentMetadataAcquired,
        function* ({ payload: [consumerId, workspaceId, agentId] }) {
          if (!workspaceId) return;
          const previous = leases.get(consumerId);
          leases.set(consumerId, { workspaceId, agentId });
          releaseDetail(previous);
          refreshIds();
          if (previous && !desiredIds().includes(previous.workspaceId))
            yield* put(workspaceAgentMetadataStatusChanged(previous.workspaceId, null));
          if (context && agentId) yield* call(reads.ensureAgentSession, agentId, workspaceId);
        },
      );
      yield* takeEvery(agentMetadataReleased, function* ({ payload: [consumerId] }) {
        const previous = leases.get(consumerId);
        leases.delete(consumerId);
        releaseDetail(previous);
        refreshIds();
        if (previous && !desiredIds().includes(previous.workspaceId))
          yield* put(workspaceAgentMetadataStatusChanged(previous.workspaceId, null));
      });
      yield* takeEvery(
        workspaceAgentMetadataRetryRequested,
        function* ({ payload: [consumerId, workspaceId, requestedContext] }) {
          if (
            !context ||
            context !== requestedContext ||
            leases.get(consumerId)?.workspaceId !== workspaceId ||
            (yield* contextSelector.effect()) !== requestedContext
          )
            return;
          retryWorkspace?.(workspaceId);
        },
      );
      yield* takeEvery(eventReceived, function* ({ payload: [workspaceId, event] }) {
        if (
          !context ||
          ![
            'agent:updated',
            'agent:renamed',
            'agent:status-changed',
            'agent:idle',
            'agent:created',
            'agent:retired',
            'agent:restored',
          ].includes(event.type)
        )
          return;
        const agentId = typeof event.data?.agentId === 'string' ? event.data.agentId : undefined;
        if (!agentId) return;
        const lease = [...leases.values()].find(
          (value) => value.agentId === agentId && value.workspaceId === workspaceId,
        );
        if (!lease) return;
        if (pendingQuestionMarkersFromWorkspaceEvent(event) !== null)
          reads.notePendingQuestionMarkerProjection(agentId, lease.workspaceId);
        yield* call(reads.refreshAgentSessionAfterEvent, agentId, lease.workspaceId);
      });
      const observer = yield* takeLatestFromSelector(
        contextSelector,
        function* ({ payload: nextContext }) {
          context = nextContext;
          reads.invalidate();
          if (!nextContext) return;
          let active = true;
          const statuses = new Set<string>();
          const snapshots = eventChannel<
            | { sessions: AgentSession[]; workspaceIds: readonly string[] }
            | { workspaceId: string; status: DeltaSubscriptionStatus }
          >(
            (emit) =>
              client.subscribeWorkspaces(
                (listener) => {
                  notifyIds = listener;
                  refreshIds();
                  return () => {
                    if (notifyIds === listener) notifyIds = undefined;
                  };
                },
                (sessions, workspaceIds) => {
                  if (active) emit({ sessions, workspaceIds: workspaceIds ?? [] });
                },
                {
                  onStatus: (workspaceId, status) => {
                    if (active) emit({ workspaceId, status });
                  },
                  subscribeRetry: (listener) => {
                    retryWorkspace = listener;
                    return () => {
                      if (retryWorkspace === listener) retryWorkspace = undefined;
                    };
                  },
                },
              ),
            buffers.expanding(),
          );
          const previousIds = new Map<string, Set<string>>();
          try {
            for (const lease of leases.values()) {
              if (lease.agentId)
                yield* fork(reads.ensureAgentSession, lease.agentId, lease.workspaceId);
            }
            while (true) {
              const update = yield* take(snapshots);
              if ((yield* contextSelector.effect()) !== nextContext) continue;
              if ('status' in update) {
                if (!desiredIds().includes(update.workspaceId)) continue;
                statuses.add(update.workspaceId);
                yield* put(
                  workspaceAgentMetadataStatusChanged(update.workspaceId, {
                    context: nextContext,
                    ...update.status,
                  }),
                );
                continue;
              }
              const { sessions, workspaceIds } = update;
              // The shared dynamic engine emits confirmed siblings while another workspace registers.
              // Seeded workspace IDs include empty snapshots; unseeded siblings are left untouched.
              const groups = new Map<string, AgentSession[]>();
              for (const session of sessions) {
                if (!desiredIds().includes(session.workspaceId)) continue;
                const group = groups.get(session.workspaceId) ?? [];
                group.push(session);
                groups.set(session.workspaceId, group);
              }
              for (const workspaceId of workspaceIds) {
                if (!desiredIds().includes(workspaceId)) continue;
                const rows = groups.get(workspaceId) ?? [];
                const accepted = rows
                  .map((session) => reads.receiveAgentSession(session))
                  .filter((session): session is AgentSession => session !== null);
                const ids = new Set(accepted.map((session) => String(session.id)));
                for (const id of previousIds.get(workspaceId) ?? []) {
                  if (!ids.has(id) && ownership.isAgentReadWorkspaceCurrent(id, workspaceId))
                    yield* put(removeSession(id));
                }
                previousIds.set(workspaceId, ids);
                yield* put(setAgents(workspaceId, accepted));
                yield* put(setAgentsLoaded(workspaceId, true));
              }
            }
          } finally {
            active = false;
            snapshots.close();
            notifyIds = undefined;
            retryWorkspace = undefined;
            for (const workspaceId of statuses)
              yield* put(workspaceAgentMetadataStatusChanged(workspaceId, null));
          }
        },
      );
      yield* join(observer);
    } finally {
      context = null;
      leases.clear();
      reads.dispose();
    }
  };
}
