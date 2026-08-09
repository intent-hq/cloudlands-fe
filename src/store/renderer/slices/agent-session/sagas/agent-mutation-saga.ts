import type { Task } from 'redux-saga';
import {
  all,
  call,
  cancel,
  cancelled,
  delay,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  getPendingAgentDeletion,
  listPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { pruneRecentlyClosed } from '../../panel-layout/panel-layout-slice';
import {
  cancelAgentSubscriptionsRequested,
  refreshWorkspaceSubscriptionEntriesRequested,
  removeWatchedAgent,
} from '../../agent-subscription-ui/agent-subscription-ui-slice';
import { agentSessionDismissQuestionsRequested } from '../agent-session-slice';
import {
  activateAgentRequested,
  commitPendingAgentDeletionRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  flushPendingAgentDeletionsRequested,
  removeAgent,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
  undoAgentDeletionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { bulkUpsertSessions, removeSession, upsertSession } from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('AgentMutationSaga');
const UNDO_DURATION_MS = 15_000;
const pendingCommitTasks = new Map<string, Task>();

function mutationError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : fallback);
}

async function showError(message: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface agent mutation error', error);
  }
}

async function showUndoToast(wsId: string, agentId: string, agentName?: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    const { store } = await import('../../../store');
    toast.warning(
      agentName
        ? m.agent_mutation_deletedAgent_message({ name: agentName })
        : m.agent_mutation_deletedAgentGeneric_message(),
      {
        duration: UNDO_DURATION_MS,
        action: {
          label: m.agent_mutation_undo_label(),
          onClick: () => store.dispatch(undoAgentDeletionRequested(wsId, agentId)),
        },
      },
    );
  } catch (error) {
    logger.error('Failed to show agent deletion undo toast', error);
  }
}

function hasUsableSession(session: AgentSession | undefined): session is AgentSession {
  return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
}

function preserveMessages(fetched: AgentSession, existing?: AgentSession): AgentSession {
  return fetched.messages?.length || !existing?.messages.length
    ? fetched
    : { ...fetched, messages: existing.messages };
}

function* persistSession(session: AgentSession): SagaGenerator<void> {
  yield* put(bulkUpsertSessions([session]));
  yield* put(upsertSession(session));
}

function* softHide(wsId: string, agentId: string): SagaGenerator<void> {
  yield* put(removeAgent(wsId, agentId));
  yield* put(removeSession(agentId));
  yield* put(removeWatchedAgent(wsId, agentId));
  yield* put(pruneRecentlyClosed(wsId, { agentId }));
}

function* restoreHiddenSession(wsId: string, session: AgentSession): SagaGenerator<void> {
  yield* call(persistSession, session);
  yield* put(refreshWorkspaceSubscriptionEntriesRequested(wsId));
}

function* restoreAgent(
  action: ReturnType<typeof restoreAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  let settled = false;
  try {
    const existing = yield* selectAgentSession.effect(agentId);
    if (hasUsableSession(existing)) {
      yield* put(action.success(existing));
    } else {
      const fetched = yield* call([appClient.agents, appClient.agents.get], agentId);
      if (!fetched) {
        yield* put(action.success(existing ?? null));
      } else {
        const session = {
          ...preserveMessages(fetched, existing),
          workspaceId: wsId as AgentSession['workspaceId'],
        };
        yield* call(persistSession, session);
        yield* put(action.success(session));
      }
    }
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_restoreFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_restoreFailed_error())));
    }
  }
}

function* activateAgent(action: ReturnType<typeof activateAgentRequested>): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  const existing = yield* selectAgentSession.effect(agentId);
  let settled = false;
  try {
    if (existing?.backendSessionId && existing.status === AgentStatus.Active) {
      yield* put(action.success(existing));
      settled = true;
      return;
    }
    const activationAttempts = (existing?.activationAttempts || 0) + 1;
    if (existing) {
      yield* call(persistSession, {
        ...existing,
        workspaceId: wsId as AgentSession['workspaceId'],
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts,
      });
    }
    const fetched = yield* call([appClient.agents, appClient.agents.get], agentId);
    const source = fetched ? preserveMessages(fetched, existing) : existing;
    if (!source) {
      yield* put(action.success(null));
    } else {
      const activated: AgentSession = {
        ...source,
        workspaceId: wsId as AgentSession['workspaceId'],
        status: source.backendSessionId ? AgentStatus.Active : source.status,
        activationState: AgentActivationState.ACTIVE,
        activationAttempts,
      };
      yield* call(persistSession, activated);
      yield* put(action.success(activated));
    }
    settled = true;
  } catch (error) {
    if (existing) {
      yield* call(persistSession, {
        ...existing,
        workspaceId: wsId as AgentSession['workspaceId'],
        activationState: AgentActivationState.ERROR,
        lastActivationError: mutationError(error, m.agent_mutation_activateFailed_error()).message,
      });
    }
    yield* put(action.failure(mutationError(error, m.agent_mutation_activateFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_activateFailed_error())));
    }
  }
}

