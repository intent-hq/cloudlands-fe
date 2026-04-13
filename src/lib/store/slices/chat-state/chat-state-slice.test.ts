import { describe, expect, it } from 'vitest';
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
  chatRetryCleared,
  chatModelRetryCleared,
  chatSmartRetryPrepared,
  chatStopInitiated,
  chatStopCompleted,
  chatReset,
  chatStreamingReconciled,
  streamStarted,
  streamChunkFlushed,
  streamChunkReceived,
  streamCompleted,
  streamErrored,
  streamTimedOut,
  chatStallDetected,
  chatStuckStateCleared,
  chatAgentRemoved,
  chatModelUnavailableSet,
  chatModelUnavailableCleared,
  chatRebindStarted,
  chatRebindEnded,
  chatTrackedWorkspaceSet,
  streamStatusReceived,
} from './chat-state-slice';
import {
  selectChatAgentState,
  selectChatIsStreaming,
  selectChatIsProcessing,
  selectChatError,
  selectChatIsStalled,
  selectChatStreamingContent,
  selectChatLastMessageTime,
} from './chat-state-selectors';

const AGENT = 'agent-1';

function asStoreState(chatState: ReturnType<typeof chatStateReducer>): StoreState {
  return { chatState } as unknown as StoreState;
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
        streamingContent: '',
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

  it('chatSendStarted sets UI flags (isStreaming/isProcessing now on agent-session)', () => {
    const state = chatStateReducer(initialState, chatSendStarted(AGENT));
    const agent = state.byAgentId[AGENT];
    expect(agent.streamingContent).toBe('');
    expect(agent.error).toBeNull();
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.isStalled).toBe(false);
  });

  it('chatSendFailed sets error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatSendFailed(AGENT, 'network error'));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBe('network error');
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

  it('chatStopCompleted clears interrupting and streaming content', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatStopInitiated(AGENT));
    const s3 = chatStateReducer(s2, chatStopCompleted(AGENT));
    const agent = s3.byAgentId[AGENT];
    expect(agent.isInterrupting).toBe(false);
    expect(agent.streamingContent).toBe('');
  });

  it('chatReset returns to empty state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatReset(AGENT));
    expect(s2.byAgentId[AGENT]).toEqual(emptyChatAgentState);
  });

  it('streamChunkFlushed updates streaming content (messages now in agent-session)', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamChunkFlushed(AGENT, 'hello world'));
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingContent).toBe('hello world');
  });

  it('streamChunkReceived(text) sets receivedFirstChunk and adds status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamChunkReceived(AGENT, true));
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(true);
    expect(agent.isStalled).toBe(false);
    expect(agent.statusEvents).toHaveLength(1);
    expect(agent.statusEvents[0].phase).toBe('streaming');
  });

  it('streamChunkReceived(non-text) does not set receivedFirstChunk', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamChunkReceived(AGENT, false));
    const agent = s2.byAgentId[AGENT];
    expect(agent.receivedFirstChunk).toBe(false);
    expect(agent.isStalled).toBe(false);
    expect(agent.statusEvents).toHaveLength(0);
  });

  it('streamCompleted clears streaming content', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(
      s1,
      streamCompleted(AGENT, {
        lastAttemptedMessage: null,
        modelUnavailable: null,
      }),
    );
    const agent = s2.byAgentId[AGENT];
    expect(agent.streamingContent).toBe('');
  });

  it('streamErrored sets error', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(
      s1,
      streamErrored(AGENT, {
        error: 'stream failed',
      }),
    );
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBe('stream failed');
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

  it('chatAgentRemoved removes agent state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, chatAgentRemoved(AGENT));
    expect(s2.byAgentId[AGENT]).toBeUndefined();
  });

  it('chatRetryCleared clears error and lastAttemptedMessage', () => {
    const s1 = chatStateReducer(initialState, chatInitFailed(AGENT, 'error'));
    const s2 = chatStateReducer(s1, chatRetryCleared(AGENT));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.lastAttemptedMessage).toBeNull();
  });

  it('chatModelRetryCleared clears error, modelUnavailable, and lastAttemptedMessage', () => {
    let s = chatStateReducer(initialState, chatInitFailed(AGENT, 'model error'));
    s = chatStateReducer(s, chatModelUnavailableSet(AGENT, { failedModel: 'opus', nextAvailableModel: 'sonnet' }));
    s = chatStateReducer(s, chatModelRetryCleared(AGENT));
    const agent = s.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.modelUnavailable).toBeNull();
    expect(agent.lastAttemptedMessage).toBeNull();
  });

  it('chatSmartRetryPrepared clears error, modelUnavailable, lastAttemptedMessage', () => {
    let s = chatStateReducer(initialState, chatInitFailed(AGENT, 'err'));
    s = chatStateReducer(s, chatModelUnavailableSet(AGENT, { failedModel: 'a', nextAvailableModel: 'b' }));
    s = chatStateReducer(s, chatSmartRetryPrepared(AGENT));
    const agent = s.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.modelUnavailable).toBeNull();
    expect(agent.lastAttemptedMessage).toBeNull();
  });

  it('chatModelUnavailableSet stores info', () => {
    const info = { failedModel: 'opus', nextAvailableModel: 'sonnet' };
    const s = chatStateReducer(initialState, chatModelUnavailableSet(AGENT, info));
    expect(s.byAgentId[AGENT].modelUnavailable).toEqual(info);
  });

  it('chatModelUnavailableCleared clears info', () => {
    const info = { failedModel: 'opus', nextAvailableModel: 'sonnet' };
    let s = chatStateReducer(initialState, chatModelUnavailableSet(AGENT, info));
    s = chatStateReducer(s, chatModelUnavailableCleared(AGENT));
    expect(s.byAgentId[AGENT].modelUnavailable).toBeNull();
  });

  it('chatStreamingReconciled sets streamingStartTime when not already set', () => {
    const s = chatStateReducer(initialState, chatStreamingReconciled(AGENT));
    const agent = s.byAgentId[AGENT];
    expect(agent.streamingStartTime).toBeDefined();
  });

  it('streamStarted sets streaming content state', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamStarted(AGENT, { hasRestoredContent: false, existingContent: '' }));
    const agent = s2.byAgentId[AGENT];
    expect(agent.error).toBeNull();
    expect(agent.isStalled).toBe(false);
    expect(agent.streamingContent).toBe('');
  });

  it('streamStarted restores content when hasRestoredContent is true', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const s2 = chatStateReducer(s1, streamStarted(AGENT, { hasRestoredContent: true, existingContent: 'restored text' }));
    expect(s2.byAgentId[AGENT].streamingContent).toBe('restored text');
  });

  it('streamStatusReceived appends status event', () => {
    const s1 = chatStateReducer(initialState, chatSendStarted(AGENT));
    const event = { phase: 'connecting', message: 'test', level: 'info' as const, timestamp: 1000 };
    const s2 = chatStateReducer(s1, streamStatusReceived(AGENT, event, false));
    expect(s2.byAgentId[AGENT].statusEvents).toHaveLength(1);
    expect(s2.byAgentId[AGENT].statusEvents[0]).toEqual(event);
  });

  it('streamStatusReceived resets receivedFirstChunk when resetFirstChunk is true', () => {
    let s = chatStateReducer(initialState, chatSendStarted(AGENT));
    s = chatStateReducer(s, streamChunkReceived(AGENT, true));
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
});

describe('chatState selectors', () => {
  it('selectChatIsStreaming reads from agent-session (returns false without session)', () => {
    const storeState = asStoreState(initialState);
    expect(selectChatIsStreaming.select(storeState, AGENT)).toBe(false);
  });

  it('selectChatIsProcessing reads from agent-session (returns false without session)', () => {
    const storeState = asStoreState(initialState);
    expect(selectChatIsProcessing.select(storeState, AGENT)).toBe(false);
  });

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

  it('selectChatStreamingContent returns empty for fresh state', () => {
    expect(selectChatStreamingContent.select(asStoreState(initialState), AGENT)).toBe('');
  });

  it('selectChatAgentState returns empty state for unknown', () => {
    expect(selectChatAgentState.select(asStoreState(initialState), 'x')).toEqual(emptyChatAgentState);
  });

  it('selectChatLastMessageTime returns 0 by default', () => {
    expect(selectChatLastMessageTime.select(asStoreState(initialState), AGENT)).toBe(0);
  });

});

