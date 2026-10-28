import { selectPresenceOwnPrincipalId } from '../presence/presence-selectors';
import { selectComposerContextItems } from '../transient-ui/transient-ui-selectors';
import { selectWorkspaceById } from '../workspace/workspace-selectors';
import { selectContextDefaultProvider } from '../provider-catalog/workspace-catalog-selectors';
import { getAgentProvider } from '$shared/types/agent-session';
import { resolveHydratedInputModel } from '$lib/components/chat/input-hydration';
import { canChangeAgentProvider } from '$lib/components/chat/provider-lock';
import {
  selectAgentSessionIsStreaming,
  selectAgentSessionStreamingContent,
} from '../agent-session/agent-session-selectors';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { selectWorkspaceParticipationContext } from '../workspace/workspace-selectors';
import { getPrincipalActionContext } from '../principal/principal-context';
import {
  selectAgentMessages,
  selectAgentHistoryMessages,
  selectAgentIsResponding,
} from '../agent-session/agent-session-selectors';
import {
  selectChatError,
  selectChatAgentState,
  selectChatLastAttemptedMessage,
  selectTranscriptHydratedOnce,
  selectTranscriptHydration,
} from '../chat-state/chat-state-selectors';
import { selectAgentSubmissionDisplay } from '../pending-submissions/pending-submissions-selectors';
import { selectPendingCount } from '../permission/permission-selectors';
import { m } from '$shared/paraglide/messages.js';
import type { DockConversationMessage } from './dock-conversation-types';
import type { QueuedMessage } from '$shared/types';
import type { PendingQueueDisplayRow } from '../pending-submissions/pending-submissions-projection';
import { selectAgentQueueMessages } from '../agent-queue/agent-queue-selectors';
import {
  isUserQueuedMessage,
  omitDrainedQueuedMessages,
} from '$lib/utils/queued-message-visibility';
import {
  pendingSubmissionMessage,
  processingSubmissionMessage,
} from '$lib/components/chat/pending-submission-message';

