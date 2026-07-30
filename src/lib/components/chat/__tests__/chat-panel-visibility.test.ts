import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  AgentStatus,
  type AgentSession,
} from '$shared/types';

import {
  deriveQueuedMessagesVisibility,
  isSessionActivelyResponding,
  shouldShowEndOfListStreamingStatus,
  shouldShowPendingAssistantStatus,
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
    expect(isSessionActivelyResponding({ ...baseSession, status: AgentStatus.Processing })).toBe(true);
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
