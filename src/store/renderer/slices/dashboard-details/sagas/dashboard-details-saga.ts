import { buffers } from 'redux-saga';
import { actionChannel, put, take, type SagaGenerator } from 'typed-redux-saga';
import { WorkspaceStatus } from '$shared/types';
import {
  selectDashboardWorkspaceAgentIds,
  selectDashboardWorkspaceQuestionRecoveries,
} from '../../hud/hud-selectors';
import { bulkUpsertSessions, updateSession } from '../../agent-session/agent-session-slice';
import { selectAgentSessionWorkspaceId } from '../../agent-session/agent-session-selectors';
import { pendingQuestionRecoveryRequested } from '../../chat-state/chat-state-slice';
import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { fetchWorkspaceTokenUsage } from '../../token-usage/token-usage-slice';
import {
  daemonEventsSubscribed,
  eventReceived,
} from '../../workspace-events/workspace-events-slice';
import { selectDaemonEventsSubscriptionGeneration } from '../../workspace-events/workspace-events-selectors';
import { setDashboardVisibleWorkspaces } from '../dashboard-details-slice';
import { DASHBOARD_VISIBLE_WORKSPACE_LIMIT } from '../dashboard-details-types';

type DemandAction = ReturnType<
  | typeof setDashboardVisibleWorkspaces
  | typeof daemonEventsSubscribed
  | typeof bulkUpsertSessions
  | typeof updateSession
  | typeof eventReceived
  | typeof bulkUpdateWorkspaceEntities
  | typeof removeWorkspaceEntity
  | typeof replaceWorkspaceList
  | typeof setWorkspaceEntity
  | typeof updateWorkspaceEntity
>;

/** Route canonical updates by their existing owner IDs, never a workspace-list refetch. */
function* affectedWorkspaces(action: DemandAction): SagaGenerator<string[]> {
  switch (action.type) {
    case bulkUpsertSessions.type:
      return (action as ReturnType<typeof bulkUpsertSessions>).payload[0].map((session) =>
        String(session.workspaceId),
      );
    case updateSession.type: {
      const workspaceId = yield* selectAgentSessionWorkspaceId.effect(
        (action as ReturnType<typeof updateSession>).payload[0],
      );
      return workspaceId ? [workspaceId] : [];
    }
    case eventReceived.type: {
      const [workspaceId, event] = (action as ReturnType<typeof eventReceived>).payload;
      return event.type.startsWith('agent:') ? [workspaceId] : [];
    }
    case setWorkspaceEntity.type:
      return [String((action as ReturnType<typeof setWorkspaceEntity>).payload[0].id)];
    case updateWorkspaceEntity.type:
    case removeWorkspaceEntity.type:
      return [
        (action as ReturnType<typeof updateWorkspaceEntity | typeof removeWorkspaceEntity>)
          .payload[0],
      ];
    case bulkUpdateWorkspaceEntities.type:
      return (action as ReturnType<typeof bulkUpdateWorkspaceEntities>).payload[0].map(
        (update) => update.payload[0],
      );
    case replaceWorkspaceList.type:
      return (action as ReturnType<typeof replaceWorkspaceList>).payload[0].map((workspace) =>
        String(workspace.id),
      );
    default:
      return [];
  }
}

/**
 * Owns only DOM observer leases. Agent and usage data stay in their canonical
 * slices and reads share the existing single-flight owners. The shared daemon
 * event bridge supplies live activity, metadata, attention and usage updates.
 */
