import {
  all,
  call,
  cancelled,
  delay,
  fork,
  put,
  spawn,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  getPendingAgentDeletion,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
  type PendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import { appClient } from '$lib/client';
import { withToastCountdown } from '$lib/components/ui/toast';
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
import {
  agentProposalResolveRequested,
  agentSessionDismissQuestionsRequested,
  updateSession,
} from '../agent-session-slice';
import {
  agentScopedProposalKey,
  proposalResolutionReconciled,
} from '../../proposal-lifecycle/proposal-lifecycle-slice';
import {
  activateAgentRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  removeAgent,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  restoreRetiredAgentRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
  undoAgentDeletionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { bulkUpsertSessions, removeSession, upsertSession } from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('AgentMutationSaga');
const UNDO_DURATION_MS = 15_000;
/**
 * How long the pending-registry tombstone outlives the daemon-owned commit
 * deadline. Stale `agent.list`/`agent.get` responses (background polls, bulk
 * refetches) computed before the daemon committed the delete can land after
 * it; the read paths reject tombstoned ids until this grace window ends.
 */
export const AGENT_DELETION_TOMBSTONE_TTL_MS = 60_000;

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
      withToastCountdown(
        {
          duration: UNDO_DURATION_MS,
          action: {
            label: m.agent_mutation_undo_label(),
            onClick: () => store.dispatch(undoAgentDeletionRequested(wsId, agentId)),
          },
        },
        { pauseOnHover: false },
      ),
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

/**
 * Un-retire a soft-retired agent (`agent.restore`, §5.5 soft retire). The
 * daemon clears `retiredAt` and emits `agent:restored`; the events bridge
 * refreshes the metadata, which moves the agent out of the Retired bin. The
 * local patch below makes the move immediate rather than event-latency-bound.
 */
function* restoreRetiredAgent(
  action: ReturnType<typeof restoreRetiredAgentRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.restore], agentId, wsId);
    if (!result.success) {
      const failure = new Error(result.error || m.agent_mutation_restoreRetiredFailed_error());
      yield* call(showError, failure.message);
      yield* put(action.failure(failure));
      settled = true;
      return;
    }
    const existing = yield* selectAgentSession.effect(agentId);
    if (existing?.retiredAt) {
      yield* call(persistSession, { ...existing, retiredAt: undefined });
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_restoreRetiredFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_restoreRetiredFailed_error())));
    }
  }
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
  const [wsId, agentId, , options] = action.payload;
  const specialistUpdate = options?.specialistUpdate;
  if (!specialistUpdate) {
    yield* put(action.success(undefined as never));
    return;
  }

  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.updateSpecialist], {
      agentId,
      workspaceId: wsId,
      ...specialistUpdate,
    });
    if (!result.success) {
      throw new Error(result.error || m.errors_catalog_storageWriteFailed_friendly());
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const failure = mutationError(error, m.errors_catalog_storageWriteFailed_friendly());
    const rollback = options?.specialistRollback;
    const current = yield* selectAgentSession.effect(agentId);
    const specialistStillOptimistic =
      (current?.metadata?.specialist ?? null) === specialistUpdate.specialist &&
      (specialistUpdate.model === undefined || current?.model === specialistUpdate.model);
    if (rollback && specialistStillOptimistic) {
      yield* put(updateSession(agentId, rollback));
    }
    yield* call(showError, failure.message);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.errors_catalog_storageWriteFailed_friendly())));
    }
  }
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

