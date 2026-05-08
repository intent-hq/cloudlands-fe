import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';

import {
  isSessionActivelyResponding,
  shouldShowEndOfListStreamingStatus,
  shouldShowPendingAssistantStatus,
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

  it('treats responding and legacy Processing sessions as active', () => {
    expect(isSessionActivelyResponding({ ...baseSession, isResponding: true })).toBe(true);
    expect(isSessionActivelyResponding({ ...baseSession, status: AgentStatus.Processing })).toBe(true);
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
