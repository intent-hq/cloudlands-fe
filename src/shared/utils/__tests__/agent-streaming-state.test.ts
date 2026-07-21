import { describe, it, expect } from 'vitest';
import { normalizeStreamingState } from '../agent-streaming-state';
import { AgentStatus, type AgentMessage, type AgentSession } from '$shared/types';


function message(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'm1',
    role: 'assistant',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentMessage;
}

function session(overrides: Partial<AgentSession> = {}): Partial<AgentSession> {
  return {
    id: 'agent-1' as AgentSession['id'],
    status: AgentStatus.Active,
    isStreaming: true,
    isProcessing: true,
    isResponding: true,
    messages: [message()],
    ...overrides,
  };
}

describe('normalizeStreamingState', () => {
  it('strips phantom streaming/processing/responding flags and demotes Active to Idle', () => {
    const result = normalizeStreamingState(session());
    expect(result.isStreaming).toBe(false);
    expect(result.isProcessing).toBe(false);
    expect(result.isResponding).toBe(false);
    expect(result.status).toBe(AgentStatus.Idle);
  });

  it('clears both isProcessing AND isResponding and demotes Processing status to Idle', () => {
    const result = normalizeStreamingState(
      session({ status: AgentStatus.Processing, isStreaming: false }),
    );
    expect(result.isProcessing).toBe(false);
    expect(result.isResponding).toBe(false);
    expect(result.status).toBe(AgentStatus.Idle);
  });

  it('does NOT downgrade a session whose message is genuinely streaming', () => {
    const result = normalizeStreamingState(
      session({ messages: [message({ isStreaming: true })] }),
    );
    expect(result.isStreaming).toBe(true);
    expect(result.isProcessing).toBe(true);
    expect(result.isResponding).toBe(true);
    expect(result.status).toBe(AgentStatus.Active);
  });

  it('does NOT downgrade when a live handler is attached (hasHandler branch)', () => {
    const result = normalizeStreamingState(session({ messages: [message()] }), true);
    expect(result.isStreaming).toBe(true);
    expect(result.isProcessing).toBe(true);
    expect(result.isResponding).toBe(true);
    expect(result.status).toBe(AgentStatus.Active);
  });

  it('clears stale message-level isStreaming flags when clearStaleMessageFlags is set', () => {
    const result = normalizeStreamingState(
      session({ messages: [message({ isStreaming: true })] }),
      false,
      true,
    );
    expect(result.isStreaming).toBe(false);
    expect(result.isProcessing).toBe(false);
    expect(result.isResponding).toBe(false);
    expect(result.status).toBe(AgentStatus.Idle);
    expect(result.messages?.[0].isStreaming).toBe(false);
  });

  it('does not clear message flags when clearStaleMessageFlags is set but a handler exists', () => {
    const result = normalizeStreamingState(
      session({ messages: [message({ isStreaming: true })] }),
      true,
      true,
    );
    expect(result.isStreaming).toBe(true);
    expect(result.status).toBe(AgentStatus.Active);
    expect(result.messages?.[0].isStreaming).toBe(true);
  });

  it('leaves non-streaming/idle sessions untouched', () => {
    const result = normalizeStreamingState(
      session({
        status: AgentStatus.Idle,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      }),
    );
    expect(result.isStreaming).toBe(false);
    expect(result.status).toBe(AgentStatus.Idle);
  });

});

