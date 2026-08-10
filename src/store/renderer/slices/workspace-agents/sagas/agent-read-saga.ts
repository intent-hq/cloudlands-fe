import { call, put, race, take, takeLeading } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import {
  bulkUpsertSessions,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { closeTabsByAgentId } from '../../panel-layout/panel-layout-slice';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';

const logger = createLogger('AgentReadSaga');

function* loadAgentSessionSaga(wsId: string, agentId: string) {
  if (yield* call(isAgentDeletionPending, agentId)) return;
  try {
    const session: AgentSession | null = yield* call(
      [appClient.agents, appClient.agents.get],
      agentId,
    );
    if (!session || String(session.workspaceId) !== wsId) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    const merged = existing ? { ...session, messages: existing.messages } : session;
    yield* put(bulkUpsertSessions([merged]));
    yield* put(upsertSession(merged));
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      // Expected after deletion: a stale tab/route still references the
      // agent (monorepo#1753). WARN once and close any panel tabs pointing at
      // it so the workspace falls back to its home view; with no referencing
      // tab (speculative load) the close is a no-op.
      logger.warn('Agent no longer exists on daemon; closing stale tabs', { wsId, agentId });
      yield* put(closeTabsByAgentId(wsId, agentId));
      return;
    }
    logger.error('Failed to load agent session', error);
  }
}

type WorkspaceCleanupAction =
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof workspaceUnmounted>;

function matchesWorkspaceCleanup(wsId: string) {
  return (action: WorkspaceCleanupAction) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    action.payload[0] === wsId;
}

function* loadAgentSessionWorker(action: ReturnType<typeof ensureAgentSessionLoaded>) {
  const [wsId, agentId] = action.payload;
  if (!wsId || !agentId) return;
  yield* race({
    read: call(loadAgentSessionSaga, wsId, agentId),
    cleanup: take(matchesWorkspaceCleanup(wsId)),
  });
}

export function* agentReadSaga() {
  yield* takeLeading(ensureAgentSessionLoaded, loadAgentSessionWorker);
}