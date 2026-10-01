import { captureAgentMutationOwnership } from '$features/agent/agent-read-ownership';
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
import { dismissAgentAttentionToast } from '$features/agent/agent-attention-toast-service';
import {
  readAgentSession,
  refreshAgentSessionAfterEvent,
} from '$features/agent/agent-read-service';
import { appClient } from '$lib/client';
import { withToastCountdown } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { deriveAgentHasUnread } from '$shared/utils/agent-unread';
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
  setAgentBackgroundPending,
} from '../agent-session-slice';
import {
  agentScopedProposalKey,
  proposalResolutionReconciled,
} from '../../proposal-lifecycle/proposal-lifecycle-slice';
import {
  activateAgentRequested,
  agentRetirementSupportRequested,
  agentRetirementSupportReceived,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  removeAgent,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  restoreRetiredAgentRequested,
  retireAgentRequested,
  saveAgentSessionRequested,
  setAgentNotificationsMutedRequested,
  setAgentBackgroundRequested,
  hydrateAgentsRequested,
  addAgent,
  stopAgentSessionRequested,
  undoAgentDeletionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import {
  bulkUpsertSessions,
  removeSession,
  restoreStoredSessions,
  upsertSession,
} from '../agent-session-slice';
import type { StoredAgentSession, WireAgentSession } from '../agent-session-types';
import { selectAgentBackgroundPending, selectAgentSession } from '../agent-session-selectors';
import { selectDaemonConnectionGeneration } from '../../daemon-health/daemon-health-selectors';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { selectHidesAgentLifecycleActions } from '../../workspace/workspace-selectors';
import {
  agentMutationUiFinished,
  agentMutationUiRequested,
} from '../../agent-mutation-ui/agent-mutation-ui-slice';
import { selectAgentMutationUi } from '../../agent-mutation-ui/agent-mutation-ui-selectors';

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
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(message);
  } catch (error) {
    logger.error('Failed to surface agent mutation error', error);
  }
}

