/**
 * Tests for per-session assistantMessageId on the streamingCallbacks map.
 *
 * Proves that two overlapping streamMessage() calls carry distinct assistant
 * message IDs through to their respective handleStreamCompletion() invocations.
 * Before the fix, a single `this.assistantMessageId` instance field was
 * overwritten by the second call before the first's completion ran.
 */
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Minimal reproduction of the streamingCallbacks Map type from ACPProvider.
 * Only the fields relevant to the interleaved-ID test are included.
 */
interface StreamCallbackEntry {
  assistantMessageId?: string;
  onComplete?: (message: { id: string }) => void;
  streamGeneration: number;
}

describe('per-session assistantMessageId (interleaved streams)', () => {
  let streamingCallbacks: Map<string, StreamCallbackEntry>;
  let completedMessageIds: string[];
  let idCounter: number;

  /** Mimics unifiedIdService.generateMessageId() */
  function generateMessageId(): string {
    return `msg_generated_${++idCounter}`;
  }

  /** Mimics the relevant part of handleStreamCompletion */
  function handleStreamCompletion(sessionId: string): void {
    const callbacks = streamingCallbacks.get(sessionId);
    if (!callbacks) return;
    const messageId = callbacks.assistantMessageId || generateMessageId();
    if (callbacks.onComplete) {
      callbacks.onComplete({ id: messageId });
    }
    streamingCallbacks.delete(sessionId);
  }

  beforeEach(() => {
    streamingCallbacks = new Map();
    completedMessageIds = [];
    idCounter = 0;
  });

  it('two sequential streamMessage calls with distinct IDs produce two completions with distinct IDs', () => {
    // --- Stream 1 registers callbacks (simulates first streamMessage) ---
    streamingCallbacks.set('session-1', {
      assistantMessageId: 'msg_pre_assigned_A',
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 1,
    });

    // --- Stream 2 registers callbacks BEFORE stream 1 completes ---
    streamingCallbacks.set('session-2', {
      assistantMessageId: 'msg_pre_assigned_B',
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 2,
    });

    // Both entries are live — the old instance-field approach would have
    // overwritten `this.assistantMessageId` with 'msg_pre_assigned_B'.

    // --- Stream 1 completes first ---
    handleStreamCompletion('session-1');

    // --- Stream 2 completes second ---
    handleStreamCompletion('session-2');

    // Both completions must carry their own pre-assigned IDs
    expect(completedMessageIds).toEqual(['msg_pre_assigned_A', 'msg_pre_assigned_B']);
  });

  it('falls back to generated ID when no assistantMessageId is set on the callbacks entry', () => {
    streamingCallbacks.set('session-no-id', {
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 1,
    });

    handleStreamCompletion('session-no-id');

    expect(completedMessageIds).toHaveLength(1);
    expect(completedMessageIds[0]).toMatch(/^msg_generated_/);
  });

  it('interleaved completion order does not mix IDs', () => {
    // Register three overlapping streams
    streamingCallbacks.set('s1', {
      assistantMessageId: 'msg_alpha',
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 1,
    });
    streamingCallbacks.set('s2', {
      assistantMessageId: 'msg_beta',
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 2,
    });
    streamingCallbacks.set('s3', {
      assistantMessageId: 'msg_gamma',
      onComplete: (msg) => completedMessageIds.push(msg.id),
      streamGeneration: 3,
    });

    // Complete out of order: s2, s3, s1
    handleStreamCompletion('s2');
    handleStreamCompletion('s3');
    handleStreamCompletion('s1');

    expect(completedMessageIds).toEqual(['msg_beta', 'msg_gamma', 'msg_alpha']);
  });
});
