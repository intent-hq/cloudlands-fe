import {
  describe,
  expect,
  it,
} from 'vitest';
import type { StoreState } from '../../types';
import {
  chatStateReducer,
  initialState,
  emptyChatAgentState,
  chatInitialized,
  chatInitFailed,
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  chatStopInitiated,
  chatStopCompleted,
  chatReset,
  chatStreamingReconciled,
  streamCompleted,
  streamTimedOut,
  chatStallDetected,
  chatStuckStateCleared,
  chatModelUnavailableCleared,
  chatRebindStarted,
  chatRebindEnded,
  chatTrackedWorkspaceSet,
  streamStatusReceived,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
} from './chat-state-slice';
import {
  selectChatAgentState,
  selectChatError,
  selectChatIsStalled,
  selectChatLastMessageTime,
  selectTranscriptHydration,
} from './chat-state-selectors';
import { agentStreamUpdateReceived } from '../workspace-agents/workspace-agents-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';

const AGENT = 'agent-1';

function asStoreState(chatState: ReturnType<typeof chatStateReducer>): StoreState {
  return { chatState } as unknown as StoreState;
}

function stateWithModelUnavailable() {
  return chatStateReducer(initialState, agentStreamUpdateReceived({
    agentId: AGENT,
    handlerSessionId: AGENT,
    source: 'sendMessage',
    eventType: 'complete',
    completeMessage: {
      role: 'assistant',
      metadata: {
        modelUnavailable: true,
        failedModel: 'slow-model',
        nextAvailableModel: 'fast-model',
      },
    },
  }));
}



