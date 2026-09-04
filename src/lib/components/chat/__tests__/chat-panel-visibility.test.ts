import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import {
  chatStateReducer,
  initialState as chatStateInitialState,
  chatLiveStreamPhaseChanged,
  chatTranscriptSnapshotApplied,
  chatUtilityFooterReady,
  transcriptHydrationFailed,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { markAgentAsViewed } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import {
  selectAwaitingSwitchBackSnapshot,
  selectAwaitingUtilityFooter,
  selectTranscriptHydratedOnce,
  selectTranscriptHydration,
} from '$store/renderer/slices/chat-state/chat-state-selectors';

import {
  deriveQueuedMessagesVisibility,
  isSessionActivelyResponding,
  isUtilityFooterReady,
  shouldDeferTranscriptReveal,
  shouldShowEndOfListStreamingStatus,
  shouldShowPendingAssistantStatus,
  shouldShowSetupCardOnly,
  shouldShowTranscriptSkeleton,
  shouldShowTranscriptUtilityStack,
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
    // The skeleton branch renders skeleton rows only (no setup card), so the
    // indeterminate load shows no premature "ready to go" affordance.
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

describe('shouldShowTranscriptUtilityStack', () => {
  it('stays hidden while the first hydration is in flight', () => {
    expect(
      shouldShowTranscriptUtilityStack({
        transcriptHydratedOnce: false,
        hydrationSettled: false,
        revealDeferred: false,
      }),
    ).toBe(false);
  });

  it('becomes visible once hydration settles', () => {
    expect(
      shouldShowTranscriptUtilityStack({
        transcriptHydratedOnce: true,
        hydrationSettled: true,
        revealDeferred: false,
      }),
    ).toBe(true);
  });

  it('stays visible through a refresh re-hydration (latch already true, status back to loading)', () => {
    expect(
      shouldShowTranscriptUtilityStack({
        transcriptHydratedOnce: true,
        hydrationSettled: false,
        revealDeferred: false,
      }),
    ).toBe(true);
  });

  it('stays hidden while the transcript reveal is deferred — the card mounts in the SAME flip', () => {
    expect(
      shouldShowTranscriptUtilityStack({
        transcriptHydratedOnce: true,
        hydrationSettled: true,
        revealDeferred: true,
      }),
    ).toBe(false);
  });

  // These two scenarios derive the gate's inputs from REAL reducer
  // transitions (mapped exactly as ChatPanel maps its selectors), so they
  // catch a regression in how those states project onto the gate — not just
  // in the pure function itself.
  const gateInputs = (state: ReturnType<typeof chatStateReducer>, agentId: string) => {
    const storeState = { chatState: state } as unknown as StoreState;
    return {
      transcriptHydratedOnce: selectTranscriptHydratedOnce.select(storeState, agentId),
      hydrationSettled: selectTranscriptHydration.select(storeState, agentId) === 'settled',
      revealDeferred: shouldDeferTranscriptReveal({
        awaitingSwitchBackSnapshot: selectAwaitingSwitchBackSnapshot.select(storeState, agentId),
        awaitingUtilityFooter: selectAwaitingUtilityFooter.select(storeState, agentId),
        transcriptHydratedOnce: selectTranscriptHydratedOnce.select(storeState, agentId),
        hasPendingInitialPrompt: false,
      }),
    };
  };

  it('reveals in the same flip as the transcript through the real first-open reducer path', () => {
    const agentId = 'agent-stack-first-open';
    // First settle arms the footer gate: transcript stays deferred and the
    // card stays hidden — the SAME flip reveals both once the gate clears.
    let state = chatStateReducer(chatStateInitialState, transcriptHydrationStarted(agentId));
    state = chatStateReducer(state, transcriptHydrationSettled(agentId));
    expect(shouldShowTranscriptUtilityStack(gateInputs(state, agentId))).toBe(false);

    state = chatStateReducer(state, chatUtilityFooterReady(agentId));
    expect(shouldShowTranscriptUtilityStack(gateInputs(state, agentId))).toBe(true);
  });

  it('re-hides on switch to a not-yet-hydrated agent (fresh per-agent state)', () => {
    // Agent/workspace switches remount the card via {#key}; the gate then
    // reads the NEW agent's per-agent hydration state, which starts unlatched
    // and unsettled — so the card is hidden again until that agent's first
    // hydration settles.
    expect(shouldShowTranscriptUtilityStack(gateInputs(chatStateInitialState, 'agent-fresh'))).toBe(
      false,
    );
  });

  it('stays hidden when the first hydration fails into the error/retry surface', () => {
    // hydration === 'error': neither latched nor settled — only a retry that
    // settles reveals the card.
    const loading = chatStateReducer(chatStateInitialState, transcriptHydrationStarted('agent-1'));
    const failed = chatStateReducer(loading, transcriptHydrationFailed('agent-1'));
    expect(shouldShowTranscriptUtilityStack(gateInputs(failed, 'agent-1'))).toBe(false);
  });
});

describe('shouldDeferTranscriptReveal', () => {
  const armedReView = {
    awaitingSwitchBackSnapshot: true,
    awaitingUtilityFooter: true,
    transcriptHydratedOnce: true,
    hasPendingInitialPrompt: false,
  };

  it('defers the reveal while the switch-back gate is armed on a re-view', () => {
    expect(shouldDeferTranscriptReveal(armedReView)).toBe(true);
  });

  it('defers while only the switch-back snapshot gate holds', () => {
    expect(shouldDeferTranscriptReveal({ ...armedReView, awaitingUtilityFooter: false })).toBe(
      true,
    );
  });

  it('defers while only the utility-footer gate holds', () => {
    expect(shouldDeferTranscriptReveal({ ...armedReView, awaitingSwitchBackSnapshot: false })).toBe(
      true,
    );
  });

  it('never defers when neither gate is armed', () => {
    expect(
      shouldDeferTranscriptReveal({
        ...armedReView,
        awaitingSwitchBackSnapshot: false,
        awaitingUtilityFooter: false,
      }),
    ).toBe(false);
  });

  it('never defers on the first-hydration path (skeleton logic owns it)', () => {
    expect(shouldDeferTranscriptReveal({ ...armedReView, transcriptHydratedOnce: false })).toBe(
      false,
    );
  });

  it('never defers while a pending initial prompt renders optimistically', () => {
    expect(shouldDeferTranscriptReveal({ ...armedReView, hasPendingInitialPrompt: true })).toBe(
      false,
    );
  });

  // Derive the gate's inputs from REAL reducer transitions (mapped exactly as
  // ChatPanel maps its selectors), so a regression in how those states
  // project onto the gate is caught — not just in the pure function itself.
  const gateInputs = (state: ReturnType<typeof chatStateReducer>, agentId: string) => {
    const storeState = { chatState: state } as unknown as StoreState;
    return {
      awaitingSwitchBackSnapshot: selectAwaitingSwitchBackSnapshot.select(storeState, agentId),
      awaitingUtilityFooter: selectAwaitingUtilityFooter.select(storeState, agentId),
      transcriptHydratedOnce: selectTranscriptHydratedOnce.select(storeState, agentId),
      hasPendingInitialPrompt: false,
    };
  };

  it('defers across the real switch-back reducer sequence and reveals in one flip', () => {
    const agentId = 'agent-reveal-1';
    // Hydrated once (footer gate armed then cleared), snapshot applied, then
    // the subscription closed on a switch away (phase null drops the
    // snapshot meta and both gates).
    let state = chatStateReducer(chatStateInitialState, transcriptHydrationStarted(agentId));
    state = chatStateReducer(state, transcriptHydrationSettled(agentId));
    state = chatStateReducer(state, chatUtilityFooterReady(agentId));
    state = chatStateReducer(
      state,
      chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 2 }),
    );
    state = chatStateReducer(state, chatLiveStreamPhaseChanged(agentId, null));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(false);

    // Switch back: BOTH gates arm synchronously with the view switch.
    state = chatStateReducer(state, markAgentAsViewed(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(true);

    // A fresh seq-0 snapshot alone is not enough — the footer must settle
    // too so transcript and footer flip in the same paint.
    state = chatStateReducer(
      state,
      chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 3 }),
    );
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(true);
    state = chatStateReducer(state, chatUtilityFooterReady(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(false);
  });

  it('defers the first open after settle until the footer gate clears (same-paint reveal)', () => {
    const agentId = 'agent-reveal-first-open';
    let state = chatStateReducer(chatStateInitialState, transcriptHydrationStarted(agentId));
    state = chatStateReducer(state, transcriptHydrationSettled(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(true);

    state = chatStateReducer(state, chatUtilityFooterReady(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(false);

    // A refresh re-hydration settle never re-arms (latch already true).
    state = chatStateReducer(state, transcriptHydrationStarted(agentId));
    state = chatStateReducer(state, transcriptHydrationSettled(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(state, agentId))).toBe(false);
  });

  it('never defers the first hydration through the real reducer path', () => {
    const agentId = 'agent-reveal-first';
    const loading = chatStateReducer(chatStateInitialState, transcriptHydrationStarted(agentId));
    const viewed = chatStateReducer(loading, markAgentAsViewed(agentId));
    expect(shouldDeferTranscriptReveal(gateInputs(viewed, agentId))).toBe(false);
  });
});

describe('isUtilityFooterReady', () => {
  it('is true only when all three footer snapshots have settled', () => {
    expect(
      isUtilityFooterReady({
        subscriptionSnapshotFetched: true,
        backgroundHooksSnapshotDelivered: true,
        prMonitorsSnapshotDelivered: true,
      }),
    ).toBe(true);
  });

  it('is false while any footer snapshot is still pending', () => {
    const ready = {
      subscriptionSnapshotFetched: true,
      backgroundHooksSnapshotDelivered: true,
      prMonitorsSnapshotDelivered: true,
    };
    for (const key of Object.keys(ready) as (keyof typeof ready)[]) {
      expect(isUtilityFooterReady({ ...ready, [key]: false })).toBe(false);
    }
  });
});

describe('deriveQueuedMessagesVisibility', () => {
  it('hides the queue while the wizard is expanded, even when non-empty', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 3,
        hasPendingQuestions: true,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: false });
  });

  it('shows the queue while the wizard is Ignore-collapsed', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: true,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: true });
  });

  it('keeps current behavior with no pending questions', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: false,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: true });
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 2,
        hasPendingQuestions: false,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: true });
  });

  it('never shows an empty queue', () => {
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 0,
        hasPendingQuestions: true,
        questionWizardCollapsed: true,
      }),
    ).toEqual({ showQueue: false });
    expect(
      deriveQueuedMessagesVisibility({
        queueLength: 0,
        hasPendingQuestions: false,
        questionWizardCollapsed: false,
      }),
    ).toEqual({ showQueue: false });
  });
});
