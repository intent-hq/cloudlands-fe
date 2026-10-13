import { acquireAgentMetadataDemand } from '$features/agent/agent-metadata-demand';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { agentMetadataRecoveryKey } from '$features/agent/agent-recovery-keys';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';
import { call, put, race, take, takeEvery } from 'typed-redux-saga';

import { readAgentSession } from '$features/agent/agent-read-service';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import {
  bulkUpsertSessions,
  markAgentDetailHydrated,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';
import { cleanupDeletedAgentTabs } from './deleted-agent-cleanup';

const logger = createLogger('AgentReadSaga');

function* loadAgentSessionSaga(wsId: string, agentId: string) {
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const release = acquireAgentMetadataDemand(wsId, { agentId });
  const recovery = rendererEventRecovery.capture(agentMetadataRecoveryKey(wsId));
  try {
    if (!recovery.commit(() => undefined)) return;
    const session: AgentSession | null = yield* call(readAgentSession, agentId, wsId);
    if (!recovery.commit(() => undefined) || !session || String(session.workspaceId) !== wsId)
      return;
    // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
    // §5.5 `pendingDeleteAt`) — the deletion is pending daemon-side.
    if (session.pendingDeleteAt) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    const merged = existing ? { ...session, messages: existing.messages } : session;
    yield* put(withRecoveryLifetime(bulkUpsertSessions([merged]), recovery));
    yield* put(withRecoveryLifetime(upsertSession(merged), recovery));
    yield* put(withRecoveryLifetime(markAgentDetailHydrated(agentId), recovery));
  } catch (error) {
    if (!recovery.commit(() => undefined)) return;
    if (isAgentNotFoundError(error)) {
      // Expected after deletion: a stale tab/route still references the
      // agent (monorepo#1753) — close it instead of erroring.
      yield* call(cleanupDeletedAgentTabs, wsId, agentId);
      return;
    }
    logger.error('Failed to load agent session', error);
  } finally {
    release();
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
