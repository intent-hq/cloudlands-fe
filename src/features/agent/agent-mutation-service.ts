/**
 * Agent mutation service — the post-saga consumer for the three orphaned
 * agent-session async-action triggers awaited by `agent-send`:
 * `restoreAgentSessionRequested`, `activateAgentRequested`, and
 * `saveAgentSessionRequested`.
 *
 * These triggers lost their handlers when the saga runtime was removed (they
 * lived in `slices/workspace-agents/sagas/agent-creation-saga.ts` and
 * `agent-session-restore-saga.ts`), so the lifecycle's `await action.promise`
 * sites in `sendMessage()` hung forever and pressing Send produced no user
 * message or stream. This restores the resolve path WITHOUT re-adding a saga
 * and WITHOUT changing any dispatch site: `createAgentMutationMiddleware()`
 * observes dispatched actions and, after the reducer runs, services each
 * trigger by reading/refetching via the `AppClient` seam, persisting the
 * resolved session into Redux, and dispatching the per-dispatch
 * `action.success`/`action.failure` so the action's internal promise settles.
 *
 * Restore: read the existing agent session; if usable (backendSessionId set
 * and not Pending), resolve with it; otherwise `appClient.agents.get(agentId)`
 * and persist the result. Save: a no-op on the mock seam — the agent-session
 * slice IS the runtime state, there is no separate persistence layer to flush
 * — so the action resolves immediately with `undefined`. Activate: mark the
 * session ACTIVATING, refetch via `appClient.agents.get`, then persist as
 * ACTIVE (promoting `status` to Active when a backendSessionId is present);
 * on failure mark ERROR and reject.
 *
 * It also services `renameAgentSessionRequested`: the dispatch sites
 * (AgentCard / PanelLayout) apply the rename to Redux optimistically BEFORE
 * dispatching and revert on rejection, so the handler only forwards
 * `agent.rename` (PROTOCOL §5.5) and settles the promise — the daemon's
 * `agent:renamed` event reconciles other windows.
 *
 * It also services `stopAgentSessionRequested` (forward `agent.stop`, §5.5 —
 * the daemon's terminal `agent:stream:end` converges streaming state) and
 * `cancelAgentSubscriptionsRequested` (forward `agent.cancelSubscriptions`,
 * §5.5, with optional `subscriptionId` / `groupId` scoping — the daemon's
 * `agent:subscriptions-changed` event drives the footer refetch).
 *
 * It also services the orphaned agent-deletion triggers
 * (`deleteAgentWithUndoRequested`, `deleteAgentSessionRequested`,
 * `undoAgentDeletionRequested`, `commitPendingAgentDeletionRequested`,
 * `flushPendingAgentDeletionsRequested`) using a soft-hide-then-commit pattern:
 * delete soft-hides the session locally (no daemon call) and arms a commit
 * timer; undo un-hides it (no daemon call); only commit/flush/timer-elapse fire
 * the real `agent.delete`. The daemon then emits `agent:deleted`
 * (`AGENT_LIFECYCLE_EVENTS`), which reconciles the list. See AGENTS.md.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions/types, store-free constants, shared
 * types, and the logger. No selector modules (importing them would evaluate
 * `store.createSelector` during middleware-chain construction); state is read
 * directly off `appStore.state.agentSessions.byAgentId`. The toast library
 * is imported lazily inside handlers so the static graph stays light.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  agentSessionDismissQuestionsRequested,
  bulkUpsertSessions,
  removeSession,
  updateSession,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { pruneRecentlyClosed } from '$store/renderer/slices/panel-layout/panel-layout-slice';
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
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { cancelAgentSubscriptionsRequested } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  getPendingAgentDeletion,
  listPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from './utils/pending-agent-deletions';

const logger = createLogger('AgentMutationService');

/** Undo window before a soft-hidden agent deletion is committed to the daemon. */
const UNDO_DURATION_MS = 15000;

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
async function getToast() {
  const { toast } = await import('svelte-sonner');
  return toast;
}

