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

  return Boolean(session?.isResponding);
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
  return Boolean(state.isStreaming || state.isProcessing || state.error || state.modelUnavailable);
}

/**
 * During edit/resend, truncation can leave a completed prior turn at the end of
 * the list while active flags are already true. Render one detached status row
 * only when the normal pending-turn or assistant-message row cannot host it.
 */
export function shouldShowEndOfListStreamingStatus(state: EndOfListStreamingStatusState): boolean {
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

type TranscriptSkeletonState = {
  isFirstHydrationLoading: boolean;
  hasSession: boolean;
  hydrationSettled: boolean;
  hasMessages: boolean;
  isStreaming: boolean;
  hasPendingInitialPrompt: boolean;
};

/**
 * Transcript skeleton gate. The FIRST hydration (latch not yet set) always
 * shows the indeterminate skeleton — even when an in-flight assistant message
 * has already landed via the standing subscription — so a partially-loaded
 * transcript never renders as if complete; only the settling hydration
 * reveals the transcript. After the first hydration, the legacy
 * empty-transcript cases keep their streaming exception so an in-flight turn
 * is never hidden behind the skeleton. A pending initial prompt (brand-new
 * agent, optimistic echo) suppresses the skeleton entirely — there is no
 * earlier transcript to render partially.
 */
export function shouldShowTranscriptSkeleton(state: TranscriptSkeletonState): boolean {
  if (state.hasPendingInitialPrompt) {
    return false;
  }
  if (state.isFirstHydrationLoading) {
    return true;
  }
  return (!state.hasSession || !state.hydrationSettled) && !state.hasMessages && !state.isStreaming;
}

type TranscriptRevealDeferralState = {
  awaitingSwitchBackSnapshot: boolean;
  transcriptHydratedOnce: boolean;
  hasPendingInitialPrompt: boolean;
};

/**
 * Transcript reveal gate. A re-viewed conversation stays behind the skeleton
 * until its standing subscription delivers a fresh seq-0 snapshot. Utility
 * footer reads are deliberately independent and never participate here.
 * The FIRST hydration's in-flight window keeps the existing
 * `shouldShowTranscriptSkeleton` logic (`transcriptHydratedOnce` false never
 * defers here; it flips true when the first hydration settles), and a pending
 * initial prompt never defers — there is no earlier transcript to paint stale.
 */
export function shouldDeferTranscriptReveal(state: TranscriptRevealDeferralState): boolean {
  return (
    state.awaitingSwitchBackSnapshot &&
    state.transcriptHydratedOnce &&
    !state.hasPendingInitialPrompt
  );
}

/** Durable evidence that a session has been used before. */
export function hasAuthoritativeConversationEvidence(
  session: AgentSession | null,
  snapshotTotalMessages = 0,
): boolean {
  if (!session) return false;
  return Boolean(
    session.backendSessionId ||
    session.acpSessionId?.trim() ||
    session.messages.length > 0 ||
    (session.stats?.messageCount ?? 0) > 0 ||
    snapshotTotalMessages > 0 ||
    session.lastMessageId ||
    session.lastMessageRole ||
    session.lastUserMessage ||
    session.lastAgentResponse ||
    (session.currentTurnNumber ?? 0) > 0,
  );
}

type SetupCardOnlyState = {
  isInitialWorkspaceAgent: boolean;
  hasOnboardingContext: boolean;
  hasOnboardingPrompt: boolean;
  hasMessages: boolean;
  isStreaming: boolean;
  hasPendingInitialPrompt: boolean;
  hydrationSettled: boolean;
};

/**
 * "Setup card only, no skeletons" gate for the initial workspace agent with no
 * onboarding prompt. It must NOT match while the first hydration is in flight
 * (`hydrationSettled` false): `workspace.initialPrompt` is not persisted, so a
 * reopened workspace always reconstructs an empty prompt, and the transcript is
 * momentarily empty until hydration lands — without the settled guard this
 * branch would replace the loading skeleton with the setup card for the whole
 * load. During loading, `shouldShowTranscriptSkeleton` wins (the skeleton
 * branch renders skeleton rows only — no setup card).
 */
export function shouldShowSetupCardOnly(state: SetupCardOnlyState): boolean {
  return (
    state.isInitialWorkspaceAgent &&
    state.hasOnboardingContext &&
    !state.hasOnboardingPrompt &&
    !state.hasMessages &&
    !state.isStreaming &&
    !state.hasPendingInitialPrompt &&
    state.hydrationSettled
  );
}

type TranscriptUtilityStackState = {
  transcriptHydratedOnce: boolean;
  hydrationSettled: boolean;
  revealDeferred: boolean;
};

/**
 * Utility stack gate (EventSubscriptionsCard: agent subscriptions, background
 * hooks, monitored PRs). The card must never pop in ahead of (or during) the
 * transcript skeleton, so it stays hidden until the current agent's FIRST
 * transcript hydration has settled AND the transcript reveal deferral has
 * cleared. Its three sources then render their own loading/failure/empty state.
 * Refresh re-hydrations (latch already true) keep it visible; a first hydration
 * that fails into the error/retry surface keeps it hidden until a retry settles.
 */
export function shouldShowTranscriptUtilityStack(state: TranscriptUtilityStackState): boolean {
  return (state.transcriptHydratedOnce || state.hydrationSettled) && !state.revealDeferred;
}

type QueuedMessagesVisibilityState = {
  queueLength: number;
  hasPendingQuestions: boolean;
  questionWizardCollapsed: boolean;
};

/**
 * Queued-messages visibility around the Agent Q&A wizard. The wizard expanded
 * state hides the queue list entirely (the wizard owns the composer area); the
 * Ignore-collapsed state shows the queue as usual.
 */
export function deriveQueuedMessagesVisibility(state: QueuedMessagesVisibilityState): {
  showQueue: boolean;
} {
  const wizardExpanded = state.hasPendingQuestions && !state.questionWizardCollapsed;
  return { showQueue: state.queueLength > 0 && !wizardExpanded };
}