async function showUndoToast(wsId: string, agentId: string, agentName?: string): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    const { store } = await import('../../../store');
    notify.warning(
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

/** Store a genuine daemon snapshot (`agent.get` result) and register membership. */
function* persistSession(session: WireAgentSession): SagaGenerator<void> {
  yield* put(bulkUpsertSessions([session]));
  yield* put(upsertSession(session));
}

/**
 * Local patch of an already-stored session (activation bookkeeping), applied to
 * the CURRENT row through `updateSession`. Not a wire upsert: pushing the stored
 * row back through `bulkUpsertSessions` would re-run the FE-owned carry-forward
 * policy against it and drop fields such as a waiting `processQueueHint`. Not a
 * `restoreStoredSessions` of a spread snapshot either: a row captured before an
 * await would replace live updates (`liveTurnOpen`, `isStreaming`, …) that landed
 * while the read was pending. No-op when the row has since been removed; the
 * row's workspace membership was registered when it was first upserted.
 */
function* patchStoredSession(
  agentId: string,
  patch: Partial<AgentSession>,
): SagaGenerator<StoredAgentSession | undefined> {
  yield* put(updateSession(agentId, patch));
  return yield* selectAgentSession.effect(agentId);
}

function* softHide(wsId: string, agentId: string): SagaGenerator<void> {
  yield* put(removeAgent(wsId, agentId));
  yield* put(removeSession(agentId));
  yield* put(removeWatchedAgent(wsId, agentId));
  yield* put(pruneRecentlyClosed(wsId, { agentId }));
}

/**
 * Reinstate a session captured from this slice before a soft-hide. Goes
 * through `restoreStoredSessions`, not the wire upsert: the upsert's FE-owned
 * carry-forward seeds from the (now removed) existing row and would strip the
 * snapshot's FE-owned fields.
 */
function* restoreHiddenSession(wsId: string, session: StoredAgentSession): SagaGenerator<void> {
  yield* put(restoreStoredSessions([session]));
  yield* put(refreshWorkspaceSubscriptionEntriesRequested(wsId));
}

function* loadRetirementSupport(
  action: ReturnType<typeof agentRetirementSupportRequested>,
): SagaGenerator<void> {
  const generation = yield* selectDaemonConnectionGeneration.effect();
  let supported = false;
  try {
    supported = yield* call([appClient.agents, appClient.agents.supportsRetirement], generation);
    if (generation === (yield* selectDaemonConnectionGeneration.effect())) {
      yield* put(agentRetirementSupportReceived(generation, supported));
    }
  } catch {
    supported = false;
  } finally {
    yield* put(action.success(supported));
  }
}

function* retireAgent(action: ReturnType<typeof retireAgentRequested>): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  const initial = yield* selectAgentSession.effect(agentId);
  // A stale workspace action may still settle its RPC, but cannot claim or
  // publish into a row now owned by another workspace.
  const ownership =
    !initial || initial.workspaceId === wsId
      ? captureAgentMutationOwnership(agentId, wsId)
      : undefined;
  let settled = false;
  try {
    const generation = yield* selectDaemonConnectionGeneration.effect();
    if (
      !(yield* call([appClient.agents, appClient.agents.supportsRetirement], generation)) ||
      generation !== (yield* selectDaemonConnectionGeneration.effect())
    ) {
      throw new Error(m.agent_mutation_retireUnavailable_error());
    }
    const beforeRetire = yield* selectAgentSession.effect(agentId);
    const result = yield* call([appClient.agents, appClient.agents.retire], agentId, wsId);
    if (!result.success) throw new Error(result.error || m.agent_mutation_retireFailed_error());
    const current = yield* selectAgentSession.effect(agentId);
    if (ownership?.isCurrent(current?.workspaceId)) {
      if (
        beforeRetire &&
        beforeRetire === current &&
        generation === (yield* selectDaemonConnectionGeneration.effect())
      ) {
        yield* put(updateSession(agentId, { retiredAt: result.retiredAt }));
      } else {
        // Events and Restore can overtake this response. Reconcile the same
        // workspace through the trailing read instead of replaying an old timestamp.
        yield* spawn(refreshAgentSessionAfterEvent, agentId, wsId);
      }
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(mutationError(error, m.agent_mutation_retireFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_retireFailed_error())));
    }
  }
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
  const initial = yield* selectAgentSession.effect(agentId);
  // A stale workspace action may still settle its RPC, but cannot claim or
  // publish into a row now owned by another workspace.
  const ownership =
    !initial || initial.workspaceId === wsId
      ? captureAgentMutationOwnership(agentId, wsId)
      : undefined;
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
    if (existing?.retiredAt && ownership?.isCurrent(existing.workspaceId)) {
      yield* put(restoreStoredSessions([{ ...existing, retiredAt: undefined }]));
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
  const existing = yield* selectAgentSession.effect(agentId);
  // A cached row from another workspace is not this restoration's session.
  // Do not claim its ownership or hand it back to the send/activation caller.
  if (existing && existing.workspaceId !== wsId) {
    yield* put(action.success(null));
    return;
  }
  const ownership = captureAgentMutationOwnership(agentId, wsId);
  let settled = false;
  try {
    if (hasUsableSession(existing)) {
      yield* put(action.success(existing));
    } else {
      const fetched = yield* call(readAgentSession, agentId, wsId);
      const current = yield* selectAgentSession.effect(agentId);
      // readAgentSession returns metadata; this consumer owns the state write.
      // Recheck before both the persisted projection and fallback resolution.
      if (!ownership.isCurrent(current?.workspaceId) || (fetched && fetched.workspaceId !== wsId)) {
        yield* put(action.success(null));
      } else if (!fetched) {
        yield* put(action.success(current ?? null));
      } else {
        const session = {
          ...preserveMessages(fetched, current),
          workspaceId: wsId as AgentSession['workspaceId'],
        };
        yield* call(persistSession, session);
        yield* put(action.success(session));
      }
    }
    settled = true;
  } catch (error) {
    if (ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)) {
      yield* put(action.failure(mutationError(error, m.agent_mutation_restoreFailed_error())));
    } else {
      yield* put(action.success(null));
    }
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_restoreFailed_error())));
    }
  }
}