function* resolveProposal(
  action: ReturnType<typeof agentProposalResolveRequested>,
): SagaGenerator<void> {
  const [agentId, workspaceId, request] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.resolveProposal], {
      agentId,
      workspaceId,
      proposalId: request.proposalId,
      outcome: request.outcome,
      ...(request.detail !== undefined ? { detail: request.detail } : {}),
    });
    if (!result.success)
      throw new Error(result.error || m.agent_mutation_resolveProposalFailed_error());
    // Reconcile local lifecycle immediately — the tray retires the box
    // without waiting for the `agent:updated` metadata convergence. Keyed
    // per agent: daemon ids fall back to `preview.title` for id-less
    // proposals, so a global key would retire another agent's identically
    // titled proposal too.
    yield* put(
      proposalResolutionReconciled({
        proposalId: agentScopedProposalKey(agentId, request.proposalId),
        outcome: request.outcome,
        completedAt: Date.now(),
      }),
    );
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const failure = mutationError(error, m.agent_mutation_resolveProposalFailed_error());
    yield* call(showError, failure.message);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_resolveProposalFailed_error())));
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

/**
 * Clear a pending-registry entry once the daemon-owned deadline plus a
 * stale-refetch grace window have passed. The entry doubles as a tombstone:
 * read paths consult `isAgentDeletionPending` so `agent.list`/`agent.get`
 * responses computed before the daemon committed cannot resurrect the agent.
 * Only removes the exact entry it was spawned for, so a later re-delete's
 * fresh entry is never clobbered.
 */
function* clearTombstoneAfterGrace(entry: PendingAgentDeletion): SagaGenerator<void> {
  yield* delay(UNDO_DURATION_MS + AGENT_DELETION_TOMBSTONE_TTL_MS);
  if (getPendingAgentDeletion(entry.agentId) === entry) {
    removePendingAgentDeletion(entry.agentId);
  }
}

/** Clear an immediate-delete tombstone after stale reads have had time to settle. */
function* clearImmediateTombstoneAfterGrace(entry: PendingAgentDeletion): SagaGenerator<void> {
  yield* delay(AGENT_DELETION_TOMBSTONE_TTL_MS);
  if (getPendingAgentDeletion(entry.agentId) === entry) {
    removePendingAgentDeletion(entry.agentId);
  }
}

/** Roll back only if this attempt still owns the agent's deletion barrier. */
function* rollbackImmediateDeletion(entry: PendingAgentDeletion): SagaGenerator<void> {
  if (getPendingAgentDeletion(entry.agentId) !== entry) return;
  removePendingAgentDeletion(entry.agentId);
  if (entry.snapshot) {
    yield* call(restoreHiddenSession, entry.wsId, entry.snapshot);
  }
}

/**
 * Daemon-owned delete grace window (PROTOCOL §5.5, delete grace window):
 * `agent.delete { undoDelayMs }` is sent IMMEDIATELY, so the deletion commits
 * daemon-side at the deadline even if the FE quits or crashes. The FE
 * soft-hides the session and shows the Undo toast; Undo issues the race-safe
 * `agent.cancelDelete` (see `undoDeletion`) — `{ cancelled: true }` restores
 * the session, `{ cancelled: false }` (already committed) surfaces "could not
 * undo" without resurrecting it.
 */