describe('chatStateReducer', () => {
  it('returns initial state', () => {
    expect(chatStateReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('chatInitialized sets agent state (isStreaming/isProcessing now on agent-session)', () => {
    const state = chatStateReducer(
      initialState,
      chatInitialized(AGENT, {
        isStreaming: false,
        lastAttemptedMessage: null,
      }),
    );
    const agent = state.byAgentId[AGENT];
    expect(agent.agentId).toBe(AGENT);
    expect(agent.error).toBeNull();
    // isStreaming/isProcessing are no longer on chat-state
    expect(agent).not.toHaveProperty('isStreaming');
    expect(agent).not.toHaveProperty('isProcessing');
  });

  it('chatInitFailed sets error', () => {
    const state = chatStateReducer(initialState, chatInitFailed(AGENT, 'oops'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('oops');
  });

  it('chatInitFailed clears stale model-unavailable state so init errors are visible', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatInitFailed(AGENT, 'oops'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('oops');
    expect(agent.modelUnavailable).toBeNull();
  });

  it('chatSendStarted sets UI flags (isStreaming/isProcessing now on agent-session)', () => {
    const action = chatSendStarted(AGENT);
    const state = chatStateReducer(initialState, action);
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.isStalled).toBe(false);
    expect(agent.lastMessageTime).toBe(action.payload.timestamp);
    expect(selectChatLastMessageTime.select(asStoreState(state), AGENT)).toBe(action.payload.timestamp);
  });

  it('chatSendStarted clears stale model-unavailable recovery state', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatSendStarted(AGENT));
    expect(state.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('chatSendFailed sets error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatSendFailed(AGENT, 'network error'));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBe('network error');
  });

  it('chatSendFailed clears stale model-unavailable state so send errors are visible', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), chatSendFailed(AGENT, 'network error'));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('network error');
    expect(agent.modelUnavailable).toBeNull();
  });

  it('chatInterrupted clears streaming start time', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatInterrupted(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.error).toBeNull();
  });

  it('chatStopInitiated sets isInterrupting', () => {
    const state = chatStateReducer(initialState, chatStopInitiated(AGENT));
    expect(state.byAgentId[AGENT].isInterrupting).toBe(true);
  });

  it('chatStopCompleted clears interrupting and streaming start time', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatStopInitiated(AGENT));
    const s3 = chatStateReducer(s2, chatStopCompleted(AGENT));
    const agent = s3.byAgentId[AGENT];
    expect(agent.isInterrupting).toBe(false);
    expect(agent.streamingStartTime).toBeNull();
  });

  it('chatReset returns to empty state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatReset(AGENT));
    expect(s2.byAgentId[AGENT]).toEqual(emptyChatAgentState);
  });

  it('streamCompleted clears streaming metadata', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(
      s1,
      streamCompleted(AGENT, {
        lastAttemptedMessage: null,
        modelUnavailable: null,
      }),
    );
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
  });

  it('agentStreamUpdateReceived(started) sets streaming metadata state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const action = agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'started',
    });
    const s2 = chatStateReducer(s1, action);
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.isStalled).toBe(false);
    expect(agent.lastChunkTime).toBe(action.payload[0].timestamp);
  });

  it('agentStreamUpdateReceived(started) clears the previous terminal error for retry recovery', () => {
    const failed = chatStateReducer(initialState, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'error',
      error: 'Stream timeout after 10 minutes',
    }));
    const restarted = chatStateReducer(failed, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'started',
    }));

    expect(restarted.byAgentId[AGENT].error).toBeNull();
  });

  it('agentStreamUpdateReceived(started) clears stale model-unavailable recovery state', () => {
    const modelUnavailable = chatStateReducer(initialState, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'complete',
      completeMessage: {
        role: 'assistant',
        metadata: {
          modelUnavailable: true,
          failedModel: 'slow-model',
          nextAvailableModel: 'fast-model',
        },
      },
    }));
    const restarted = chatStateReducer(modelUnavailable, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'started',
    }));

    expect(restarted.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('agentStreamUpdateReceived(started) resets per-stream first-chunk status state for retries', () => {
    let state = chatStateReducer(initialState, chatSendStarted(AGENT));
    state = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'chunk',
      chunk: 'partial before failure',
    }));
    state = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'error',
      error: 'failed mid-stream',
    }));
    state = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'started',
    }));

    expect(state.byAgentId[AGENT].receivedFirstChunk).toBe(false);
    expect(state.byAgentId[AGENT].statusEvents).toEqual([]);

    state = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'chunk',
      chunk: 'retry first chunk',
    }));

    expect(state.byAgentId[AGENT].statusEvents).toHaveLength(1);
    expect(state.byAgentId[AGENT].statusEvents[0]).toMatchObject({ phase: 'streaming' });
  });

  it('agentStreamUpdateReceived(chunk) sets receivedFirstChunk and adds status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const action = agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'chunk',
      chunk: 'hello',
    });
    const s2 = chatStateReducer(s1, action);
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(true);
    expect(agent.isStalled).toBe(false);
    expect(agent.lastChunkReceivedAt).toBe(action.payload[0].timestamp);
    expect(agent.statusEvents).toHaveLength(1);
    expect(agent.statusEvents[0]).toMatchObject({ phase: 'streaming' });
  });

  it('agentStreamUpdateReceived(content-blocks) records non-text activity without first chunk', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const action = agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'content-blocks',
      contentBlocks: [{ type: 'text', text: 'structured' }],
    });
    const s2 = chatStateReducer(s1, action);
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.statusEvents).toHaveLength(0);
    expect(agent.lastChunkReceivedAt).toBe(action.payload[0].timestamp);
  });

  it('agentStreamUpdateReceived(complete) clears streaming metadata and derives model unavailable info', () => {
    let state = chatStateReducer(initialState, chatSendStarted(AGENT));
    state = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'chunk',
      chunk: 'hello',
    }));
    const completed = chatStateReducer(state, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'complete',
      completeMessage: {
        role: 'assistant',
        metadata: {
          modelUnavailable: true,
          failedModel: 'slow-model',
          nextAvailableModel: 'fast-model',
        },
      },
    }));
    const agent = completed.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.statusEvents).toEqual([]);
    expect(agent.modelUnavailable).toEqual({
      failedModel: 'slow-model',
      nextAvailableModel: 'fast-model',
    });
  });

  it('agentStreamUpdateReceived(error) clears streaming metadata and stores error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'error',
      error: 'stream failed',
    }));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.statusEvents).toEqual([]);
    expect(agent.error).toBe('stream failed');
  });

  it('agentStreamUpdateReceived(error) clears stale model-unavailable state', () => {
    const state = chatStateReducer(stateWithModelUnavailable(), agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'error',
      error: 'stream failed',
    }));
    const agent = state.byAgentId[AGENT];
    expect(agent.error).toBe('stream failed');
    expect(agent.modelUnavailable).toBeNull();
  });

  it('agentStreamUpdateReceived(timeout) clears streaming metadata and shows a timeout error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'timeout',
    }));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.error).toContain('timed out');
  });

  it('agentStreamUpdateReceived(complete with timeout finishReason) preserves a clear failure message', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'complete',
      finishReason: 'timeout',
    }));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
    expect(agent.error).toContain('timed out');
  });

  it('chatStallDetected sets isStalled', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatStallDetected(AGENT));
    expect(s2.byAgentId[AGENT].isStalled).toBe(true);
  });

  it('chatStuckStateCleared resets stuck state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatStallDetected(AGENT));
    const s3 = chatStateReducer(s2, chatStuckStateCleared(AGENT));
    const agent = s3.byAgentId[AGENT];
    expect(agent.isStalled).toBe(false);
  });

  it('chatModelUnavailableCleared clears info', () => {
    const info = { failedModel: 'opus', nextAvailableModel: 'sonnet' };
    let s = chatStateReducer(
      initialState,
      streamCompleted(AGENT, { lastAttemptedMessage: null, modelUnavailable: info }),
    );
    expect(s.byAgentId[AGENT].modelUnavailable).toEqual(info);
    s = chatStateReducer(s, chatModelUnavailableCleared(AGENT));
    expect(s.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('chatStreamingReconciled sets streamingStartTime when not already set', () => {
    const s = chatStateReducer(initialState, chatStreamingReconciled(AGENT));
    const agent = s.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeDefined();
  });

  it('streamStatusReceived appends status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const event = { phase: 'connecting', message: 'test', level: 'info' as const, timestamp: 1000 };
    const s2 = chatStateReducer(s1, streamStatusReceived(AGENT, event, false));
    expect(s2.byAgentId[AGENT].statusEvents).toHaveLength(1);
    expect(s2.byAgentId[AGENT].statusEvents[0]).toEqual(event);
  });

  it('streamStatusReceived stores a clone-safe status event from non-cloneable payloads', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const payload: Record<string, unknown> = {
      phase: 'tool-call',
      message: new Error('tool failed'),
      level: 'error',
      timestamp: 3000,
      callback: () => undefined,
      token: Symbol('token'),
    };
    payload.self = payload;

    const s2 = chatStateReducer(s1, streamStatusReceived(AGENT, payload, false));
    const [storedEvent] = s2.byAgentId[AGENT].statusEvents;

    expect(storedEvent).toEqual({
      phase: 'tool-call',
      message: 'tool failed',
      level: 'error',
      timestamp: 3000,
    });
    expect(JSON.parse(JSON.stringify(storedEvent))).toEqual(storedEvent);
    expect(() => structuredClone(storedEvent)).not.toThrow();
  });

  it('streamStatusReceived resets receivedFirstChunk when resetFirstChunk is true', () => {
    let s = chatStateReducer(initialState, chatSendStarted(AGENT));
    s = chatStateReducer(s, agentStreamUpdateReceived({
      agentId: AGENT,
      handlerSessionId: AGENT,
      source: 'sendMessage',
      eventType: 'chunk',
      chunk: 'hello',
    }));
    expect(s.byAgentId[AGENT].receivedFirstChunk).toBe(true);
    const event = { phase: 'tool_use', message: 'running', level: 'info' as const, timestamp: 2000 };
    s = chatStateReducer(s, streamStatusReceived(AGENT, event, true));
    expect(s.byAgentId[AGENT].receivedFirstChunk).toBe(false);
  });

  it('streamTimedOut clears streaming start time', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamTimedOut(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeNull();
  });

  it('chatRebindStarted sets isRebinding', () => {
    const s = chatStateReducer(initialState, chatRebindStarted(AGENT));
    expect(s.byAgentId[AGENT].isRebinding).toBe(true);
  });

  it('chatRebindEnded clears isRebinding', () => {
    let s = chatStateReducer(initialState, chatRebindStarted(AGENT));
    s = chatStateReducer(s, chatRebindEnded(AGENT));
    expect(s.byAgentId[AGENT].isRebinding).toBe(false);
  });

  it('chatTrackedWorkspaceSet updates trackedWorkspaceId', () => {
    const s = chatStateReducer(initialState, chatTrackedWorkspaceSet(AGENT, 'ws-1'));
    expect(s.byAgentId[AGENT].trackedWorkspaceId).toBe('ws-1');
  });

  it('chatTrackedWorkspaceSet clears trackedWorkspaceId with null', () => {
    let s = chatStateReducer(initialState, chatTrackedWorkspaceSet(AGENT, 'ws-1'));
    s = chatStateReducer(s, chatTrackedWorkspaceSet(AGENT, null));
    expect(s.byAgentId[AGENT].trackedWorkspaceId).toBeNull();
  });

  it('does not store one-shot UI cleanup request state', () => {
    const rejectedField = ['ui', 'Cleanup', 'Request'].join('');
    expect(emptyChatAgentState).not.toHaveProperty(rejectedField);

    const state = chatStateReducer(initialState, chatSendStarted(AGENT));
    expect(state.byAgentId[AGENT]).not.toHaveProperty(rejectedField);
  });

  describe('workspaceDeleted', () => {
    it('purges byAgentId entries for every agentId in the payload', () => {
      let state = chatStateReducer(initialState, chatSendStarted('agent-a'));
      state = chatStateReducer(state, chatSendStarted('agent-b'));
      state = chatStateReducer(state, chatSendStarted('agent-c'));

      state = chatStateReducer(state, workspaceDeleted('ws-1', ['agent-a', 'agent-b']));

      expect(state.byAgentId['agent-a']).toBeUndefined();
      expect(state.byAgentId['agent-b']).toBeUndefined();
      expect(state.byAgentId['agent-c']).toBeDefined();
    });

    it('is a no-op when the payload is empty', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, workspaceDeleted('ws-1', []));
      expect(next).toBe(state);
    });

    it('is a no-op when no chat-state entry exists for the doomed agents', () => {
      const state = chatStateReducer(initialState, chatSendStarted(AGENT));
      const next = chatStateReducer(state, workspaceDeleted('ws-1', ['unknown']));
      expect(next).toBe(state);
    });
  });

});