/** Direct one-time session read, dependency-light (no selector import). */
function readSession(agentId: string): AgentSession | undefined {
  const state = appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } };
  return state.agentSessions?.byAgentId[agentId];
}

/**
 * Persist a session into BOTH stores: `bulkUpsertSessions` populates the
 * agent-session slice (`byAgentId` = session + conversation) — the reducer
 * only consumes the bulk action — and `upsertSession` registers the agent id
 * in the workspace-agents index. Mirrors `agent-read-service` /
 * `agent-creation-service`.
 */
function persistSession(session: AgentSession): void {
  appStore.dispatch(bulkUpsertSessions([session]));
  appStore.dispatch(upsertSession(session));
}

/**
 * STAB-55: `agent.get` returns AgentLite (PROTOCOL §5.5) — metadata and message
 * COUNTS only, with `messages` normalized to `[]`. Persisting such a projection
 * as-is clobbers a transcript that `chat-read-service` already hydrated, so any
 * existing messages are preserved when the fetched projection carries none
 * (same merge `agent-read-service.ensureAgentSession` uses).
 */
function preserveExistingMessages(fetched: AgentSession): AgentSession {
  if (fetched.messages && fetched.messages.length > 0) return fetched;
  const existing = readSession(String(fetched.id));
  return existing && existing.messages.length > 0
    ? { ...fetched, messages: existing.messages }
    : fetched;
}

function hasUsableAgentSession(session: AgentSession | undefined | null): session is AgentSession {
  return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(errorMessage(error, fallback));
}

async function handleRestore(
  action: ReturnType<typeof restoreAgentSessionRequested>,
): Promise<void> {
  const [wsId, agentId] = action.payload;
  try {
    const existing = readSession(agentId);
    if (hasUsableAgentSession(existing)) {
      appStore.dispatch(action.success(existing));
      return;
    }
    const fetched = await appClient.agents.get(agentId);
    if (fetched) {
      const wsScoped: AgentSession = {
        ...preserveExistingMessages(fetched),
        workspaceId: wsId as AgentSession['workspaceId'],
      };
      persistSession(wsScoped);
      appStore.dispatch(action.success(wsScoped));
      return;
    }
    appStore.dispatch(action.success(existing ?? null));
  } catch (error) {
    logger.error('Failed to restore agent session', error);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_restoreFailed_error())));
  }
}

async function handleActivate(action: ReturnType<typeof activateAgentRequested>): Promise<void> {
  const [wsId, agentId] = action.payload;
  const existing = readSession(agentId);
  try {
    if (existing?.backendSessionId && existing.status === AgentStatus.Active) {
      appStore.dispatch(action.success(existing));
      return;
    }
    const activationAttempts = (existing?.activationAttempts || 0) + 1;
    if (existing) {
      persistSession({
        ...existing,
        workspaceId: wsId as AgentSession['workspaceId'],
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts,
      });
    }
    const fetched = await appClient.agents.get(agentId);
    const source = fetched ? preserveExistingMessages(fetched) : (existing ?? null);
    if (!source) {
      appStore.dispatch(action.success(null));
      return;
    }
    const activated: AgentSession = {
      ...source,
      workspaceId: wsId as AgentSession['workspaceId'],
      status: source.backendSessionId ? AgentStatus.Active : source.status,
      activationState: AgentActivationState.ACTIVE,
      activationAttempts,
    };
    persistSession(activated);
    appStore.dispatch(action.success(activated));
  } catch (error) {
    logger.error('Failed to activate agent', error);
    const message = errorMessage(error, m.agent_mutation_activateFailed_error());
    if (existing) {
      persistSession({
        ...existing,
        workspaceId: wsId as AgentSession['workspaceId'],
        activationState: AgentActivationState.ERROR,
        lastActivationError: message,
      });
    }
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_activateFailed_error())));
  }
}

