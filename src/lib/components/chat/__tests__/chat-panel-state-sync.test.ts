import { describe, expect, it } from 'vitest';

import type { ChatState } from '$features/agent/services/chat.service';

import {
  hasChatServiceStateChanged,
  syncChatStateFromService,
} from '../chat-panel-state-sync';

function createChatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    session: null,
    messages: [],
    isStreaming: false,
    isProcessing: false,
    isInterrupting: false,
    streamingContent: '',
    error: null,
    streamingStartTime: null,
    lastAttemptedMessage: null,
    lastChunkTime: null,
    isStalled: false,
    modelUnavailable: null,
    ...overrides,
  };
}

describe('chat panel state sync helpers', () => {
  it('copies streaming metadata and retry state from ChatService updates', () => {
    const incomingState = createChatState({
      isStreaming: true,
      isProcessing: true,
      isInterrupting: true,
      streamingContent: 'partial',
      streamingStartTime: 100,
      lastChunkTime: 150,
      isStalled: true,
      lastAttemptedMessage: { text: 'retry me' },
      modelUnavailable: {
        failedModel: 'claude-old',
        nextAvailableModel: 'claude-new',
      },
    });

    const syncedState = syncChatStateFromService(createChatState(), incomingState);

    expect(syncedState.isInterrupting).toBe(true);
    expect(syncedState.streamingStartTime).toBe(100);
    expect(syncedState.lastChunkTime).toBe(150);
    expect(syncedState.isStalled).toBe(true);
    expect(syncedState.lastAttemptedMessage).toEqual({ text: 'retry me' });
    expect(syncedState.modelUnavailable).toEqual({
      failedModel: 'claude-old',
      nextAvailableModel: 'claude-new',
    });
  });

  it('preserves transient streaming metadata while optimistic streaming is being held', () => {
    const currentState = createChatState({
      isStreaming: true,
      isProcessing: true,
      streamingStartTime: 200,
      lastAttemptedMessage: { text: 'hello' },
    });

    const syncedState = syncChatStateFromService(currentState, createChatState(), {
      isStreaming: currentState.isStreaming,
      isProcessing: currentState.isProcessing,
      preserveTransientState: true,
    });

    expect(syncedState.isStreaming).toBe(true);
    expect(syncedState.isProcessing).toBe(true);
    expect(syncedState.streamingStartTime).toBe(200);
    expect(syncedState.lastAttemptedMessage).toEqual({ text: 'hello' });
  });

  it('treats timing and retry/model-unavailable changes as meaningful updates', () => {
    const currentState = createChatState();
    const incomingState = createChatState({
      lastChunkTime: 123,
      modelUnavailable: {
        failedModel: 'gpt-old',
        nextAvailableModel: 'gpt-new',
      },
    });

    expect(hasChatServiceStateChanged(currentState, incomingState)).toBe(true);
  });
});