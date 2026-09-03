import { call, put, race, take, takeEvery } from 'typed-redux-saga';

import { readAgentSession } from '$features/agent/agent-read-service';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';
import { cleanupDeletedAgentTabs } from './deleted-agent-cleanup';

const logger = createLogger('AgentReadSaga');

function* loadAgentSessionSaga(wsId: string, agentId: string) {
  if (yield* call(isAgentDeletionPending, agentId)) return;
  try {
    const session: AgentSession | null = yield* call(readAgentSession, agentId);
    if (!session || String(session.workspaceId) !== wsId) return;
    // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
    // §5.5 `pendingDeleteAt`, v6.7+) — the deletion is pending daemon-side.
    if (session.pendingDeleteAt) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    const merged = existing ? { ...session, messages: existing.messages } : session;
    yield* put(bulkUpsertSessions([merged]));
    yield* put(upsertSession(merged));
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      // Expected after deletion: a stale tab/route still references the
      // agent (monorepo#1753) — close it instead of erroring.
      yield* call(cleanupDeletedAgentTabs, wsId, agentId);
      return;
    }
    logger.error('Failed to load agent session', error);
  }
}

function matchesWorkspaceCleanup(wsId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === wsId;
}

function matchesLaterAgentEnsure(agentId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === ensureAgentSessionLoaded.type &&
    Array.isArray(action.payload) &&
    action.payload[1] === agentId;
}

function* loadAgentSessionWorker(action: ReturnType<typeof ensureAgentSessionLoaded>) {
  const [wsId, agentId] = action.payload;
  if (!wsId || !agentId) return;
  yield* race({
    read: call(loadAgentSessionSaga, wsId, agentId),
    cleanup: take(matchesWorkspaceCleanup(wsId)),
    superseded: take(matchesLaterAgentEnsure(agentId)),
  });
}

export function* agentReadSaga() {
  yield* takeEvery(ensureAgentSessionLoaded, loadAgentSessionWorker);
}
