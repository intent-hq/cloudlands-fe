import { call, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { StoreSelectorEffect } from '@themislib/themis/types';

import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '../../../../../features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '../../../../../features/agent/utils/agent-not-found-error';
import {
  bulkUpsertSessions,
  markAgentDetailHydrated,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';

const logger = createLogger('AgentReadSaga');

/** Bind the canonical ensure owner to the host's read, selector, and deleted-tab cleanup. */
export function createAgentReadSaga({
  readAgentSession,
  selectAgentSession,
  cleanupDeletedAgentTabs,
}: {
  readAgentSession: (agentId: string, workspaceId?: string) => Promise<AgentSession | null>;
  selectAgentSession: {
    effect: StoreSelectorEffect<AgentSession | undefined, [agentId: string]>;
  };
  cleanupDeletedAgentTabs: (wsId: string, agentId: string) => SagaGenerator<void>;
}) {
  function* loadAgentSessionSaga(wsId: string, agentId: string) {
    if (yield* call(isAgentDeletionPending, agentId)) return;
    try {
      const session: AgentSession | null = yield* call(readAgentSession, agentId, wsId);
      if (!session || String(session.workspaceId) !== wsId) return;
      // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
      // §5.5 `pendingDeleteAt`) — the deletion is pending daemon-side.
      if (session.pendingDeleteAt) return;
      if (yield* call(isAgentDeletionPending, agentId)) return;

      const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
      const merged = existing ? { ...session, messages: existing.messages } : session;
      yield* put(bulkUpsertSessions([merged]));
      yield* put(upsertSession(merged));
      yield* put(markAgentDetailHydrated(agentId));
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

  return function* agentReadSaga() {
    yield* takeEvery(ensureAgentSessionLoaded, loadAgentSessionWorker);
  };
}