describe('chatState selectors', () => {
  it('selectChatError returns null for clean state', () => {
    const storeState = asStoreState(initialState);
    expect(selectChatError.select(storeState, AGENT)).toBeNull();
  });

  it('selectChatError returns error message', () => {
    const state = chatStateReducer(initialState, chatInitFailed(AGENT, 'bad'));
    expect(selectChatError.select(asStoreState(state), AGENT)).toBe('bad');
  });

  it('selectChatIsStalled returns false by default', () => {
    expect(selectChatIsStalled.select(asStoreState(initialState), AGENT)).toBe(false);
  });

  it('selectChatAgentState returns empty state for unknown', () => {
    expect(selectChatAgentState.select(asStoreState(initialState), 'x')).toEqual(emptyChatAgentState);
  });

  it('selectChatLastMessageTime returns 0 by default', () => {
    expect(selectChatLastMessageTime.select(asStoreState(initialState), AGENT)).toBe(0);
  });

  // Transcript hydration tests
  it('transcriptHydrationStarted sets status to loading', () => {
    const state = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    expect(state.byAgentId[AGENT].transcriptHydration).toBe('loading');
  });

  it('transcriptHydrationStarted sets agentId even when no prior entry exists', () => {
    const state = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    expect(state.byAgentId[AGENT].agentId).toBe(AGENT);
  });

  it('transcriptHydrationSettled sets status to settled', () => {
    const loadingState = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    const settledState = chatStateReducer(loadingState, transcriptHydrationSettled(AGENT));
    expect(settledState.byAgentId[AGENT].transcriptHydration).toBe('settled');
  });

  it('transcriptHydrationSettled works even if never started (error path)', () => {
    const state = chatStateReducer(initialState, transcriptHydrationSettled(AGENT));
    expect(state.byAgentId[AGENT].transcriptHydration).toBe('settled');
  });

  it('transcriptHydrationSettled sets agentId even when no prior entry exists', () => {
    const state = chatStateReducer(initialState, transcriptHydrationSettled(AGENT));
    expect(state.byAgentId[AGENT].agentId).toBe(AGENT);
  });

  it('selectTranscriptHydration returns undefined by default', () => {
    expect(selectTranscriptHydration.select(asStoreState(initialState), AGENT)).toBeUndefined();
  });

  it('selectTranscriptHydration returns loading after start', () => {
    const state = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    expect(selectTranscriptHydration.select(asStoreState(state), AGENT)).toBe('loading');
  });

  it('selectTranscriptHydration returns settled after completion', () => {
    const loadingState = chatStateReducer(initialState, transcriptHydrationStarted(AGENT));
    const settledState = chatStateReducer(loadingState, transcriptHydrationSettled(AGENT));
    expect(selectTranscriptHydration.select(asStoreState(settledState), AGENT)).toBe('settled');
  });

});