function* activateAgent(action: ReturnType<typeof activateAgentRequested>): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  const ownership = captureAgentMutationOwnership(agentId, wsId);
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
      yield* call(patchStoredSession, agentId, {
        workspaceId: wsId as AgentSession['workspaceId'],
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts,
      });
    }
    const fetched = yield* call(readAgentSession, agentId, wsId);
    if (!ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)) {
      yield* put(action.success(null));
      settled = true;
      return;
    }
    if (fetched) {
      const source = preserveMessages(fetched, existing);
      const activated: WireAgentSession = {
        ...source,
        workspaceId: wsId as AgentSession['workspaceId'],
        status: source.backendSessionId ? AgentStatus.Active : source.status,
        activationState: AgentActivationState.ACTIVE,
        activationAttempts,
      };
      yield* call(persistSession, activated);
      yield* put(action.success(activated));
    } else {
      // Reselect: the row may have changed (or gone) while the read was pending.
      const current = yield* selectAgentSession.effect(agentId);
      const activated = current
        ? yield* call(patchStoredSession, agentId, {
            workspaceId: wsId as AgentSession['workspaceId'],
            status: current.backendSessionId ? AgentStatus.Active : current.status,
            activationState: AgentActivationState.ACTIVE,
            activationAttempts,
          })
        : undefined;
      yield* put(action.success(activated ?? null));
    }
    settled = true;
  } catch (error) {
    if (existing && ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)) {
      yield* call(patchStoredSession, agentId, {
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

type RenameIdentity = Pick<AgentSession, 'name' | 'nameExplicitlySet'>;
interface RenameAttempt {
  identity: RenameIdentity;
  status: 'pending' | 'succeeded' | 'failed';
}
interface RenameSequence {
  initial: RenameIdentity;
  published: RenameIdentity;
  attempts: RenameAttempt[];
}

function* renameAgent(
  sequences: Map<string, RenameSequence>,
  action: ReturnType<typeof renameAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, name] = action.payload;
  const previous = yield* selectAgentSession.effect(agentId);
  const ownership =
    !previous || previous.workspaceId === wsId
      ? captureAgentMutationOwnership(agentId, wsId)
      : undefined;
  const key = `${ownership?.key}:${agentId}`;
  let sequence = sequences.get(key);
  const attempt: RenameAttempt = { identity: { name, nameExplicitlySet: true }, status: 'pending' };
  if (previous && ownership) {
    if (
      !sequence ||
      previous.name !== sequence.published.name ||
      previous.nameExplicitlySet !== sequence.published.nameExplicitlySet
    ) {
      // A daemon hydration supersedes the earlier optimistic identity. A new
      // rename starts from that authoritative identity, not the stale chain.
      const initial = { name: previous.name, nameExplicitlySet: previous.nameExplicitlySet };
      sequence = { initial, published: initial, attempts: [] };
      sequences.set(key, sequence);
    }
    sequence.attempts.push(attempt);
    sequence.published = attempt.identity;
    yield* put(updateSession(agentId, attempt.identity));
  }
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.rename], agentId, name, wsId);
    if (!result.success) throw new Error(result.error || m.agent_mutation_renameFailed_error());
    attempt.status = 'succeeded';
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    attempt.status = 'failed';
    yield* put(action.failure(mutationError(error, m.agent_mutation_renameSessionFailed_error())));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      attempt.status = 'failed';
      yield* put(action.failure(new Error(m.agent_mutation_renameSessionFailed_error())));
    }
    if (sequence && sequences.get(key) === sequence) {
      if (attempt.status === 'failed') {
        const current = yield* selectAgentSession.effect(agentId);
        // Compare ownership AND the write sequence, not just the name: two
        // requests can use the same name and the newer one may have succeeded.
        const identity =
          sequence.attempts.findLast((item) => item.status !== 'failed')?.identity ??
          sequence.initial;
        if (
          current &&
          ownership?.isCurrent(current.workspaceId) &&
          current.name === sequence.published.name &&
          current.nameExplicitlySet === sequence.published.nameExplicitlySet
        ) {
          yield* put(updateSession(agentId, identity));
          sequence.published = identity;
        }
      }
      if (sequence.attempts.every((item) => item.status !== 'pending')) sequences.delete(key);
    }
  }
}