export function* dashboardDetailsSaga(): SagaGenerator<void> {
  const owners = new Map<string, string[]>();
  // Per-lease read bookkeeping, not a second copy of domain data.
  const requestedAgentIds = new Map<string, Set<string>>();
  const requestedQuestions = new Map<string, Map<string, string>>();
  let visible = new Set<string>();
  let generation = yield* selectDaemonEventsSubscriptionGeneration.effect();
  const actions = yield* actionChannel<DemandAction>(
    [
      setDashboardVisibleWorkspaces,
      daemonEventsSubscribed,
      bulkUpsertSessions,
      updateSession,
      eventReceived,
      bulkUpdateWorkspaceEntities,
      removeWorkspaceEntity,
      replaceWorkspaceList,
      setWorkspaceEntity,
      updateWorkspaceEntity,
    ],
    buffers.expanding<DemandAction>(),
  );
  try {
    while (true) {
      const action = yield* take(actions);
      if (
        visible.size === 0 &&
        action.type !== setDashboardVisibleWorkspaces.type &&
        action.type !== daemonEventsSubscribed.type
      )
        continue;
      let refresh = false;
      let affected: string[];
      if (action.type === setDashboardVisibleWorkspaces.type) {
        const [ownerId, workspaceIds] = action.payload as [string, string[]];
        if (workspaceIds.length === 0) owners.delete(ownerId);
        else {
          owners.set(
            ownerId,
            [...new Set(workspaceIds.filter(Boolean))].slice(0, DASHBOARD_VISIBLE_WORKSPACE_LIMIT),
          );
        }
        const next = new Set(
          [...new Set([...owners.values()].flat())].slice(0, DASHBOARD_VISIBLE_WORKSPACE_LIMIT),
        );
        affected = [...next].filter((workspaceId) => !visible.has(workspaceId));
        for (const workspaceId of visible) {
          if (!next.has(workspaceId)) {
            requestedAgentIds.delete(workspaceId);
            requestedQuestions.delete(workspaceId);
          }
        }
        visible = next;
      } else if (action.type === daemonEventsSubscribed.type) {
        // Refresh after the firehose is restored, including recovery from an
        // offline first mount. Stale subscribe acknowledgements do not count.
        const nextGeneration = yield* selectDaemonEventsSubscriptionGeneration.effect();
        refresh = nextGeneration !== generation;
        generation = nextGeneration;
        affected = refresh ? [...visible] : [];
      } else {
        affected = yield* affectedWorkspaces(action);
      }
      for (const workspaceId of new Set(affected)) {
        if (!visible.has(workspaceId)) continue;
        const workspace = yield* selectWorkspaceById.effect(workspaceId);
        if (
          !workspace ||
          workspace.status === WorkspaceStatus.Archived ||
          workspace.status === WorkspaceStatus.Deleted
        ) {
          requestedAgentIds.delete(workspaceId);
          requestedQuestions.delete(workspaceId);
          continue;
        }
        let requested = requestedAgentIds.get(workspaceId);
        if (refresh || !requested) {
          requested = new Set<string>();
          requestedAgentIds.set(workspaceId, requested);
          yield* put(fetchWorkspaceTokenUsage(workspaceId));
        }
        // New summary IDs can appear while the card remains visible. Request
        // just those IDs; ordinary status/message ticks never reload the card.
        const agentIds = yield* selectDashboardWorkspaceAgentIds.effect(workspaceId);
        for (const agentId of agentIds) {
          if (!requested.has(agentId)) {
            requested.add(agentId);
            yield* put(ensureAgentSessionLoaded(workspaceId, agentId));
          }
        }
        // Drop bookkeeping for rows no longer among the bounded candidates.
        for (const agentId of requested) {
          if (!agentIds.includes(agentId)) requested.delete(agentId);
        }
        let questions = requestedQuestions.get(workspaceId);
        if (!questions) {
          questions = new Map<string, string>();
          requestedQuestions.set(workspaceId, questions);
        }
        for (const agentId of questions.keys()) {
          if (!agentIds.includes(agentId)) questions.delete(agentId);
        }
        // Intentional targeted fan-out: the chat owner recovers one marked
        // row. Repeated session/events updates share one request per marker.
        for (const {
          agentId,
          messageId,
        } of yield* selectDashboardWorkspaceQuestionRecoveries.effect(workspaceId)) {
          if (questions.get(agentId) !== messageId) {
            questions.set(agentId, messageId);
            yield* put(pendingQuestionRecoveryRequested(agentId, messageId));
          }
        }
      }
    }
  } finally {
    actions.close();
    owners.clear();
    requestedAgentIds.clear();
    requestedQuestions.clear();
    // Leaving a card stops future demand; shared in-flight reads may finish
    // into the canonical cache for other consumers. Never unmount a workspace.
  }
}