function* saveAgent(action: ReturnType<typeof saveAgentSessionRequested>): SagaGenerator<void> {
  yield* put(action.success(undefined as never));
}

function* renameAgent(action: ReturnType<typeof renameAgentSessionRequested>): SagaGenerator<void> {
  const [wsId, agentId, name] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.rename], agentId, name, wsId);
    if (!result.success) throw new Error(result.error || m.agent_mutation_renameFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_renameSessionFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_renameSessionFailed_error())));
    }
  }
}

function* stopAgent(action: ReturnType<typeof stopAgentSessionRequested>): SagaGenerator<void> {
  const [, agentId] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.stop], agentId);
    if (!result.success) throw new Error(result.error || m.agent_mutation_stopFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_stopFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_stopFailed_error())));
    }
  }
}

function* dismissQuestions(
  action: ReturnType<typeof agentSessionDismissQuestionsRequested>,
): SagaGenerator<void> {
  const [agentId, workspaceId, messageId] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.dismissQuestions], {
      agentId,
      workspaceId,
      messageId,
    });
    if (!result.success)
      throw new Error(result.error || m.agent_mutation_dismissQuestionsFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const failure = mutationError(error, m.agent_mutation_dismissQuestionsFailed_error());
    yield* call(showError, failure.message);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_dismissQuestionsFailed_error())));
    }
  }
}

function* cancelAgentSubscriptions(
  action: ReturnType<typeof cancelAgentSubscriptionsRequested>,
): SagaGenerator<void> {
  const [workspaceId, agentId, scope = {}] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.cancelSubscriptions], {
      agentId,
      workspaceId,
      ...(scope.subscriptionId ? { subscriptionId: scope.subscriptionId } : {}),
      ...(scope.groupId ? { groupId: scope.groupId } : {}),
    });
    if (!result.success)
      throw new Error(result.error || m.agent_mutation_cancelSubscriptionsFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(
      action.failure(mutationError(error, m.agent_mutation_cancelSubscriptionsFailed_error())),
    );
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_cancelSubscriptionsFailed_error())));
    }
  }
}

function* cancelPendingTimer(agentId: string): SagaGenerator<void> {
  const task = pendingCommitTasks.get(agentId);
  pendingCommitTasks.delete(agentId);
  if (task) yield* cancel(task);
}

function* commitDeletion(agentId: string, cancelTimer = true): SagaGenerator<void> {
  const pending = getPendingAgentDeletion(agentId);
  if (!pending) return;
  if (cancelTimer) yield* call(cancelPendingTimer, agentId);
  removePendingAgentDeletion(agentId);
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.delete],
      pending.agentId,
      pending.wsId,
    );
    if (!result.success) {
      yield* call(restoreHiddenSession, pending.wsId, pending.snapshot);
      yield* call(showError, result.error || m.agent_mutation_deleteFailed_error());
      return;
    }
    yield* put(pruneRecentlyClosed(pending.wsId, { agentId: pending.agentId }));
  } catch (error) {
    yield* call(restoreHiddenSession, pending.wsId, pending.snapshot);
    yield* call(showError, mutationError(error, m.agent_mutation_deleteFailed_error()).message);
  }
}

function* commitAfterUndoWindow(agentId: string): SagaGenerator<void> {
  yield* delay(UNDO_DURATION_MS);
  pendingCommitTasks.delete(agentId);
  yield* call(commitDeletion, agentId, false);
}

