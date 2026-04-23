/**
 * Agent Stream Saga Regression Test (Bug 10)
 *
 * Bug 10: Safety timeout doesn't clear isProcessing.
 *   When the safety timeout fires and clears stale isStreaming via
 *   setAgentStreaming(false), the isProcessing flag was NOT cleared.
 *   This caused agents to appear "busy" (spinner) when actually idle.
 *
 * The fix: the safety timeout now dispatches upsertSession with
 * both isStreaming: false AND isProcessing: false.
 *
 * This test verifies at the reducer level that the safety timeout's
 * dispatched actions correctly clear both flags.
 */

import { describe, expect, it } from 'vitest';
import {
  agentSessionReducer,
  initialState as sessionInitialState,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import {
  chatSendStarted,
  streamStarted,
} from '../../chat-state/chat-state-slice';
import {
  setAgentStreaming,
} from '../workspace-agents-slice';
import type { AgentSession } from '$shared/types';
import { getItems } from '../../../utils/collection-utils';

const AGENT = 'agent-safety-timeout';

/**
 * The agent-session slice now stores `messages` as a Collection. When a test
 * pulls a stored session out of state and spreads it back into an
 * `upsertSession` payload (which expects `AgentSession` with array messages),
 * we need to materialize the Collection back to an array first.
 */
function toDispatchable(stored: any): AgentSession {
  return { ...stored, messages: getItems(stored.messages) } as unknown as AgentSession;
}

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

/** Produce a mid-stream state: isStreaming=true, isProcessing=true */
function midStreamState() {
  let s = agentSessionReducer(sessionInitialState, upsertSession({ ...dummySession }));
  s = agentSessionReducer(s, chatSendStarted(AGENT));
  s = agentSessionReducer(s, streamStarted(AGENT, { hasRestoredContent: false, existingContent: '' }));
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
    state = agentSessionReducer(state, setAgentStreaming('ws-1', AGENT, false));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false); // cleared ✓
    expect(session.isProcessing).toBe(true); // BUG: still true!
  });

  it('safety timeout fix: upsertSession with isProcessing=false clears both flags', () => {
    let state = midStreamState();

    // Step 1: dispatch setAgentStreaming(false) — clears isStreaming
    state = agentSessionReducer(state, setAgentStreaming('ws-1', AGENT, false));

    // Step 2: dispatch upsertSession with both flags cleared (the fix)
    const updatedSession = {
      ...toDispatchable(getSession(state, AGENT)),
      isStreaming: false,
      isProcessing: false,
    };
    state = agentSessionReducer(state, upsertSession(updatedSession));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false); // cleared ✓
    expect(session.isProcessing).toBe(false); // FIXED: now also cleared ✓
  });

  it('without the fix, agent appears stuck busy after safety timeout', () => {
    let state = midStreamState();

    // OLD behavior: safety timeout only dispatches setAgentStreaming(false)
    // and upsertSession with isStreaming: false but NOT isProcessing: false
    state = agentSessionReducer(state, setAgentStreaming('ws-1', AGENT, false));

    const oldBehaviorSession = {
      ...toDispatchable(getSession(state, AGENT)),
      isStreaming: false,
      // BUG: isProcessing NOT explicitly set to false
    };
    state = agentSessionReducer(state, upsertSession(oldBehaviorSession));

    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false);
    // isProcessing remains true — user sees spinner on an idle agent
    expect(session.isProcessing).toBe(true);
  });

  it('safety timeout fix is safe when isProcessing is already false', () => {
    // Edge case: agent finished normally but safety timeout still fires.
    // Dispatching isProcessing: false should be a no-op, not throw or corrupt state.
    let state = agentSessionReducer(sessionInitialState, upsertSession({ ...dummySession }));

    // Agent completed normally: both flags are already false
    expect(getSession(state, AGENT).isStreaming).toBe(false);
    expect(getSession(state, AGENT).isProcessing).toBe(false);

    // Safety timeout fires anyway (race condition)
    state = agentSessionReducer(state, setAgentStreaming('ws-1', AGENT, false));
    const updatedSession = {
      ...toDispatchable(getSession(state, AGENT)),
      isStreaming: false,
      isProcessing: false,
    };
    state = agentSessionReducer(state, upsertSession(updatedSession));

    // Should remain false without errors
    const session = getSession(state, AGENT);
    expect(session.isStreaming).toBe(false);
    expect(session.isProcessing).toBe(false);
    // Messages should be preserved
    expect(session.messages).toBeDefined();
  });
});
