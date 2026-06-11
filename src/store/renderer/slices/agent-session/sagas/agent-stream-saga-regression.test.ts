/**
 * Agent Stream Saga Regression Test (Bug 10)
 *
 * Bug 10: Safety timeout doesn't clear isProcessing.
 *   When the safety timeout fires and clears stale isStreaming via
 *   setAgentStreaming(false), the isProcessing flag was NOT cleared.
 *   This caused agents to appear "busy" (spinner) when actually idle.
 *
 * The fix: the safety timeout dispatches upsertSession with both
 * isStreaming: false AND isProcessing: false, and batched storage preserves
 * those explicit false values.
 *
 * This test verifies at the reducer level that the safety timeout's
 * dispatched actions correctly clear both flags.
 */

import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as sessionInitialState,
  setAgentStreaming,
} from '../agent-session-slice';
import { chatSendStarted } from '../../chat-state/chat-state-slice';
import type { AgentSession } from '$shared/types';

const AGENT = 'agent-safety-timeout';

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

function applyBatchedUpsert(session: AgentSession) {
  return bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false });
}

/** Produce a mid-stream state: isStreaming=true, isProcessing=true */
function midStreamState() {
  let s = agentSessionReducer(sessionInitialState, applyBatchedUpsert({ ...dummySession }));
  s = agentSessionReducer(s, chatSendStarted(AGENT));
  return s;
}

describe('Bug 10: Safety timeout must clear isProcessing', () => {
  it('mid-stream state has both isStreaming and isProcessing true', () => {
    const state = midStreamState();
    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(true);
    expect(session.isProcessing).toBe(true);
  });

  it('setAgentStreaming(false) alone does NOT clear isProcessing (the bug)', () => {
    let state = midStreamState();

    // This is what the OLD safety timeout did: only dispatch setAgentStreaming
    state = agentSessionReducer(state, setAgentStreaming(AGENT, false));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false); // cleared ✓
    expect(session.isProcessing).toBe(true); // BUG: still true!
  });

  it('safety timeout fix: batched upsert storage with isProcessing=false clears both flags', () => {
    let state = midStreamState();

    // Step 1: dispatch setAgentStreaming(false) — clears isStreaming
    state = agentSessionReducer(state, setAgentStreaming(AGENT, false));

    // Step 2: apply the batched upsert with both flags cleared (the fix)
    const updatedSession = {
      ...getSession(state, AGENT),
      isStreaming: false,
      isProcessing: false,
    };
    state = agentSessionReducer(state, applyBatchedUpsert(updatedSession));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false); // cleared ✓
    expect(session.isProcessing).toBe(false); // FIXED: now also cleared ✓
  });

  it('without the fix, agent appears stuck busy after safety timeout', () => {
    let state = midStreamState();

    // OLD behavior: safety timeout only dispatches setAgentStreaming(false)
    // and batched upsert storage with isStreaming: false but NOT isProcessing: false
    state = agentSessionReducer(state, setAgentStreaming(AGENT, false));

    const oldBehaviorSession = {
      ...getSession(state, AGENT),
      isStreaming: false,
      // BUG: isProcessing NOT explicitly set to false
    };
    state = agentSessionReducer(state, applyBatchedUpsert(oldBehaviorSession));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false);
    // isProcessing remains true — user sees spinner on an idle agent
    expect(session.isProcessing).toBe(true);
  });

  it('safety timeout fix is safe when isProcessing is already false', () => {
    // Edge case: agent finished normally but safety timeout still fires later.
    // Dispatching isProcessing: false should be a no-op, not throw or corrupt state.
    let state = agentSessionReducer(sessionInitialState, applyBatchedUpsert({ ...dummySession }));

    // Agent completed normally: both flags are already false
    expect(getSession(state, AGENT).isStreaming).toBe(false);
    expect(getSession(state, AGENT).isProcessing).toBe(false);

    // Safety timeout fires anyway after normal completion
    state = agentSessionReducer(state, setAgentStreaming(AGENT, false));
    const updatedSession = {
      ...getSession(state, AGENT),
      isStreaming: false,
      isProcessing: false,
    };
    state = agentSessionReducer(state, applyBatchedUpsert(updatedSession));

    // Should remain false without errors
    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false);
    expect(session.isProcessing).toBe(false);
    // Messages should be preserved
    expect(session.messages).toBeDefined();
  });
});
