import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';
import { getNodeStatus, getStreamingState } from '../graph-helpers';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'agent-1' as any,
    backendSessionId: null,
    workspaceId: 'ws-1' as any,
    name: 'Agent',
    status: 'idle' as any,
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const staleStreamingAssistant = {
  id: 'msg-1',
  role: 'assistant' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
  streamingComplete: false,
  contentBlocks: [{ type: 'text' as const, text: 'Stale response' }],
};

describe('agent overview graph helpers', () => {
  it('trusts explicit idle status over stale assistant streaming metadata', () => {
    const session = makeSession({
      status: 'idle' as any,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('idle');
    expect(getStreamingState(session).streamingText).toBeUndefined();
  });

  it('keeps active response flags authoritative for running state', () => {
    const session = makeSession({
      status: AgentStatus.Idle,
      isProcessing: true,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('responding');
  });

  it('preserves active-message fallback for non-idle delegated sessions', () => {
    const session = makeSession({
      status: AgentStatus.Active,
      isStreaming: false,
      isProcessing: false,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('responding');
  });
});