function* stopAgent(action: ReturnType<typeof stopAgentSessionRequested>): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.stop], agentId, wsId);
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

function* setBackground(
  action: ReturnType<typeof setAgentBackgroundRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, isBackground] = action.payload;
  // One mutation per agent, including duplicate actions from other mounted cards.
  if (yield* selectAgentBackgroundPending.effect(agentId)) {
    yield* put(action.success(undefined as never));
    return;
  }
  const initial = yield* selectAgentSession.effect(agentId);
  if (!initial || initial.workspaceId !== wsId || initial.retiredAt) {
    yield* put(action.failure(new Error(m.agent_mutation_setBackgroundFailed_error())));
    return;
  }
  const ownership = captureAgentMutationOwnership(agentId, wsId);
  yield* put(setAgentBackgroundPending(agentId, true));
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.setBackground], {
      agentId,
      workspaceId: wsId,
      isBackground,
    });
    if (!result.success)
      throw new Error(result.error || m.agent_mutation_setBackgroundFailed_error());
    const current = yield* selectAgentSession.effect(agentId);
    if (current && ownership.isCurrent(current.workspaceId)) {
      // Only patch mode, keeping transcript, runtime flags, and task/parent metadata
      // that may have changed while the request was in flight.
      const changes = {
        isBackground,
        metadata: { ...current.metadata, isBackground },
        ...(current.agentMetadata
          ? { agentMetadata: { ...current.agentMetadata, isBackground } }
          : {}),
      };
      const next = { ...current, ...changes };
      yield* put(updateSession(agentId, { ...changes, hasUnread: deriveAgentHasUnread(next) }));
      yield* put(addAgent(wsId, next));
      // Existing coalesced hydration refreshes authoritative bin counts and loaded groups.
      yield* put(hydrateAgentsRequested(wsId));
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const failure = mutationError(error, m.agent_mutation_setBackgroundFailed_error());
    yield* call(showError, failure.message);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    yield* put(setAgentBackgroundPending(agentId, false));
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_setBackgroundFailed_error())));
    }
  }
}