function handleSave(action: ReturnType<typeof saveAgentSessionRequested>): void {
  // The mock seam has no separate persistence layer — the agent-session slice
  // IS the runtime state. Resolve immediately so callers awaiting
  // `saveAction.promise` (agent-send pre-send) can proceed.
  appStore.dispatch(action.success(undefined as never));
}

/**
 * `renameAgentSessionRequested`: forward the (already optimistically applied)
 * rename to the daemon via `agent.rename` (PROTOCOL §5.5). The dispatch sites
 * update Redux BEFORE dispatching and revert on rejection, so this handler
 * only settles the promise: success when the daemon acked, failure when it
 * did not — so AgentCard's revert-on-failure path fires.
 */
async function handleRename(action: ReturnType<typeof renameAgentSessionRequested>): Promise<void> {
  const [wsId, agentId, name] = action.payload;
  try {
    const result = await appClient.agents.rename(agentId, name, wsId);
    if (!result.success) {
      appStore.dispatch(
        action.failure(new Error(result.error || m.agent_mutation_renameFailed_error())),
      );
      return;
    }
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to rename agent session', error);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_renameSessionFailed_error())));
  }
}

/**
 * `stopAgentSessionRequested`: cancel the agent's in-flight stream via
 * `agent.stop` (PROTOCOL §5.5). Another orphaned `*Requested` trigger — its
 * saga consumer was removed with the saga runtime, so the dispatch sites
 * (AgentCard stop menu, SpecWritingOnboarding, the subscriptions-footer
 * stop buttons) awaited a promise that never settled. The daemon cancels the
 * current turn and emits the terminal `agent:stream:end` (§7), which is the
 * real convergence signal; a non-success ack folds into `action.failure` so
 * callers can surface the error.
 */
async function handleStopSession(
  action: ReturnType<typeof stopAgentSessionRequested>,
): Promise<void> {
  const [, agentId] = action.payload;
  try {
    const result = await appClient.agents.stop(agentId);
    if (!result.success) {
      appStore.dispatch(
        action.failure(new Error(result.error || m.agent_mutation_stopFailed_error())),
      );
      return;
    }
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to stop agent session', error);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_stopFailed_error())));
  }
}

/**
 * `cancelAgentSubscriptionsRequested`: forward `agent.cancelSubscriptions`
 * (PROTOCOL §5.5) with the optional `subscriptionId` / `groupId` scoping. No
 * local state is touched here — the daemon publishes
 * `agent:subscriptions-changed` (§6.5), which the events bridge folds into a
 * `agent.getSubscriptions` refetch, so the footer converges from the BE
 * snapshot rather than a hand-rolled list mutation.
 */
async function handleCancelSubscriptions(
  action: ReturnType<typeof cancelAgentSubscriptionsRequested>,
): Promise<void> {
  const [wsId, agentId, scope] = action.payload;
  try {
    const result = await appClient.agents.cancelSubscriptions({
      agentId,
      workspaceId: wsId,
      ...(scope?.subscriptionId !== undefined ? { subscriptionId: scope.subscriptionId } : {}),
      ...(scope?.groupId !== undefined ? { groupId: scope.groupId } : {}),
    });
    if (!result.success) {
      const message = result.error || m.agent_mutation_cancelSubscriptionsFailed_error();
      void getToast().then((toast) => toast.error(message));
      appStore.dispatch(action.failure(new Error(message)));
      return;
    }
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to cancel agent subscriptions', error);
    void getToast().then((toast) =>
      toast.error(errorMessage(error, m.agent_mutation_cancelSubscriptionsFailed_error())),
    );
    appStore.dispatch(
      action.failure(toError(error, m.agent_mutation_cancelSubscriptionsFailed_error())),
    );
  }
}

