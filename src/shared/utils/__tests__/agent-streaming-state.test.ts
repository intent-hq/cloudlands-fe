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

  it('finalizes stale per-message streaming flags when finalizeStaleMessages is true', () => {
    // Daemon-persisted mid-turn scenario: status Active with no live handler
    // and an assistant message still flagged isStreaming. The hydration path
    // opts into finalize-stale so the session can demote to Idle instead of
    // bailing out on the per-message check.
    const msg = message({ isStreaming: true });
    const result = normalizeStreamingState(session({ messages: [msg] }), false, true);
    expect(msg.isStreaming).toBe(false);
    expect((msg as { streamingComplete?: boolean }).streamingComplete).toBe(true);
    expect(result.isStreaming).toBe(false);
    expect(result.isProcessing).toBe(false);
    expect(result.isResponding).toBe(false);
    expect(result.status).toBe(AgentStatus.Idle);
  });

  it('also finalizes messages with streamingComplete:false (selector-side stale predicate)', () => {
    const msg = message({ streamingComplete: false } as Partial<AgentMessage>);
    const result = normalizeStreamingState(session({ messages: [msg] }), false, true);
    expect((msg as { streamingComplete?: boolean }).streamingComplete).toBe(true);
    expect(result.status).toBe(AgentStatus.Idle);
  });

  it('does NOT finalize per-message flags when a live handler is attached', () => {
    const msg = message({ isStreaming: true });
    const result = normalizeStreamingState(session({ messages: [msg] }), true, true);
    expect(msg.isStreaming).toBe(true);
    expect(result.status).toBe(AgentStatus.Active);
  });
});

