import {
  deriveWizardPendingQuestions,
  deriveMarkedQuestionRecoveryState,
  deriveAgentHasPendingQuestion,
} from '$lib/components/chat/questions/wizard-gate';
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
import type { DockConversationMessage, DockNativeSpeechState } from './dock-conversation-types';
import type { DockSpeechCapability } from '$shared/dock-speech';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  dockClipItemIds,
  recordingDockClip,
  dockCaptureDisabled,
  dockEvidenceId,
  dockEvidenceImageItemIds,
  hasDockEvidence,
  numberDockMarks,
  readyDockInsertions,
} from '$shared/dock-evidence';
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
  const questionMessages =
    contextCurrent && available && agentId ? selectAgentMessages.select(state, agentId) : [];
  const pendingQuestions =
    contextCurrent && available && agentId
      ? deriveWizardPendingQuestions(state, agentId, questionMessages)
      : null;
  const hasPendingQuestion =
    contextCurrent && available && agentId
      ? deriveAgentHasPendingQuestion(state, agentId, questionMessages)
      : false;
  const questionRecovery =
    contextCurrent && available && agentId
      ? deriveMarkedQuestionRecoveryState(state, agentId)
      : null;
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
        (selectPendingCount.select(state, agentId) > 0 || hasPendingQuestion)
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
    questionRecovery,
    questionContext:
      pendingQuestions &&
      workspaceId &&
      agentId &&
      dock.authority &&
      contextCurrent &&
      canParticipate &&
      available &&
      !loading &&
      !dock.error &&
      !uncertain &&
      !submitting &&
      !dock.sending &&
      selectPendingCount.select(state, agentId) === 0
        ? {
            workspaceId,
            agentId,
            authority: dock.authority,
            generation: dock.generation,
            pending: pendingQuestions,
          }
        : null,
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

type StoreState = typeof store.state;

/**
 * Observed server capabilities, only while the connection they were read from
 * is still the window's current backend connection; otherwise null.
 */
export function currentDockServerCapabilities(state: StoreState) {
  const observed = state.dockConversation.serverCapabilities;
  return observed &&
    observed.backendId === (state.connections.windowBackendId ?? null) &&
    observed.generation === state.daemonHealth.connectionGeneration
    ? observed
    : null;
}

/** The open draft pair under its authority (JSON), or '' when none; drives controller lifetime. */
export const selectDockConversationScope = store.createSelector((state) => {
  const { workspaceId, agentId, authority } = state.dockConversation;
  return workspaceId && agentId && authority
    ? JSON.stringify({ workspaceId, agentId, authority })
    : '';
});

/**
 * The scope one native evidence session belongs to: the open pair under an
 * authority that is still the live principal action context. Empty otherwise.
 */
export const selectDockNativeScope = store.createSelector((state) => {
  const { workspaceId, agentId, authority } = state.dockConversation;
  return workspaceId && agentId && authority && authority === getPrincipalActionContext(state)
    ? JSON.stringify({ workspaceId, agentId, authority })
    : '';
});

/** Settled outcome of one explicit speech stop request; null while it is pending. */
export const selectDockSpeechStopOutcome = store.createSelector(
  (state, requestId: string) =>
    getItem(state.dockConversation.nativeSpeech.stops, requestId) ?? null,
);

/** Changes whenever the window's backend or its connection lifecycle changes. */
export const selectDockBackendBinding = store.createSelector(
  (state) =>
    `${state.connections.windowBackendId ?? ''}:${state.daemonHealth.connectionGeneration}`,
);

/**
 * Screen evidence for one draft pair. Chip labels are localized by the caller via
 * `screenReferences(evidence, toolLabels)`; this selector carries no UI strings.
 */