export const selectDockConversationWorkspaceId = store.createSelector(
  (state) => state.dockConversation.workspaceId,
);
export const selectDockConversationView = store.createSelector((state) => {
  const dock = state.dockConversation;
  const workspaceId = dock.workspaceId;
  const agentId = dock.agentId;
  const canParticipate =
    !!workspaceId && !!selectWorkspaceParticipationContext.select(state, workspaceId);
  const contextCurrent = !!dock.authority && dock.authority === getPrincipalActionContext(state);
  const draft =
    workspaceId && agentId
      ? getItem(dock.drafts, JSON.stringify([workspaceId, agentId]))
      : undefined;
  const session = agentId ? state.agentSessions.byAgentId[agentId] : undefined;
  const available =
    !!session &&
    session.workspaceId === workspaceId &&
    !session.retiredAt &&
    !session.pendingDeleteAt &&
    session.status !== 'deleted';
  const priorUncertain =
    !!draft?.delivery && !draft.delivery.settled && draft.delivery.authority !== dock.authority;
  let messages: DockConversationMessage[] = [];
  let pendingMessages: DockConversationMessage[] = [];
  let queuedMessages: QueuedMessage[] = [];
  let queueRows: PendingQueueDisplayRow[] = [];
  const pending =
    contextCurrent && available && agentId && workspaceId
      ? selectAgentSubmissionDisplay.select(state, agentId, workspaceId)
      : null;
  const submissions = pending
    ? [...pending.conversation, ...pending.queue.flatMap((row) => row.contributions)]
    : [];
  const uncertain = priorUncertain || submissions.some((row) => row.status === 'uncertain');
  const attention = uncertain
    ? m.dock_conversation_uncertain_description()
    : contextCurrent &&
        available &&
        agentId &&
        (selectPendingCount.select(state, agentId) > 0 ||
          session.metadata?.pendingQuestionsMessageId)
      ? m.dock_conversation_attention_description()
      : null;
  const submitting = submissions.some(
    (row) => row.status === 'sending' || row.status === 'preparing',
  );
  if (contextCurrent && available && agentId && workspaceId) {
    const tail = selectAgentMessages.select(state, agentId);
    const rows = [...selectAgentHistoryMessages.select(state, agentId), ...tail];
    // Both canonical segments are already ordered. Tail owns any repeated row's
    // current content; retain the original objects and their structured metadata.
    const confirmed = [...new Map(rows.map((row) => [row.id, row])).values()];
    pendingMessages = [
      ...(pending?.conversation ?? []).map(pendingSubmissionMessage),
      ...(pending?.processing ?? []).map(processingSubmissionMessage),
    ]
      .filter(
        (row) =>
          !confirmed.some(
            (message) =>
              message.id === row.id ||
              (row.appMessageId && message.appMessageId === row.appMessageId),
          ),
      )
      .slice(-60);
    messages = confirmed.slice(Math.max(0, confirmed.length - (60 - pendingMessages.length)));
    // Same display-only authored/drained policy as ChatPanel. Automatic queue
    // work is never rewritten into a user bubble or a synthetic transcript line.
    const humanQueue = selectAgentQueueMessages
      .select(state, agentId, workspaceId)
      .filter(isUserQueuedMessage);
    queuedMessages =
      state.principal.snapshot?.capabilities.submissionCorrelation === 1
        ? humanQueue
        : omitDrainedQueuedMessages(humanQueue, tail);
    queueRows = (pending?.queue ?? []).filter(
      (row) => !row.confirmedId || queuedMessages.some((message) => message.id === row.confirmedId),
    );
  }
  const loading =
    dock.loading ||
    (!!agentId &&
      contextCurrent &&
      !selectTranscriptHydratedOnce.select(state, agentId) &&
      selectTranscriptHydration.select(state, agentId) !== 'settled');
  return {
    workspaceId,
    workspaceTitle: dock.workspaceTitle,
    agentId,
    agents: contextCurrent ? getItems(dock.agents) : [],
    messages,
    pendingMessages,
    queuedMessages,
    queueRows,
    ownPrincipalId: contextCurrent ? selectPresenceOwnPrincipalId.select(state) : null,
    workspace:
      contextCurrent && workspaceId
        ? (selectWorkspaceById.select(state, workspaceId) ?? null)
        : null,
    loading,
    streamingStatus:
      contextCurrent && available && agentId
        ? {
            isStreaming: selectAgentSessionIsStreaming.select(state, agentId),
            lastChunkTime: selectChatAgentState.select(state, agentId).lastChunkTime,
            receivedFirstChunk: selectChatAgentState.select(state, agentId).receivedFirstChunk,
            streamingContentLength:
              selectAgentSessionStreamingContent.select(state, agentId)?.length ?? 0,
            streamingStartTime: selectChatAgentState.select(state, agentId).streamingStartTime,
            statusEvents: selectChatAgentState.select(state, agentId).statusEvents,
            processQueueHint: session?.processQueueHint,
          }
        : {},
    running:
      contextCurrent && available && !!agentId && selectAgentIsResponding.select(state, agentId),
    error: !contextCurrent
      ? m.dock_conversation_offline_description()
      : (dock.error ??
        (!agentId && !loading ? m.dock_conversation_chooseAgent_description() : null) ??
        (!available && !loading ? m.dock_conversation_unavailable_description() : null)),
    draft: contextCurrent ? (draft?.text ?? '') : '',
    sending: dock.sending || submitting,
    canRetry:
      contextCurrent &&
      available &&
      !uncertain &&
      !!agentId &&
      selectChatLastAttemptedMessage.select(state, agentId)?.submission?.outcome !== 'uncertain',
    sendError:
      dock.sendError ??
      (uncertain
        ? m.dock_conversation_uncertain_description()
        : contextCurrent && agentId
          ? selectChatError.select(state, agentId)
          : null),
    draftDisabled:
      !contextCurrent ||
      !canParticipate ||
      !available ||
      loading ||
      !draft?.restored ||
      !!attention ||
      !!dock.error,
    blocked:
      !canParticipate ||
      !!dock.error ||
      !contextCurrent ||
      !available ||
      loading ||
      !draft?.restored ||
      !!attention ||
      uncertain ||
      submitting ||
      dock.sending,
    attention,
  };
});

/** Exact selected pair supplies the same production prompt controls as ChatPanel. */
export const selectDockConversationComposer = store.createSelector((state) => {
  const view = selectDockConversationView.select(state);
  const { workspaceId, agentId } = view;
  const session = agentId ? state.agentSessions.byAgentId[agentId] : undefined;
  const draft =
    workspaceId && agentId
      ? getItem(state.dockConversation.drafts, JSON.stringify([workspaceId, agentId]))
      : undefined;
  const history = agentId ? selectAgentHistoryMessages.select(state, agentId) : [];
  const live = agentId ? selectAgentMessages.select(state, agentId) : [];
  return {
    workspace: workspaceId ? (selectWorkspaceById.select(state, workspaceId) ?? null) : null,
    agentId,
    value: view.draft,
    clearRevision: draft?.clearRevision ?? 0,
    clearSubmissionId: draft?.clearSubmissionId ?? null,
    recoverRevision: draft?.recoverRevision ?? 0,
    contextItems:
      workspaceId && agentId ? selectComposerContextItems.select(state, workspaceId, agentId) : [],
    disabled: view.draftDisabled,
    inputLocked: view.draftDisabled,
    isStreaming: !!agentId && selectAgentSessionIsStreaming.select(state, agentId),
    isResponding: view.running,
    selectedModel: resolveHydratedInputModel(session),
    providerId:
      session && workspaceId
        ? getAgentProvider(session, selectContextDefaultProvider.select(state, workspaceId))
        : undefined,
    requiresModelSwitchConfirmation: !canChangeAgentProvider({
      session: session ?? null,
      messages: [...history, ...live],
    }),
  };
});