function* deleteWithUndo(
  action: ReturnType<typeof deleteAgentWithUndoRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, agentName] = action.payload;
  let settled = false;
  let entry: PendingAgentDeletion | null = null;
  let clearerSpawned = false;
  try {
    const snapshot = yield* selectAgentSession.effect(agentId);
    if (!snapshot) {
      yield* put(action.success(null));
      settled = true;
      return;
    }
    yield* call(softHide, wsId, agentId);
    entry = { wsId, agentId, snapshot };
    setPendingAgentDeletion(entry);
    let result;
    try {
      result = yield* call([appClient.agents, appClient.agents.delete], agentId, wsId, {
        undoDelayMs: UNDO_DURATION_MS,
      });
    } catch (error) {
      result = {
        success: false as const,
        error: mutationError(error, m.agent_mutation_deleteFailed_error()).message,
      };
    }
    if (!result.success) {
      removePendingAgentDeletion(agentId);
      entry = null;
      yield* call(restoreHiddenSession, wsId, snapshot);
      const failure = new Error(result.error || m.agent_mutation_deleteFailed_error());
      yield* call(showError, failure.message);
      yield* put(action.failure(failure));
      settled = true;
      return;
    }
    yield* fork(showUndoToast, wsId, agentId, agentName);
    yield* put(action.success(snapshot));
    settled = true;
    // The daemon commits at the deadline. Keep the registry entry as a
    // tombstone for a grace window so stale refetch responses cannot
    // resurrect the deleted agent. Detached so it survives task teardown.
    yield* spawn(clearTombstoneAfterGrace, entry);
    clearerSpawned = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_deleteFailed_error())));
    settled = true;
  } finally {
    const wasCancelled = yield* cancelled();
    if (!settled && wasCancelled) {
      yield* put(action.failure(new Error(m.agent_mutation_deleteFailed_error())));
    }
    // Teardown mid-window: the daemon still owns the commit; just make sure
    // the tombstone is eventually lifted.
    if (wasCancelled && entry && !clearerSpawned) {
      yield* spawn(clearTombstoneAfterGrace, entry);
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
      settled = true;
      return;
    }
    let cancel;
    try {
      cancel = yield* call(
        [appClient.agents, appClient.agents.cancelDelete],
        agentId,
        pending.wsId,
      );
    } catch (error) {
      logger.error('agent.cancelDelete failed', { agentId, error });
      cancel = { success: false as const };
    }
    if (cancel.success && cancel.cancelled) {
      removePendingAgentDeletion(agentId);
      // This saga always registers entries with a snapshot; the guard covers
      // the registry's snapshot-less entries (events-bridge-registered).
      if (pending.snapshot) {
        yield* call(restoreHiddenSession, pending.wsId, pending.snapshot);
      }
      yield* put(action.success(true));
    } else {
      // Race-safe non-error: the daemon already committed (or the cancel RPC
      // failed) — never resurrect the agent locally.
      yield* call(showError, m.agent_mutation_undoDeleteFailed_error());
      yield* put(action.success(false));
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
  const entry: PendingAgentDeletion = { wsId, agentId, snapshot };
  let settled = false;
  let clearerSpawned = false;
  setPendingAgentDeletion(entry);
  try {
    yield* call(softHide, wsId, agentId);
    const result = yield* call([appClient.agents, appClient.agents.delete], agentId, wsId);
    if (!result.success) {
      yield* call(rollbackImmediateDeletion, entry);
      yield* call(showError, result.error || m.agent_mutation_deleteFailed_error());
      yield* put(action.failure(new Error(result.error || m.agent_mutation_deleteFailed_error())));
      settled = true;
      return;
    }
    yield* put(action.success(undefined as never));
    settled = true;
    yield* spawn(clearImmediateTombstoneAfterGrace, entry);
    clearerSpawned = true;
  } catch (error) {
    yield* call(rollbackImmediateDeletion, entry);
    yield* put(action.failure(mutationError(error, m.agent_mutation_deleteSessionFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* call(rollbackImmediateDeletion, entry);
      yield* put(action.failure(new Error(m.agent_mutation_deleteSessionFailed_error())));
    }
    if (settled && getPendingAgentDeletion(agentId) === entry && !clearerSpawned) {
      yield* spawn(clearImmediateTombstoneAfterGrace, entry);
    }
  }
}

export function* agentMutationSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(restoreAgentSessionRequested, restoreAgent),
    takeEvery(restoreRetiredAgentRequested, restoreRetiredAgent),
    takeEvery(activateAgentRequested, activateAgent),
    takeEvery(saveAgentSessionRequested, saveAgent),
    takeEvery(renameAgentSessionRequested, renameAgent),
    takeEvery(stopAgentSessionRequested, stopAgent),
    takeEvery(agentSessionDismissQuestionsRequested, dismissQuestions),
    takeEvery(agentProposalResolveRequested, resolveProposal),
    takeEvery(cancelAgentSubscriptionsRequested, cancelAgentSubscriptions),
    takeEvery(deleteAgentWithUndoRequested, deleteWithUndo),
    takeEvery(undoAgentDeletionRequested, undoDeletion),
    takeEvery(deleteAgentSessionRequested, deleteImmediately),
  ]);
}
