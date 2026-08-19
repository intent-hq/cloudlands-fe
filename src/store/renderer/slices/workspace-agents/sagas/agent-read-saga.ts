import { call, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  closeTabsByAgentId,
  destroyTabsByOwnerAgent,
} from '../../panel-layout/panel-layout-slice';
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
      // agent (monorepo#1753). WARN once and close any panel tabs pointing at
      // it so the workspace falls back to its home view; with no referencing
      // tab (speculative load) the close is a no-op.
      logger.warn('Agent no longer exists on daemon; closing stale tabs', { wsId, agentId });
      yield* put(closeTabsByAgentId(wsId, agentId));
      // A deletion missed while the app was closed: destroy the dead
      // agent's owned browser tabs too (monorepo#2857), and clear main's
      // CDP/ownership registrations — an earlier list-tabs reply may
      // already have rehydrated them for the persisted hidden tabs.
      yield* put(destroyTabsByOwnerAgent(wsId, agentId));
      try {
        yield* call(invoke, IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId });
      } catch (clearError) {
        logger.warn('Failed to clear main-process registrations for deleted agent tabs', {
          agentId,
          error: clearError,
        });
      }
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