/**
 * `agentSessionDismissQuestionsRequested`: optimistically stamp the
 * question-dismissal marker (`dismissedQuestionsMessageId`, PROTOCOL §5.5)
 * into session metadata — the wizard gate reads it, so the wizard hides
 * immediately — then forward `agent.dismissQuestions` to the daemon. On
 * failure only the marker key is reverted (the wizard re-surfaces) and the
 * error is surfaced via toast: the rollback re-reads the CURRENT metadata
 * rather than restoring the dispatch-time snapshot wholesale, so metadata
 * updates that landed while the RPC was in flight (e.g. an `agent:updated`
 * refetch) are not clobbered. On success the daemon persists the marker
 * (survives reload) and emits `agent:updated`, which reconciles other windows.
 */
async function handleDismissQuestions(
  action: ReturnType<typeof agentSessionDismissQuestionsRequested>,
): Promise<void> {
  const [agentId, wsId, messageId] = action.payload;
  const snapshot = readSession(agentId);
  const previousDismissedId = snapshot?.metadata?.dismissedQuestionsMessageId;
  if (snapshot) {
    appStore.dispatch(
      updateSession(agentId, {
        metadata: { ...snapshot.metadata, dismissedQuestionsMessageId: messageId },
      }),
    );
  }
  const rollback = () => {
    if (!snapshot) return;
    const current = readSession(agentId);
    // Session deleted mid-flight, or a concurrent write already replaced the
    // marker with a different value — nothing of ours left to revert.
    if (!current || current.metadata?.dismissedQuestionsMessageId !== messageId) return;
    const metadata = { ...current.metadata };
    if (previousDismissedId === undefined) {
      delete metadata.dismissedQuestionsMessageId;
    } else {
      metadata.dismissedQuestionsMessageId = previousDismissedId;
    }
    appStore.dispatch(updateSession(agentId, { metadata }));
  };
  try {
    const result = await appClient.agents.dismissQuestions({
      agentId,
      workspaceId: wsId,
      messageId,
    });
    if (!result.success) {
      rollback();
      const message = result.error || m.agent_mutation_dismissQuestionsFailed_error();
      void getToast().then((toast) => toast.error(message));
      appStore.dispatch(action.failure(new Error(message)));
      return;
    }
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to dismiss agent questions', error);
    rollback();
    void getToast().then((toast) =>
      toast.error(errorMessage(error, m.agent_mutation_dismissQuestionsFailed_error())),
    );
    appStore.dispatch(
      action.failure(toError(error, m.agent_mutation_dismissQuestionsFailed_error())),
    );
  }
}

// ---------------------------------------------------------------------------
// Agent deletion — soft-hide-then-commit (see this file's header + AGENTS.md).
// ---------------------------------------------------------------------------

/** Remove an agent from BOTH the workspace index and the session store. */
function softHideSession(wsId: string, agentId: string): void {
  appStore.dispatch(removeAgent(wsId, agentId));
  appStore.dispatch(removeSession(agentId));
  // Prune any recently-closed tab entries for this agent so the empty-state
  // recent list and "Reopen Closed Tab" cannot resurrect the deleted agent.
  appStore.dispatch(pruneRecentlyClosed(wsId, { agentId }));
}

/** Re-add a soft-hidden session to both stores (mirror of softHideSession). */
function restoreHiddenSession(session: AgentSession): void {
  persistSession(session);
}

/** Surface a deletion error to the user (best-effort; never throws). */
async function showDeletionError(message: string): Promise<void> {
  try {
    const toast = await getToast();
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface agent-deletion error', error);
  }
}

/**
 * Commit a pending soft-hidden deletion to the daemon. On success the daemon
 * emits `agent:deleted`, which reconciles the list; on failure the session is
 * un-hidden and the error surfaced. Idempotent: a no-op if nothing is pending.
 */
