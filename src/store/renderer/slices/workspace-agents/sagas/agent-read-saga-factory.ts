import { call, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createChannelFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import type { EventChannel } from 'redux-saga';
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

import {
  isAgentReadScopeCurrent,
  putAgentReadAction,
  type AgentReadAdmission,
  type AgentReadScope,
} from './agent-read-admission';

const logger = createLogger('AgentReadSaga');

/** Bind the canonical ensure owner to the host's read, selector, and deleted-tab cleanup. */
export function createAgentReadSaga<State>({
  admission,
  readAgentSession,
  selectAgentSession,
  cleanupDeletedAgentTabs,
}: {
  admission: AgentReadAdmission<State>;
  readAgentSession: (agentId: string, workspaceId?: string) => Promise<AgentSession | null>;
  selectAgentSession: {
    effect: StoreSelectorEffect<AgentSession | undefined, [agentId: string]>;
  };
  cleanupDeletedAgentTabs: (
    wsId: string,
    agentId: string,
    scope: AgentReadScope,
  ) => SagaGenerator<void>;
}) {
  function* loadAgentSessionSaga(wsId: string, agentId: string, scope: AgentReadScope) {
    if (yield* call(isAgentDeletionPending, agentId)) return;
    try {
      const session: AgentSession | null =
        scope.kind === 'source'
          ? yield* call(readAgentSession, agentId, wsId)
          : yield* call((): Promise<AgentSession | null> => {
              if (!isAgentReadScopeCurrent(scope)) return Promise.resolve(null);
              return readAgentSession(agentId, wsId);
            });
      if (!isAgentReadScopeCurrent(scope)) return;
      if (!session || String(session.workspaceId) !== wsId) return;
      // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
      // §5.5 `pendingDeleteAt`) — the deletion is pending daemon-side.
      if (session.pendingDeleteAt) return;
      if (yield* call(isAgentDeletionPending, agentId)) return;

      const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
      const merged = existing ? { ...session, messages: existing.messages } : session;
      if (!(yield* putAgentReadAction(scope, bulkUpsertSessions([merged])))) return;
      if (!(yield* putAgentReadAction(scope, upsertSession(merged)))) return;
      if (!(yield* putAgentReadAction(scope, markAgentDetailHydrated(agentId)))) return;
    } catch (error) {
      if (!isAgentReadScopeCurrent(scope)) return;
      if (isAgentNotFoundError(error)) {
        // Expected after deletion: a stale tab/route still references the
        // agent (monorepo#1753) — close it instead of erroring.
        yield* call(cleanupDeletedAgentTabs, wsId, agentId, scope);
        return;
      }
      logger.error('Failed to load agent session', error);
    }
  }

  function* waitForAuthorityLoss(
    channel: EventChannel<SelectorChannelPayload<string | null>>,
    scope: AgentReadScope,
  ) {
    while (isAgentReadScopeCurrent(scope)) yield* take(channel);
  }

  function* loadAdmittedAgentSession(wsId: string, agentId: string) {
    if (admission.kind === 'source') {
      yield* call(loadAgentSessionSaga, wsId, agentId, admission);
      return;
    }
    const channel = yield* createChannelFromSelector(admission.contextSelector);
    try {
      // Notifications wake/cancel the worker; only the direct snapshot admits work.
      let context = admission.readCurrentContext();
      while (context === null) {
        yield* take(channel);
        context = admission.readCurrentContext();
      }
      const scope: AgentReadScope = {
        kind: 'principal',
        context,
        readCurrentContext: admission.readCurrentContext,
        dispatch: admission.dispatch,
      };
      yield* race({
        authorityLost: call(waitForAuthorityLoss, channel, scope),
        read: call(loadAgentSessionSaga, wsId, agentId, scope),
      });
    } finally {
      channel.close();
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
      read: call(loadAdmittedAgentSession, wsId, agentId),
      cleanup: take(matchesWorkspaceCleanup(wsId)),
      superseded: take(matchesLaterAgentEnsure(agentId)),
    });
  }

  return function* agentReadSaga() {
    yield* takeEvery(ensureAgentSessionLoaded, loadAgentSessionWorker);
  };
}
