/**
 * Tests for the race condition between done-notification (onCleanup)
 * and JSON-RPC response (handleStreamCompletion) when resolving
 * the streamMessage() promise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('streamMessage resolve race', () => {
  let streamingCallbacks: Map<string, { resolveStream: () => void; streamGeneration: number }>;
  let streamGeneration: number;

  beforeEach(() => {
    vi.useFakeTimers();
    streamingCallbacks = new Map();
    streamGeneration = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('done notification resolves streamMessage promise when it fires before response timer', async () => {
    let resolved = false;
    const messageId = 'msg-1';

    const promise = new Promise<void>((resolve) => {
      streamingCallbacks.set(messageId, {
        resolveStream: resolve,
        streamGeneration: 1,
      });
    }).then(() => {
      resolved = true;
    });

    // Simulate onCleanup path (done notification fires first)
    const cb = streamingCallbacks.get(messageId);
    if (cb && cb.streamGeneration === streamGeneration) {
      cb.resolveStream();
      streamingCallbacks.delete(messageId);
    }

    await promise;
    expect(resolved).toBe(true);

    // Simulate handleStreamCompletion path 100ms later — map entry already gone
    vi.advanceTimersByTime(100);
    const staleCb = streamingCallbacks.get(messageId);
    expect(staleCb).toBeUndefined();
  });

  it('response timer resolves streamMessage promise when it fires before done notification', async () => {
    let resolveCount = 0;
    const messageId = 'msg-2';

    let resolveStream!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveStream = () => {
        resolve();
      };
      streamingCallbacks.set(messageId, {
        resolveStream,
        streamGeneration: 1,
      });
    }).then(() => {
      resolveCount++;
    });

    // Simulate handleStreamCompletion path (response timer fires first)
    const cb = streamingCallbacks.get(messageId);
    expect(cb).toBeDefined();
    cb!.resolveStream();
    streamingCallbacks.delete(messageId);

    await promise;
    expect(resolveCount).toBe(1);

    // Simulate onCleanup path later — calling resolve again is idempotent
    resolveStream();
    // Allow microtasks to flush
    await vi.advanceTimersByTimeAsync(0);

    // resolve() on an already-resolved promise is a no-op; count stays 1
    expect(resolveCount).toBe(1);
  });

  it('stale done notification from previous generation is ignored', async () => {
    let resolved = false;
    const messageId = 'msg-3';

    const promise = new Promise<void>((resolve) => {
      streamingCallbacks.set(messageId, {
        resolveStream: resolve,
        streamGeneration: 1,
      });
    }).then(() => {
      resolved = true;
    });

    // Advance generation (simulates a new stream starting)
    streamGeneration = 2;

    // Simulate onCleanup from generation 1 — should skip because generations don't match
    const cb = streamingCallbacks.get(messageId);
    if (cb && cb.streamGeneration === streamGeneration) {
      cb.resolveStream();
      streamingCallbacks.delete(messageId);
    }

    // Flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).toBe(false);
    expect(streamingCallbacks.has(messageId)).toBe(true);
  });
});
