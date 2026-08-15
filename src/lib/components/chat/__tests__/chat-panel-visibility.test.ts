import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';

import {
  deriveQueuedMessagesVisibility,
  isSessionActivelyResponding,
  shouldShowEndOfListStreamingStatus,
  shouldShowPendingAssistantStatus,
  shouldShowSetupCardOnly,
  shouldShowTranscriptSkeleton,
  shouldStopChatBeforeSending,
} from '../chat-panel-visibility';

const baseSession: AgentSession = {
  id: 'agent-1' as AgentSession['id'],
  backendSessionId: null,
  workspaceId: 'ws-1' as AgentSession['workspaceId'],
  name: 'Agent',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('chat panel visibility helpers', () => {
  it('does not treat idle Active sessions as responding', () => {
    expect(isSessionActivelyResponding(baseSession)).toBe(false);
  });

  it('keeps idle Active sessions out of ChatPanel processing affordances', () => {
    const isProcessing = isSessionActivelyResponding(baseSession);

    expect(
      shouldShowPendingAssistantStatus({
        isStreaming: false,
        isProcessing,
        error: null,
        modelUnavailable: null,
      }),
    ).toBe(false);
    expect(
      shouldShowEndOfListStreamingStatus({
        isStreaming: false,
        isProcessing,
        error: null,
        modelUnavailable: null,
        hasMessages: true,
        lastTurnHasAssistantMessages: true,
        lastAssistantMessageIsStreaming: false,
      }),
    ).toBe(false);
  });

  it('does not stop chat before queued sends for idle Active sessions', () => {
    expect(
      shouldStopChatBeforeSending({
        isStreaming: false,
        isProcessing: isSessionActivelyResponding(baseSession),
      }),
    ).toBe(false);
  });

  it('treats responding and legacy Processing sessions as active', () => {
    expect(isSessionActivelyResponding({ ...baseSession, isResponding: true })).toBe(true);
    expect(isSessionActivelyResponding({ ...baseSession, status: AgentStatus.Processing })).toBe(
      true,
    );
  });

  it('stops chat before queued sends while streaming or actively processing', () => {
    expect(shouldStopChatBeforeSending({ isStreaming: true, isProcessing: false })).toBe(true);
    expect(shouldStopChatBeforeSending({ isStreaming: false, isProcessing: true })).toBe(true);
  });

  it('trusts explicit idle status over stale responding flags', () => {
    expect(
      isSessionActivelyResponding({
        ...baseSession,
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: true,
      }),
    ).toBe(false);
  });

  it('shows pending assistant status for reconnect-restored streaming before chunks arrive', () => {
    expect(
      shouldShowPendingAssistantStatus({
        isStreaming: true,
        isProcessing: false,
        error: null,
        modelUnavailable: null,
      }),
    ).toBe(true);
  });

  it('hides pending assistant status when no active, error, or model-unavailable state exists', () => {
    expect(
      shouldShowPendingAssistantStatus({
        isStreaming: false,
        isProcessing: false,
        error: null,
        modelUnavailable: null,
      }),
    ).toBe(false);
  });

  it('keeps end-of-list status hidden when genuinely idle (IDLE-1)', () => {
    // A coordinator whose own turn has ended but is still waiting on delegated
    // children clears `isStreaming` / `isProcessing` in the agent-session slice
    // (PROTOCOL §5.5 isWaitingForOtherAgents is a separate BE-authoritative flag,
    // no longer consulted by the pending-status gates). The end-of-list status
    // must not render for that idle-wait — the "waiting on N agents" affordance
    // lives on separate sidebar/list surfaces.
    expect(
      shouldShowEndOfListStreamingStatus({
        isStreaming: false,
        isProcessing: false,
        error: null,
        modelUnavailable: null,
        hasMessages: true,
        lastTurnHasAssistantMessages: true,
        lastAssistantMessageIsStreaming: false,
      }),
    ).toBe(false);
  });

  it('preserves error and model-unavailable visibility while inactive', () => {
    expect(
      shouldShowPendingAssistantStatus({
        isStreaming: false,
        isProcessing: false,
        error: 'boom',
        modelUnavailable: null,
      }),
    ).toBe(true);

    expect(
      shouldShowPendingAssistantStatus({
        isStreaming: false,
        isProcessing: false,
        error: null,
        modelUnavailable: { failedModel: 'old', nextAvailableModel: 'new' },
      }),
    ).toBe(true);
  });

  it('shows an end-of-list status for the edit-resend truncated completed-turn state', () => {
    expect(
      shouldShowEndOfListStreamingStatus({
        isStreaming: false,
        isProcessing: true,
        error: null,
        modelUnavailable: null,
        hasMessages: true,
        lastTurnHasAssistantMessages: true,
        lastAssistantMessageIsStreaming: false,
      }),
    ).toBe(true);
  });

  it('avoids duplicating normal pending or assistant status rows', () => {
    const activeState = {
      isStreaming: true,
      isProcessing: true,
      error: null,
      modelUnavailable: null,
      hasMessages: true,
    };

    expect(
      shouldShowEndOfListStreamingStatus({
        ...activeState,
        lastTurnHasAssistantMessages: false,
        lastAssistantMessageIsStreaming: false,
      }),
    ).toBe(false);

    expect(
      shouldShowEndOfListStreamingStatus({
        ...activeState,
        lastTurnHasAssistantMessages: true,
        lastAssistantMessageIsStreaming: true,
      }),
    ).toBe(false);
  });

  it('keeps error and model-unavailable on their normal assistant status row', () => {
    const completedTurnState = {
      isStreaming: false,
      isProcessing: false,
      hasMessages: true,
      lastTurnHasAssistantMessages: true,
      lastAssistantMessageIsStreaming: false,
    };

    expect(
      shouldShowEndOfListStreamingStatus({
        ...completedTurnState,
        error: 'boom',
        modelUnavailable: null,
      }),
    ).toBe(false);

    expect(
      shouldShowEndOfListStreamingStatus({
        ...completedTurnState,
        error: null,
        modelUnavailable: { failedModel: 'old', nextAvailableModel: 'new' },
      }),
    ).toBe(false);
  });
});

describe('shouldShowTranscriptSkeleton', () => {
  const settledExistingSession = {
    isFirstHydrationLoading: false,
    hasSession: true,
    hydrationSettled: true,
    hasBackendSession: true,
    hasMessages: false,
    isStreaming: false,
    hasPendingInitialPrompt: false,
  };

  it('shows the skeleton during the FIRST hydration even while an assistant message is streaming mid-turn', () => {
    // DoD: never render a partial transcript as if complete — the standing
    // subscription's in-flight assistant message must not bypass the skeleton
    // while the initial hydration is still in flight.
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        isFirstHydrationLoading: true,
        hydrationSettled: false,
        hasMessages: true,
        isStreaming: true,
      }),
    ).toBe(true);
  });

  it('shows the skeleton during the first hydration with partial non-streaming messages', () => {
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        isFirstHydrationLoading: true,
        hydrationSettled: false,
        hasMessages: true,
      }),
    ).toBe(true);
  });

  it('keeps messages visible during refresh re-hydrations (latch already set)', () => {
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        hydrationSettled: false,
        hasMessages: true,
      }),
    ).toBe(false);
  });

  it('keeps the streaming exception for post-first-hydration empty transcripts', () => {
    // After the first hydration, an in-flight turn with no persisted messages
    // renders the streaming affordances, not the skeleton.
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        hydrationSettled: false,
        isStreaming: true,
      }),
    ).toBe(false);
  });

  it('shows the skeleton for an existing empty session before hydration settles', () => {
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        hydrationSettled: false,
      }),
    ).toBe(true);
  });

  it('does not keep a settled empty transcript behind an infinite skeleton', () => {
    expect(shouldShowTranscriptSkeleton(settledExistingSession)).toBe(false);
  });

  it('suppresses the skeleton when a pending initial prompt renders optimistically', () => {
    expect(
      shouldShowTranscriptSkeleton({
        ...settledExistingSession,
        isFirstHydrationLoading: true,
        hydrationSettled: false,
        hasBackendSession: false,
        hasPendingInitialPrompt: true,
      }),
    ).toBe(false);
  });
});