async function commitAgentDeletion(agentId: string): Promise<void> {
  const pending = getPendingAgentDeletion(agentId);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  // Removing the registry entry BEFORE awaiting the wire call keeps
  // commit/undo idempotent, at the cost of a brief unguarded window where the
  // daemon still lists the agent. Accepted intentionally: on success the
  // daemon emits `agent:deleted` and the reactive refetch reconciles any
  // rehydration that raced in; on failure the session is restored anyway.
  removePendingAgentDeletion(agentId);
  try {
    const result = await appClient.agents.delete(pending.agentId, pending.wsId);
    if (!result.success) {
      restoreHiddenSession(pending.snapshot);
      await showDeletionError(result.error || m.agent_mutation_deleteFailed_error());
      return;
    }
    // Persistently prune any recently-closed tab entries for this agent on
    // successful commit; the soft-hide prune covers the UI immediately, this
    // covers any later closes that landed in the undo window.
    appStore.dispatch(pruneRecentlyClosed(pending.wsId, { agentId: pending.agentId }));
  } catch (error) {
    logger.error('Failed to commit agent deletion', error);
    restoreHiddenSession(pending.snapshot);
    await showDeletionError(errorMessage(error, m.agent_mutation_deleteFailed_error()));
  }
}

/** Show the undo affordance; its action re-dispatches the undo trigger. */
async function showUndoToast(wsId: string, agentId: string, agentName?: string): Promise<void> {
  try {
    const toast = await getToast();
    toast.warning(
      agentName
        ? m.agent_mutation_deletedAgent_message({ name: agentName })
        : m.agent_mutation_deletedAgentGeneric_message(),
      {
        duration: UNDO_DURATION_MS,
        action: {
          label: m.agent_mutation_undo_label(),
          onClick: () => appStore.dispatch(undoAgentDeletionRequested(wsId, agentId)),
        },
      },
    );
  } catch (error) {
    logger.error('Failed to show agent-deletion undo toast', error);
  }
}

/**
 * `deleteAgentWithUndoRequested`: optimistically soft-hide the session WITHOUT
 * a daemon call, show the undo affordance, and arm a commit timer. Resolves the
 * promise immediately with the removed session so awaiting dispatch sites
 * proceed. A true daemon undo is impossible post-delete, so the real
 * `agent.delete` is deferred until the undo window elapses (or is committed).
 */
function handleDeleteWithUndo(action: ReturnType<typeof deleteAgentWithUndoRequested>): void {
  const [wsId, agentId, agentName] = action.payload;
  try {
    const snapshot = readSession(agentId);
    if (!snapshot) {
      appStore.dispatch(action.success(null));
      return;
    }
    const existing = getPendingAgentDeletion(agentId);
    if (existing?.timer) clearTimeout(existing.timer);
    softHideSession(wsId, agentId);
    const timer = setTimeout(() => void commitAgentDeletion(agentId), UNDO_DURATION_MS);
    setPendingAgentDeletion({ wsId, agentId, snapshot, timer });
    void showUndoToast(wsId, agentId, agentName);
    appStore.dispatch(action.success(snapshot));
  } catch (error) {
    logger.error('Failed to soft-hide agent for deletion', error);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_deleteFailed_error())));
  }
}

/**
 * `deleteAgentSessionRequested`: the no-undo path — soft-hide and commit the
 * daemon delete immediately. On failure the session is restored.
 */
async function handleDeleteSession(
  action: ReturnType<typeof deleteAgentSessionRequested>,
): Promise<void> {
  const [wsId, agentId] = action.payload;
  const snapshot = readSession(agentId);
  try {
    softHideSession(wsId, agentId);
    const result = await appClient.agents.delete(agentId, wsId);
    if (!result.success) {
      if (snapshot) restoreHiddenSession(snapshot);
      await showDeletionError(result.error || m.agent_mutation_deleteFailed_error());
      appStore.dispatch(
        action.failure(new Error(result.error || m.agent_mutation_deleteFailed_error())),
      );
      return;
    }
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to delete agent session', error);
    if (snapshot) restoreHiddenSession(snapshot);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_deleteSessionFailed_error())));
  }
}

