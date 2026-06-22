import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  type ChatPanelServiceState,
  hasChatServiceStateChanged,
  syncChatStateFromService,
} from '../chat-panel-state-sync';

function createChatState(overrides: Partial<ChatPanelServiceState> = {}): ChatPanelServiceState {
  return {
    agentId: 'agent-1',
    session: null,
    messages: [],
    isStreaming: false,
    isProcessing: false,
    isInterrupting: false,
    error: null,
    streamingStartTime: null,
    lastAttemptedMessage: null,
    lastChunkTime: null,
    isStalled: false,
    modelUnavailable: null,
    statusEvents: [],
    receivedFirstChunk: false,
    trackedWorkspaceId: null,
    isRebinding: false,
    lastMessageTime: 0,
    lastChunkReceivedAt: 0,
    idleReconcileSuppressed: false,
    ...overrides,
  };
}

describe('chat panel state sync helpers', () => {
  it('copies streaming metadata and retry state from chat state updates', () => {
    const incomingState = createChatState({
      isStreaming: true,
      isProcessing: true,
      isInterrupting: true,
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

  describe('statusEvents handling', () => {
    it('detects statusEvents changes as meaningful', () => {
      const currentState = createChatState();
      const events = [
        {
          phase: 'launch',
          message: 'Launching…',
          level: 'info' as const,
          timestamp: Date.now(),
        },
      ];
      const incomingState = createChatState({ statusEvents: events });
      expect(hasChatServiceStateChanged(currentState, incomingState)).toBe(true);
    });

    it('does not flag identical statusEvents reference as changed', () => {
      const events = [
        {
          phase: 'launch',
          message: 'Launching…',
          level: 'info' as const,
          timestamp: Date.now(),
        },
      ];
      const state = createChatState({ statusEvents: events });
      expect(hasChatServiceStateChanged(state, state)).toBe(false);
    });

    it('syncs statusEvents from incoming state', () => {
      const events = [
        { phase: 'launch', message: 'Launching…', level: 'info' as const, timestamp: 1000 },
        { phase: 'init', message: 'Initializing…', level: 'info' as const, timestamp: 2000 },
      ];
      const incoming = createChatState({ statusEvents: events });
      const synced = syncChatStateFromService(createChatState(), incoming);
      expect(synced.statusEvents).toEqual(events);
      expect(synced.statusEvents).toBe(events); // same reference
    });

    it('clears statusEvents when incoming state has empty array', () => {
      const events = [
        { phase: 'launch', message: 'Launching…', level: 'info' as const, timestamp: 1000 },
      ];
      const current = createChatState({ statusEvents: events });
      const incoming = createChatState({ statusEvents: [] });
      const synced = syncChatStateFromService(current, incoming);
      expect(synced.statusEvents).toEqual([]);
    });

    it('passes through statusEvents even when preserveTransientState is true', () => {
      const events = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info' as const, timestamp: 1000 },
      ];
      const current = createChatState({
        statusEvents: events,
        isStreaming: true,
        isProcessing: true,
        streamingStartTime: 100,
      });
      const incoming = createChatState({ statusEvents: [] });
      const synced = syncChatStateFromService(current, incoming, {
        isStreaming: true,
        isProcessing: true,
        preserveTransientState: true,
      });
      // statusEvents should use incoming (empty), not be preserved
      expect(synced.statusEvents).toEqual([]);
    });
  });

  describe('stream-ending merge with ID-rewrite reconciliation', () => {
    // This exercises the same merge logic used in ChatPanel's store subscription
    // when a stream ends but the incoming snapshot has fewer messages.
    // Extracted here so the position-based fallback can be regression-tested
    // without rendering the full Svelte component.

    type Msg = { id: string; role: string; content: string };

    function mergeWithReconciliation(localMessages: Msg[], incomingMessages: Msg[]): Msg[] {
      const incomingById = new Map(incomingMessages.map((m) => [m.id, m]));
      const matchedIncomingIds = new Set<string>();

      const merged = localMessages.map((localMsg) => {
        const incomingMsg = incomingById.get(localMsg.id);
        if (incomingMsg) {
          matchedIncomingIds.add(incomingMsg.id);
        }
        return incomingMsg ?? localMsg;
      });

      // Position/role-based fallback for unmatched assistant messages
      const unmatchedAssistant = incomingMessages.filter(
        (m) => m.role === 'assistant' && !matchedIncomingIds.has(m.id),
      );
      if (unmatchedAssistant.length > 0) {
        const finalAssistant = unmatchedAssistant[unmatchedAssistant.length - 1];
        for (let i = merged.length - 1; i >= 0; i--) {
          if (merged[i].role === 'assistant' && !matchedIncomingIds.has(merged[i].id)) {
            merged[i] = finalAssistant;
            break;
          }
        }
      }

      return merged;
    }

    it('reconciles by ID when IDs match (normal case)', () => {
      const local: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'streaming...' },
        { id: 'u2', role: 'user', content: 'extra local msg' },
      ];
      const incoming: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'final answer' },
      ];

      const merged = mergeWithReconciliation(local, incoming);
      expect(merged).toHaveLength(3);
      expect(merged[1].content).toBe('final answer'); // Updated from incoming
      expect(merged[2].content).toBe('extra local msg'); // Kept local
    });

    it('reconciles by position/role when backend rewrites assistant ID', () => {
      const local: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'streaming-a1', role: 'assistant', content: 'streaming partial...' },
        { id: 'u2', role: 'user', content: 'extra' },
      ];
      // Backend finalized with a different ID for the assistant message
      const incoming: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'final-a1', role: 'assistant', content: 'complete final answer' },
      ];

      const merged = mergeWithReconciliation(local, incoming);
      expect(merged).toHaveLength(3);
      // The streaming assistant message should be replaced with the backend's final version
      expect(merged[1].id).toBe('final-a1');
      expect(merged[1].content).toBe('complete final answer');
      expect(merged[2].content).toBe('extra'); // Extra local msg preserved
    });

    it('does not reconcile when all assistant messages match by ID', () => {
      const local: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'old content' },
      ];
      const incoming: Msg[] = [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'updated content' },
      ];

      const merged = mergeWithReconciliation(local, incoming);
      expect(merged).toHaveLength(2);
      expect(merged[1].id).toBe('a1');
      expect(merged[1].content).toBe('updated content');
    });

    it('reconciles only the last unmatched assistant when multiple exist', () => {
      const local: Msg[] = [
        { id: 'u1', role: 'user', content: 'q1' },
        { id: 'a1', role: 'assistant', content: 'ans1' },
        { id: 'u2', role: 'user', content: 'q2' },
        { id: 'streaming-a2', role: 'assistant', content: 'partial' },
      ];
      const incoming: Msg[] = [
        { id: 'u1', role: 'user', content: 'q1' },
        { id: 'a1', role: 'assistant', content: 'ans1' },
        { id: 'final-a2', role: 'assistant', content: 'complete' },
      ];

      const merged = mergeWithReconciliation(local, incoming);
      expect(merged).toHaveLength(4);
      expect(merged[1].id).toBe('a1'); // Matched by ID
      expect(merged[3].id).toBe('final-a2'); // Reconciled by position
      expect(merged[3].content).toBe('complete');
    });
  });
});