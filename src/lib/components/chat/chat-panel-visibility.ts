import { AgentStatus, type AgentSession } from '$shared/types';

type ChatResponseFlags = {
  isStreaming: boolean;
  isProcessing: boolean;
  error: string | null;
  modelUnavailable: unknown | null;
};

type PendingAssistantStatusState = ChatResponseFlags;

type EndOfListStreamingStatusState = PendingAssistantStatusState & {
  hasMessages: boolean;
  lastTurnHasAssistantMessages: boolean;
  lastAssistantMessageIsStreaming: boolean;
};

type StopChatBeforeSendState = Pick<ChatResponseFlags, 'isStreaming' | 'isProcessing'>;

/**
 * Agent sessions can be actively responding before text chunks produce an
 * assistant message. Treat those response-state aliases as processing for the
 * chat panel's Thinking affordance, without using plain Active as a signal
 * because idle persisted sessions also use Active.
 */
export function isSessionActivelyResponding(session: AgentSession | null): boolean {
  const status = session?.status as string | undefined;

  if (session?.isProcessing || status === AgentStatus.Processing || status === 'processing') {
    return true;
  }

  if ((status === AgentStatus.Idle || status === 'idle') && !session?.isStreaming) {
    return false;
  }

  return Boolean(
    session?.isResponding,
  );
}

/**
 * Show the status row at the end of a user turn while waiting for the first
 * assistant message. `isStreaming` is included for backend reconnects that
 * restore only the active stream flag before chunks arrive. The broader
 * `selectAgentIsRunning` signal is intentionally NOT consulted: a coordinator
 * idle-wait on delegated children (PROTOCOL §5.5 `isWaitingForOtherAgents`)
 * must not render as a pending assistant turn (IDLE-1). The waiting affordance
 * lives on separate sidebar/list surfaces.
 */
export function shouldShowPendingAssistantStatus(state: PendingAssistantStatusState): boolean {
  return Boolean(
    state.isStreaming ||
      state.isProcessing ||
      state.error ||
      state.modelUnavailable,
  );
}

/**
 * During edit/resend, truncation can leave a completed prior turn at the end of
 * the list while active flags are already true. Render one detached status row
 * only when the normal pending-turn or assistant-message row cannot host it.
 */
export function shouldShowEndOfListStreamingStatus(
  state: EndOfListStreamingStatusState,
): boolean {
  if (!state.hasMessages || !shouldShowPendingAssistantStatus(state)) {
    return false;
  }

  const normalPendingRowRenders = !state.lastTurnHasAssistantMessages;
  const normalAssistantRowRenders = Boolean(
    state.lastAssistantMessageIsStreaming || state.error || state.modelUnavailable,
  );

  return !normalPendingRowRenders && !normalAssistantRowRenders;
}

export function shouldStopChatBeforeSending(state: StopChatBeforeSendState): boolean {
  return Boolean(state.isStreaming || state.isProcessing);
}

type QueuedMessagesVisibilityState = {
  queueLength: number;
  hasPendingQuestions: boolean;
  questionWizardCollapsed: boolean;
};

/**
 * Queued-messages visibility around the Agent Q&A wizard. While questions are
 * pending, the daemon parks automatic deliveries in the queue (question hold,
 * PROTOCOL §5.5) — the queue is not stalled, it is deliberately held until the
 * user answers or dismisses. The wizard expanded state hides the queue list
 * entirely (the wizard owns the composer area); the Ignore-collapsed state
 * shows the queue with a held-for-questions hint so parked entries do not look
 * stuck. `heldForQuestions` derives from the same daemon-backed pending state
 * (transcript + `dismissedQuestionsMessageId` marker) the wizard gate uses —
 * never local inference — so the hint clears the moment the hold releases.
 * `heldForQuestions` is normalized to false whenever `showQueue` is false, so
 * consumers reading the flag alone never hint at a hidden queue. The hint
 * labels the whole queue: a parked user-origin entry (a send that lost a busy
 * race before the hold began) still drains despite the hold per PROTOCOL §5.5
 * — that mixed window is transient and self-corrects on the next queue
 * snapshot, so no per-entry distinction is made here.
 */
export function deriveQueuedMessagesVisibility(state: QueuedMessagesVisibilityState): {
  showQueue: boolean;
  heldForQuestions: boolean;
} {
  const wizardExpanded = state.hasPendingQuestions && !state.questionWizardCollapsed;
  const showQueue = state.queueLength > 0 && !wizardExpanded;
  return {
    showQueue,
    heldForQuestions: showQueue && state.hasPendingQuestions,
  };
}