export const selectDockComposerEvidence = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const dock = state.dockConversation;
    const contextCurrent = !!dock.authority && dock.authority === getPrincipalActionContext(state);
    const evidence = contextCurrent
      ? getItem(dock.evidence, dockEvidenceId(workspaceId, agentId))
      : undefined;
    const numbered = evidence ? numberDockMarks(evidence) : [];
    return {
      evidence: evidence ?? null,
      tiles: (evidence?.images ?? []).map((image) => ({
        image,
        marks: numbered.filter(({ mark }) => mark.imageId === image.id),
      })),
      clips: evidence?.clips ?? [],
      // The editor sees only the in-order prefix whose marks are accepted; queued counts all.
      insertions: evidence ? readyDockInsertions(evidence) : [],
      insertionsQueued: evidence?.insertions.length ?? 0,
      tool:
        dock.toolByWorkspace[workspaceId] ??
        dock.rememberedToolByWorkspace[workspaceId] ??
        ('pick' as const),
      toolUsed: workspaceId in dock.toolByWorkspace,
      annotating: !!evidence?.annotation && evidence.annotation.mode !== 'dictation',
      dictation: evidence?.dictation ?? null,
      recording: !!recordingDockClip(evidence),
      capturePending: evidence?.capture.pending ?? false,
      captureError: evidence?.capture.error ?? null,
      captureDisabled: dockCaptureDisabled(evidence),
      hasEvidence: hasDockEvidence(evidence),
      /** Raw screenshot context items; presentation shows them only as evidence tiles. */
      evidenceItemIds: [...dockEvidenceImageItemIds(evidence)],
      /**
       * Every composer context item owned by evidence (screenshots and clips).
       * Anything else is an ordinary attachment routed to SimpleRichInput.
       */
      evidenceOwnedItemIds: [...dockEvidenceImageItemIds(evidence), ...dockClipItemIds(evidence)],
      revision: evidence?.revision ?? 0,
      /** Advances only on an accepted capture: drives the one-shot capture flash. */
      captureAccepted: evidence?.capture.accepted ?? 0,
      /** Ordinary file attachments are storable in this workspace on the current connection. */
      fileAttachmentsEnabled:
        workspaceId !== CHIEF_WORKSPACE_ID ||
        !!currentDockServerCapabilities(state)?.chiefAttachments,
      /** Draft revision the editor mirrors; echoed by `dockEvidenceInsertionCommitted`. */
      draftRevision: contextCurrent
        ? (getItem(dock.drafts, JSON.stringify([workspaceId, agentId]))?.revision ?? 0)
        : 0,
      /** Latest actionable annotate failure (permission → settings; unavailable → hint). */
      annotationIssue: contextCurrent ? (evidence?.annotationIssue ?? null) : null,
      /** The pair's native dictation mirror (owned by the native-session saga). */
      speech: speechFor(dock.nativeSpeech, contextCurrent, dockEvidenceId(workspaceId, agentId)),
      /** Honest availability; every control is disabled until its native owner exists. */
      capabilities: contextCurrent
        ? {
            ...(dock.nativeCapabilities ?? { capture: false, annotate: false, record: false }),
            // Clips ride as file references: the assistant workspace records only where
            // the current connection advertised its attachment registry.
            ...(workspaceId === CHIEF_WORKSPACE_ID &&
            !currentDockServerCapabilities(state)?.chiefAttachments
              ? { record: false }
              : {}),
          }
        : { capture: false, annotate: false, record: false },
    };
  },
);

const NO_LEVELS: number[] = [];

function speechFor(
  native: DockNativeSpeechState,
  contextCurrent: boolean,
  pairId: string,
): {
  capability: DockSpeechCapability | null;
  available: boolean;
  active: boolean;
  pending: boolean;
  error: string | null;
  levels: number[];
} {
  const own = contextCurrent && native.pairId === pairId;
  return {
    capability: own ? native.capability : null,
    available: own && !!native.capability?.available,
    active: own && native.activeId !== null,
    pending: own && native.pending,
    error: own ? native.error : null,
    levels: own ? native.levels : NO_LEVELS,
  };
}

/** Evidence of the open pair (no arguments): safe to create once at component init. */
export const selectCurrentDockComposerEvidence = store.createSelector((state) => {
  const { workspaceId, agentId } = state.dockConversation;
  return workspaceId && agentId
    ? { workspaceId, agentId, view: selectDockComposerEvidence.select(state, workspaceId, agentId) }
    : null;
});
