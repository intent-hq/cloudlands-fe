import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession } from '$shared/types';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  bulkUpsertSessions,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
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
    logger.error('Failed to load agent session', error);
  }
}

type RunningRead = { wsId: string; task?: Task; token: symbol };

export function* agentReadSaga() {
  const running = new Map<string, RunningRead>();
  try {
    while (true) {
      const action: ReturnType<
        | typeof ensureAgentSessionLoaded
        | typeof workspaceDeleted
        | typeof workspaceUnmounted
      > = yield* take([
        ensureAgentSessionLoaded,
        workspaceDeleted,
        workspaceUnmounted,
      ]);

      if (action.type === ensureAgentSessionLoaded.type) {
        const [wsId, agentId] = action.payload as [string, string];
        if (!wsId || !agentId || running.has(agentId)) continue;
        const token = Symbol(agentId);
        running.set(agentId, { wsId, token });
        const task = yield* fork(function* () {
          try {
            yield* call(loadAgentSessionSaga, wsId, agentId);
          } finally {
            if (running.get(agentId)?.token === token) running.delete(agentId);
          }
        });
        if (running.get(agentId)?.token === token) running.set(agentId, { wsId, task, token });
        continue;
      }

      const [wsId] = action.payload as [string];
      for (const [agentId, read] of running) {
        if (read.wsId !== wsId) continue;
        running.delete(agentId);
        if (read.task) yield* cancel(read.task);
      }
    }
  } finally {
    for (const read of running.values()) {
      if (read.task) yield* cancel(read.task);
    }
    running.clear();
  }
}