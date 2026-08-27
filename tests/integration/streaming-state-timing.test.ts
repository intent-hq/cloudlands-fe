import type { AgentSession } from '$shared/types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatSendFailed,
  chatSendStarted,
  streamCompleted,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { describe, expect, it } from 'vitest';

const AGENT_ID = 'agent-stream-timing';
const session: AgentSession = {
  id: AGENT_ID,
  name: 'Streaming agent',
  workspaceId: 'ws-stream-timing',
  messages: [],
  isStreaming: false,
  isProcessing: false,
};

function registeredState() {
  return agentSessionReducer(
    initialState,
    bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }),
  );
}

describe('Streaming state timing', () => {
  it('sets streaming state synchronously when send starts', () => {
    const stateBeforePanelRead = agentSessionReducer(registeredState(), chatSendStarted(AGENT_ID));

    expect(stateBeforePanelRead.byAgentId[AGENT_ID]).toMatchObject({
      isStreaming: true,
      isProcessing: true,
    });
  });

  it('applies start and completion events in dispatch order', () => {
    const started = agentSessionReducer(registeredState(), chatSendStarted(AGENT_ID));
    const completed = agentSessionReducer(
      started,
      streamCompleted(AGENT_ID, { lastAttemptedMessage: null, modelUnavailable: null }),
    );

    expect(started.byAgentId[AGENT_ID].isStreaming).toBe(true);
    expect(completed.byAgentId[AGENT_ID]).toMatchObject({
      isStreaming: false,
      isProcessing: false,
    });
  });

  it('clears both runtime flags when send fails', () => {
    const started = agentSessionReducer(registeredState(), chatSendStarted(AGENT_ID));
    const failed = agentSessionReducer(started, chatSendFailed(AGENT_ID, 'transport failed'));

    expect(failed.byAgentId[AGENT_ID]).toMatchObject({
      isStreaming: false,
      isProcessing: false,
    });
  });
});