function* deleteWithUndo(
  action: ReturnType<typeof deleteAgentWithUndoRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, agentName] = action.payload;
  let settled = false;
  try {
    const snapshot = yield* selectAgentSession.effect(agentId);
    if (!snapshot) {
      yield* put(action.success(null));
      settled = true;
      return;
    }
    yield* call(cancelPendingTimer, agentId);
    yield* call(softHide, wsId, agentId);
    setPendingAgentDeletion({ wsId, agentId, snapshot, timer: null });
    const timerTask = yield* fork(commitAfterUndoWindow, agentId);
    pendingCommitTasks.set(agentId, timerTask);
    yield* fork(showUndoToast, wsId, agentId, agentName);
    yield* put(action.success(snapshot));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_deleteFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_deleteFailed_error())));
    }
  }
}

function* undoDeletion(action: ReturnType<typeof undoAgentDeletionRequested>): SagaGenerator<void> {
  const [, agentId] = action.payload;
  let settled = false;
  try {
    const pending = getPendingAgentDeletion(agentId);
    if (!pending) {
      yield* put(action.success(false));
    } else {
      yield* call(cancelPendingTimer, agentId);
      removePendingAgentDeletion(agentId);
      yield* call(restoreHiddenSession, pending.wsId, pending.snapshot);
      yield* put(action.success(true));
    }
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_undoDeleteFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_undoDeleteFailed_error())));
    }
  }
}

function* deleteImmediately(
  action: ReturnType<typeof deleteAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  const snapshot = yield* selectAgentSession.effect(agentId);
  let settled = false;
  try {
    yield* call(softHide, wsId, agentId);
    const result = yield* call([appClient.agents, appClient.agents.delete], agentId, wsId);
    if (!result.success) {
      if (snapshot) yield* call(restoreHiddenSession, wsId, snapshot);
      yield* call(showError, result.error || m.agent_mutation_deleteFailed_error());
      yield* put(action.failure(new Error(result.error || m.agent_mutation_deleteFailed_error())));
      settled = true;
      return;
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    if (snapshot) yield* call(restoreHiddenSession, wsId, snapshot);
    yield* put(action.failure(mutationError(error, m.agent_mutation_deleteSessionFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      if (snapshot) yield* call(restoreHiddenSession, wsId, snapshot);
      yield* put(action.failure(new Error(m.agent_mutation_deleteSessionFailed_error())));
    }
  }
}

function* commitRequested(
  action: ReturnType<typeof commitPendingAgentDeletionRequested>,
): SagaGenerator<void> {
  yield* call(commitDeletion, action.payload[1]);
}

function* flushDeletions(
  action: ReturnType<typeof flushPendingAgentDeletionsRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  let settled = false;
  try {
    const pending = listPendingAgentDeletions().filter((entry) => entry.wsId === wsId);
    yield* all(pending.map((entry) => call(commitDeletion, entry.agentId)));
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_flushDeletionsFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_flushDeletionsFailed_error())));
    }
  }
}

function* flushAllPendingOnCancellation(): SagaGenerator<void> {
  for (const task of pendingCommitTasks.values()) yield* cancel(task);
  pendingCommitTasks.clear();
  const pending = listPendingAgentDeletions();
  yield* all(pending.map((entry) => call(commitDeletion, entry.agentId, false)));
}

export function* agentMutationSaga(): SagaGenerator<void> {
  try {
    yield* all([
      takeEvery(restoreAgentSessionRequested, restoreAgent),
      takeEvery(activateAgentRequested, activateAgent),
      takeEvery(saveAgentSessionRequested, saveAgent),
      takeEvery(renameAgentSessionRequested, renameAgent),
      takeEvery(stopAgentSessionRequested, stopAgent),
      takeEvery(agentSessionDismissQuestionsRequested, dismissQuestions),
      takeEvery(cancelAgentSubscriptionsRequested, cancelAgentSubscriptions),
      takeEvery(deleteAgentWithUndoRequested, deleteWithUndo),
      takeEvery(undoAgentDeletionRequested, undoDeletion),
      takeEvery(deleteAgentSessionRequested, deleteImmediately),
      takeEvery(commitPendingAgentDeletionRequested, commitRequested),
      takeEvery(flushPendingAgentDeletionsRequested, flushDeletions),
    ]);
  } finally {
    if (yield* cancelled()) yield* call(flushAllPendingOnCancellation);
  }
}
