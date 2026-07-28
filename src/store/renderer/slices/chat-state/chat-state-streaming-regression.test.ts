/**
 * Streaming Regression Tests
 *
 * Tests isStreaming/isProcessing on the agent-session slice (single source of truth).
 * Chat-state actions dispatch cross-slice updates to agent-session.
 * 1. OR-latch: isStreaming/isProcessing must always be cleared together
 * 2. RAF interleaving: chunk flush after completion must not revive streaming flags
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  agentSessionReducer,
  initialState as sessionInitialState,
  bulkUpsertSessions,
} from '../agent-session/agent-session-slice';
import {
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  chatStopCompleted,
  streamCompleted,
  streamTimedOut,
  chatStreamingReconciled,
} from './chat-state-slice';
import type { AgentSession } from '$shared/types';

const AGENT = 'agent-regression';

const dummySession: AgentSession = {
  id: AGENT,
  name: 'Test Agent',
  workspaceId: 'ws-1',
  messages: [],
  isStreaming: false,
  isProcessing: false,
};

function getSession(state: ReturnType<typeof agentSessionReducer>, agentId: string) {
  return state.byAgentId[agentId];
}

/** Produce a mid-stream state: session exists, isStreaming + isProcessing true */
function midStreamState() {
  let s = agentSessionReducer(
    sessionInitialState,
    bulkUpsertSessions([{ ...dummySession }], { preserveExplicitRuntimeFlags: false }),
  );
  s = agentSessionReducer(s, chatSendStarted(AGENT));
  return s;
}

// ============================================================================
// 1. OR-latch: isStreaming and isProcessing must never diverge
// ============================================================================

describe('OR-latch regression: isStreaming/isProcessing parity (agent-session)', () => {
  it('streamCompleted clears both flags atomically', () => {
    const s = agentSessionReducer(
      midStreamState(),
      streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null }),
    );
    expect(getSession(s, AGENT).isStreaming).toBe(false);
    expect(getSession(s, AGENT).isProcessing).toBe(false);
  });

  it('chatSendFailed clears both flags atomically', () => {
    let s = agentSessionReducer(
      sessionInitialState,
      bulkUpsertSessions([{ ...dummySession }], { preserveExplicitRuntimeFlags: false }),
    );
    s = agentSessionReducer(s, chatSendStarted(AGENT));
    s = agentSessionReducer(s, chatSendFailed(AGENT, 'network'));
    expect(getSession(s, AGENT).isStreaming).toBe(false);
    expect(getSession(s, AGENT).isProcessing).toBe(false);
  });

  it('chatStopCompleted clears both flags atomically', () => {
    const s = agentSessionReducer(midStreamState(), chatStopCompleted(AGENT));
    expect(getSession(s, AGENT).isStreaming).toBe(false);
    expect(getSession(s, AGENT).isProcessing).toBe(false);
  });

  it('streamTimedOut clears both flags atomically', () => {
    const s = agentSessionReducer(midStreamState(), streamTimedOut(AGENT));
    expect(getSession(s, AGENT).isStreaming).toBe(false);
    expect(getSession(s, AGENT).isProcessing).toBe(false);
  });

  it('chatInterrupted clears both flags atomically', () => {
    const s = agentSessionReducer(midStreamState(), chatInterrupted(AGENT));
    expect(getSession(s, AGENT).isStreaming).toBe(false);
    expect(getSession(s, AGENT).isProcessing).toBe(false);
  });

  it('no terminal action leaves flags diverged', () => {
    const terminals = [
      streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null }),
      chatSendFailed(AGENT, 'fail'),
      chatStopCompleted(AGENT),
      streamTimedOut(AGENT),
      chatInterrupted(AGENT),
    ];
    for (const action of terminals) {
      const s = agentSessionReducer(midStreamState(), action);
      const sess = getSession(s, AGENT);
      expect(sess.isStreaming).toBe(sess.isProcessing);
    }
  });
});

// ============================================================================
// 2. RAF interleaving: chunk flush after complete must be safe
// ============================================================================

describe('RAF interleaving regression (agent-session)', () => {
  it('chatStreamingReconciled re-engages flags (by design)', () => {
    let s = midStreamState();
    s = agentSessionReducer(s, streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: null }));
    s = agentSessionReducer(s, chatStreamingReconciled(AGENT));
    expect(getSession(s, AGENT).isStreaming).toBe(true);
    expect(getSession(s, AGENT).isProcessing).toBe(true);
  });

  it('multiple agents streaming independently do not interfere', () => {
    const A = 'agent-A';
    const B = 'agent-B';
    let s = agentSessionReducer(
      sessionInitialState,
      bulkUpsertSessions([{ ...dummySession, id: A }], { preserveExplicitRuntimeFlags: false }),
    );
    s = agentSessionReducer(
      s,
      bulkUpsertSessions([{ ...dummySession, id: B }], { preserveExplicitRuntimeFlags: false }),
    );
    s = agentSessionReducer(s, chatSendStarted(A));
    s = agentSessionReducer(s, chatSendStarted(B));

    s = agentSessionReducer(s, streamCompleted(A, { lastAttemptedMessage: null, modelUnavailable: null }));
    expect(getSession(s, A).isStreaming).toBe(false);
    expect(getSession(s, A).isProcessing).toBe(false);
    expect(getSession(s, B).isStreaming).toBe(true);
    expect(getSession(s, B).isProcessing).toBe(true);
  });
});