/**
 * `undoAgentDeletionRequested`: cancel the pending commit and un-hide the
 * session — no daemon call, since the delete was never sent. Resolves `true`
 * when an undo actually happened, `false` when nothing was pending.
 */
function handleUndoDeletion(action: ReturnType<typeof undoAgentDeletionRequested>): void {
  const [, agentId] = action.payload;
  try {
    const pending = getPendingAgentDeletion(agentId);
    if (!pending) {
      appStore.dispatch(action.success(false));
      return;
    }
    if (pending.timer) clearTimeout(pending.timer);
    removePendingAgentDeletion(agentId);
    restoreHiddenSession(pending.snapshot);
    appStore.dispatch(action.success(true));
  } catch (error) {
    logger.error('Failed to undo agent deletion', error);
    appStore.dispatch(action.failure(toError(error, m.agent_mutation_undoDeleteFailed_error())));
  }
}

/**
 * `flushPendingAgentDeletionsRequested`: commit every pending deletion for the
 * workspace now (e.g. on workspace unmount), then resolve.
 */
async function handleFlushPendingDeletions(
  action: ReturnType<typeof flushPendingAgentDeletionsRequested>,
): Promise<void> {
  const [wsId] = action.payload;
  try {
    const pending = listPendingAgentDeletions().filter((entry) => entry.wsId === wsId);
    await Promise.all(pending.map((entry) => commitAgentDeletion(entry.agentId)));
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error('Failed to flush pending agent deletions', error);
    appStore.dispatch(
      action.failure(toError(error, m.agent_mutation_flushDeletionsFailed_error())),
    );
  }
}

/**
 * Middleware that gives the agent-session mutation triggers real handlers:
 * after each action passes through the (no-op) reducer, it routes the trigger
 * to the matching handler. Errors inside handlers are caught and surfaced via
 * `action.failure` so the dispatch chain itself never throws.
 */
export function createAgentMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== 'object') return result;
    const type = (action as { type?: unknown }).type;
    switch (type) {
      case restoreAgentSessionRequested.type:
        void handleRestore(action as ReturnType<typeof restoreAgentSessionRequested>);
        break;
      case activateAgentRequested.type:
        void handleActivate(action as ReturnType<typeof activateAgentRequested>);
        break;
      case saveAgentSessionRequested.type:
        handleSave(action as ReturnType<typeof saveAgentSessionRequested>);
        break;
      case renameAgentSessionRequested.type:
        void handleRename(action as ReturnType<typeof renameAgentSessionRequested>);
        break;
      case stopAgentSessionRequested.type:
        void handleStopSession(action as ReturnType<typeof stopAgentSessionRequested>);
        break;
      case cancelAgentSubscriptionsRequested.type:
        void handleCancelSubscriptions(
          action as ReturnType<typeof cancelAgentSubscriptionsRequested>,
        );
        break;
      case agentSessionDismissQuestionsRequested.type:
        void handleDismissQuestions(
          action as ReturnType<typeof agentSessionDismissQuestionsRequested>,
        );
        break;
      case deleteAgentWithUndoRequested.type:
        handleDeleteWithUndo(action as ReturnType<typeof deleteAgentWithUndoRequested>);
        break;
      case deleteAgentSessionRequested.type:
        void handleDeleteSession(action as ReturnType<typeof deleteAgentSessionRequested>);
        break;
      case undoAgentDeletionRequested.type:
        handleUndoDeletion(action as ReturnType<typeof undoAgentDeletionRequested>);
        break;
      case commitPendingAgentDeletionRequested.type: {
        const [, agentId] = (action as ReturnType<typeof commitPendingAgentDeletionRequested>)
          .payload;
        void commitAgentDeletion(agentId);
        break;
      }
      case flushPendingAgentDeletionsRequested.type:
        void handleFlushPendingDeletions(
          action as ReturnType<typeof flushPendingAgentDeletionsRequested>,
        );
        break;
    }
    return result;
  };
}