describe('shouldShowSetupCardOnly', () => {
  // Reopened workspace: initialPrompt is not persisted, so the reconstructed
  // onboarding prompt is always empty — only the hydration gate separates
  // "still loading" from "genuinely never used".
  const settledEmptyInitialAgent = {
    isInitialWorkspaceAgent: true,
    hasOnboardingContext: true,
    hasOnboardingPrompt: false,
    hasMessages: false,
    isStreaming: false,
    hasPendingInitialPrompt: false,
    hydrationSettled: true,
  };

  it('does NOT match while the first hydration is in flight — the skeleton branch must win', () => {
    // Regression (PR #1031): reopening an existing conversation showed the
    // "Workspace ready to go!" setup card instead of the loading skeleton for
    // the whole duration of the load.
    const loadingState = { ...settledEmptyInitialAgent, hydrationSettled: false };
    expect(shouldShowSetupCardOnly(loadingState)).toBe(false);
    // ...and the transcript-skeleton gate matches that same loading state.
    expect(
      shouldShowTranscriptSkeleton({
        isFirstHydrationLoading: true,
        hasSession: true,
        hydrationSettled: false,
        hasBackendSession: true,
        hasMessages: false,
        isStreaming: false,
        hasPendingInitialPrompt: false,
      }),
    ).toBe(true);
  });

  it('matches once hydration settles with an empty, idle transcript', () => {
    expect(shouldShowSetupCardOnly(settledEmptyInitialAgent)).toBe(true);
  });

  it('never matches for non-initial-workspace agents or without onboarding context', () => {
    expect(
      shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, isInitialWorkspaceAgent: false }),
    ).toBe(false);
    expect(
      shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, hasOnboardingContext: false }),
    ).toBe(false);
  });

  it('defers to the transcript once messages, streaming, or a pending/onboarding prompt exist', () => {
    expect(shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, hasMessages: true })).toBe(false);
    expect(shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, isStreaming: true })).toBe(false);
    expect(
      shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, hasPendingInitialPrompt: true }),
    ).toBe(false);
    expect(
      shouldShowSetupCardOnly({ ...settledEmptyInitialAgent, hasOnboardingPrompt: true }),
    ).toBe(false);
  });
});

describe('deriveQueuedMessagesVisibility', () => {
  it('hides the queue while the wizard is expanded, even when non-empty', () => {
    // heldForQuestions is normalized to false alongside showQueue so consumers
    // reading the flag alone never hint at a hidden queue.
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 3,
        hasPendingQuestions: true,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: false, heldForQuestions: false });
  });

  it('shows the queue as held while the wizard is Ignore-collapsed', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: true,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: true, heldForQuestions: true });
  });

  it('keeps current behavior with no pending questions', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: false,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: true, heldForQuestions: false });
  });

  it('clears the held hint when the hold releases (questions answered or dismissed)', () => {
    // The daemon drains the parked queue on release; until the shrunk
    // agent:queue:updated lands the queue may still be non-empty, but the
    // hint must already be gone because pendingQuestions derives false.
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: false,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: true, heldForQuestions: false });
  });

  it('never shows an empty queue', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 0,
        hasPendingQuestions: true,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: false, heldForQuestions: false });
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 0,
        hasPendingQuestions: false,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: false, heldForQuestions: false });
  });
});