function* setNotificationsMuted(
  action: ReturnType<typeof setAgentNotificationsMutedRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, notificationsMuted] = action.payload;
  // Optimistic flip so the menu label / indicator respond immediately; the
  // `agent:updated` push re-derives the same fields through normalizeAgent.
  const previous = yield* selectAgentSession.effect(agentId);
  const previousMuted = previous?.notificationsMuted;
  if (previous !== undefined) {
    yield* put(
      updateSession(agentId, {
        notificationsMuted,
        hasUnread: deriveAgentHasUnread({ ...previous, notificationsMuted }),
      }),
    );
  }
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.setNotificationsMuted], {
      agentId,
      workspaceId: wsId,
      notificationsMuted,
    });
    if (!result.success)
      throw new Error(result.error || m.agent_mutation_setNotificationsMutedFailed_error());
    yield* put(action.success(undefined as never));
    settled = true;
    // A muted agent never alerts: drop the sticky attention toast it may
    // already have raised — the service only skips NEW toasts for muted agents.
    if (notificationsMuted) yield* call(dismissAgentAttentionToast, agentId);
  } catch (error) {
    const failure = mutationError(error, m.agent_mutation_setNotificationsMutedFailed_error());
    if (previous !== undefined) {
      // Re-derive unread from the live session rather than the pre-request
      // snapshot: a message or seen-marker may have landed while the RPC was
      // pending, and only the mute flag itself is being rolled back.
      const current = yield* selectAgentSession.effect(agentId);
      if (current !== undefined && current.notificationsMuted === notificationsMuted) {
        yield* put(
          updateSession(agentId, {
            notificationsMuted: previousMuted,
            hasUnread: deriveAgentHasUnread({ ...current, notificationsMuted: previousMuted }),
          }),
        );
      }
    }
    yield* call(showError, failure.message);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_mutation_setNotificationsMutedFailed_error())));
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
  const current = yield* selectAgentSession.effect(entry.agentId);
  if (
    entry.snapshot &&
    entry.snapshot.workspaceId === entry.wsId &&
    (!current || current === entry.snapshot)
  ) {
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
    // `agent.delete` is refused with -32003 for a collaborator connection: the
    // delete affordances are withheld, and a request that still arrives is
    // refused here before the session is hidden or anything is sent.
    if (yield* selectHidesAgentLifecycleActions.effect(wsId)) {
      logger.warn('Agent deletion refused for a collaborator connection', { workspaceId: wsId });
      const failure = new Error(m.agent_mutation_deleteNotPermitted_error());
      yield* call(showError, failure.message);
      yield* put(action.failure(failure));
      settled = true;
      return;
    }
    const snapshot = yield* selectAgentSession.effect(agentId);
    if (!snapshot || snapshot.workspaceId !== wsId) {
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
      yield* call(rollbackImmediateDeletion, entry);
      entry = null;
      const failure = new Error(
        result.forbidden
          ? m.agent_mutation_deleteNotPermitted_error()
          : result.error || m.agent_mutation_deleteFailed_error(),
      );
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
  const [wsId, agentId] = action.payload;
  let settled = false;
  try {
    const pending = getPendingAgentDeletion(agentId);
    if (!pending || pending.wsId !== wsId) {
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
    if (cancel.success && cancel.cancelled && getPendingAgentDeletion(agentId) === pending) {
      removePendingAgentDeletion(agentId);
      // This saga always registers entries with a snapshot; the guard covers
      // the registry's snapshot-less entries (events-bridge-registered).
      const current = yield* selectAgentSession.effect(agentId);
      if (
        pending.snapshot &&
        pending.snapshot.workspaceId === wsId &&
        (!current || current === pending.snapshot)
      ) {
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
  if (
    (snapshot && snapshot.workspaceId !== wsId) ||
    (yield* selectHidesAgentLifecycleActions.effect(wsId))
  ) {
    yield* put(action.failure(new Error(m.agent_mutation_deleteNotPermitted_error())));
    return;
  }
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
      // Cancellation stops observation, not the transport. The daemon may
      // already have deleted this agent; retain the same read barrier.
      yield* put(action.failure(new Error(m.agent_mutation_deleteSessionFailed_error())));
    }
    if (getPendingAgentDeletion(agentId) === entry && !clearerSpawned) {
      yield* spawn(clearImmediateTombstoneAfterGrace, entry);
    }
  }
}

/** UI outcomes observe the original request; the existing worker alone owns I/O. */
function* mutateFromUi(
  inFlight: Set<string>,
  action: ReturnType<typeof agentMutationUiRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumerId, requestId, agentId, operation] = action.payload;
  const key = JSON.stringify([workspaceId, consumerId, requestId]);
  if (inFlight.has(key)) return;
  const current = yield* selectAgentMutationUi.effect(workspaceId, consumerId);
  if (current?.requestId !== requestId || current.status !== 'pending') return;
  const backendId = yield* selectCurrentConnectionId.effect();
  const generation = yield* selectDaemonConnectionGeneration.effect();
  inFlight.add(key);
  const request =
    operation.kind === 'rename'
      ? renameAgentSessionRequested(workspaceId, agentId, operation.name)
      : operation.kind === 'retire'
        ? retireAgentRequested(workspaceId, agentId)
        : operation.kind === 'delete'
          ? deleteAgentWithUndoRequested(workspaceId, agentId, operation.name)
          : operation.kind === 'cancelSubscriptions'
            ? cancelAgentSubscriptionsRequested(workspaceId, agentId, {
                subscriptionId: operation.subscriptionId,
                groupId: operation.groupId,
              })
            : stopAgentSessionRequested(workspaceId, agentId);
  try {
    yield* put(request);
    yield* call(() => request.promise);
    const contextCurrent =
      (yield* selectCurrentConnectionId.effect()) === backendId &&
      (yield* selectDaemonConnectionGeneration.effect()) === generation;
    yield* put(
      agentMutationUiFinished(
        workspaceId,
        consumerId,
        requestId,
        contextCurrent ? 'succeeded' : 'cancelled',
      ),
    );
  } catch (error) {
    const contextCurrent =
      (yield* selectCurrentConnectionId.effect()) === backendId &&
      (yield* selectDaemonConnectionGeneration.effect()) === generation;
    if (!contextCurrent) {
      yield* put(agentMutationUiFinished(workspaceId, consumerId, requestId, 'cancelled'));
      return;
    }
    const current = yield* selectAgentMutationUi.effect(workspaceId, consumerId);
    if (current?.requestId === requestId && operation.kind === 'rename') {
      yield* call(showError, m.chat_agentCard_renameFailed_error());
    }
    logger.error('Agent UI mutation failed', { workspaceId, agentId, kind: operation.kind, error });
    yield* put(
      agentMutationUiFinished(
        workspaceId,
        consumerId,
        requestId,
        'failed',
        mutationError(error, m.ui_dialog_submitFailed_error()).message,
      ),
    );
  } finally {
    inFlight.delete(key);
    if (yield* cancelled()) {
      yield* put(agentMutationUiFinished(workspaceId, consumerId, requestId, 'cancelled'));
    }
  }
}

export function* agentMutationSaga(): SagaGenerator<void> {
  // In-flight write identities are runtime ownership, never persisted state.
  const renames = new Map<string, RenameSequence>();
  const uiRequests = new Set<string>();
  yield* all([
    takeEvery(agentMutationUiRequested, mutateFromUi, uiRequests),
    takeEvery(restoreAgentSessionRequested, restoreAgent),
    takeEvery(restoreRetiredAgentRequested, restoreRetiredAgent),
    takeEvery(retireAgentRequested, retireAgent),
    takeEvery(agentRetirementSupportRequested, loadRetirementSupport),
    takeEvery(activateAgentRequested, activateAgent),
    takeEvery(saveAgentSessionRequested, saveAgent),
    takeEvery(renameAgentSessionRequested, renameAgent, renames),
    takeEvery(stopAgentSessionRequested, stopAgent),
    takeEvery(setAgentNotificationsMutedRequested, setNotificationsMuted),
    takeEvery(setAgentBackgroundRequested, setBackground),
    takeEvery(agentSessionDismissQuestionsRequested, dismissQuestions),
    takeEvery(agentProposalResolveRequested, resolveProposal),
    takeEvery(cancelAgentSubscriptionsRequested, cancelAgentSubscriptions),
    takeEvery(deleteAgentWithUndoRequested, deleteWithUndo),
    takeEvery(undoAgentDeletionRequested, undoDeletion),
    takeEvery(deleteAgentSessionRequested, deleteImmediately),
  ]);
}
