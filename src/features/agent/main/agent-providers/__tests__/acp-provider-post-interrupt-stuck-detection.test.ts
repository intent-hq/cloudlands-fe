/**
 * Regression tests for post-interrupt stuck detection and normal-timeout heuristic.
 *
 * Two separate signals track agent activity:
 *
 * 1. `hasReceivedActivity` (boolean) — BROAD signal for post-interrupt stuck detection.
 *    Set to true by recordStreamingActivity() for ANY agent activity: session/update
 *    notifications, ACP server requests (fs/write_text_file), and permission requests.
 *    Prevents false "stuck" restarts when the agent is doing tool/file work.
 *
 * 2. `chunksReceived` (number) — NARROW signal for normal prompt-response timeout.
 *    Only incremented by recordStreamChunk() from the session/update notification path.
 *    Used to decide "stream probably completed via session/update — silently resolve".
 *    File ops and permission requests do NOT increment this, so a stalled stream after
 *    file ops correctly errors out instead of silently resolving.
 *
 * These tests verify the activity tracking logic that feeds both detection paths
 * by simulating the streamingCallbacks map and the two recording functions.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';

/**
 * Minimal reproduction of the streaming callbacks structure used by ACPProvider.
 * We test the activity tracking pattern directly rather than instantiating the
 * full ACPProvider (which requires process spawning, IPC, etc.).
 */
interface StreamingCallbacks {
  lastActivityTime?: number;
  chunksReceived?: number;
  hasReceivedActivity?: boolean;
}

describe('Post-Interrupt Stuck Detection', () => {
  let streamingCallbacks: Map<string, StreamingCallbacks>;
  const sessionId = 'test-session';

  // Mirrors ACPProvider.recordStreamingActivity() — broad signal only
  // Called from ACP server requests and permission requests
  function recordStreamingActivity(callbackSessionId: string) {
    const callbacks = streamingCallbacks.get(callbackSessionId);
    if (callbacks) {
      callbacks.lastActivityTime = Date.now();
      callbacks.hasReceivedActivity = true;
    }
  }

  // Mirrors ACPProvider.recordStreamChunk() — both signals
  // Called from the session/update notification path only
  function recordStreamChunk(callbackSessionId: string) {
    const callbacks = streamingCallbacks.get(callbackSessionId);
    if (callbacks) {
      callbacks.lastActivityTime = Date.now();
      callbacks.chunksReceived = (callbacks.chunksReceived || 0) + 1;
      callbacks.hasReceivedActivity = true;
    }
  }

  // Mirrors the post-interrupt stuck detection check
  function checkPostInterruptActivity(callbackSessionId: string): boolean {
    const callbacks = streamingCallbacks.get(callbackSessionId);
    return callbacks?.hasReceivedActivity ?? false;
  }

  // Mirrors the normal prompt-response timeout check
  function checkNormalTimeoutHasChunks(callbackSessionId: string): boolean {
    const callbacks = streamingCallbacks.get(callbackSessionId);
    return callbacks != null && (callbacks.chunksReceived ?? 0) > 0;
  }

  beforeEach(() => {
    streamingCallbacks = new Map();
    streamingCallbacks.set(sessionId, {
      lastActivityTime: Date.now(),
      chunksReceived: 0,
      hasReceivedActivity: false,
    });
  });

  describe('post-interrupt: activity signal correctly prevents false stuck detection', () => {
    it('should detect activity from session/update (text chunks)', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
      recordStreamChunk(sessionId);
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });

    it('should detect activity from session/update (tool_call)', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
      recordStreamChunk(sessionId);
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });

    it('should detect activity from ACP server requests (fs/write_text_file)', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
      recordStreamingActivity(sessionId);
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });

    it('should detect activity from permission requests', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
      recordStreamingActivity(sessionId);
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });

    it('should detect activity from mixed events', () => {
      recordStreamingActivity(sessionId); // file op
      recordStreamChunk(sessionId); // session/update
      recordStreamingActivity(sessionId); // permission
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });
  });

  describe('stuck detection correctly fires when truly no activity', () => {
    it('should report no activity when hasReceivedActivity is false', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
    });

    it('should report no activity for unknown session', () => {
      expect(checkPostInterruptActivity('nonexistent-session')).toBe(false);
    });

    it('should report no activity when callbacks are undefined', () => {
      streamingCallbacks.delete(sessionId);
      expect(checkPostInterruptActivity(sessionId)).toBe(false);
    });
  });

  describe('regression: tool-only work does not trigger false stuck detection', () => {
    it('agent doing only ACP server file operations is NOT falsely detected as stuck', () => {
      expect(checkPostInterruptActivity(sessionId)).toBe(false);

      recordStreamingActivity(sessionId); // fs/read_text_file
      recordStreamingActivity(sessionId); // fs/write_text_file

      // Post-interrupt stuck detection should see activity
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
      // But chunksReceived should NOT be incremented (file ops don't count)
      expect(streamingCallbacks.get(sessionId)!.chunksReceived).toBe(0);
    });

    it('lastActivityTime is updated on each activity event', () => {
      const timeBefore = Date.now();
      recordStreamingActivity(sessionId);
      const timeAfter = Date.now();

      const callbacks = streamingCallbacks.get(sessionId)!;
      expect(callbacks.lastActivityTime).toBeGreaterThanOrEqual(timeBefore);
      expect(callbacks.lastActivityTime).toBeLessThanOrEqual(timeAfter);
    });
  });

  describe('normal-timeout: chunksReceived only tracks session/update', () => {
    it('session/update increments chunksReceived', () => {
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(false);
      recordStreamChunk(sessionId);
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(true);
      expect(streamingCallbacks.get(sessionId)!.chunksReceived).toBe(1);
    });

    it('ACP server requests do NOT increment chunksReceived', () => {
      recordStreamingActivity(sessionId); // file op
      recordStreamingActivity(sessionId); // another file op
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(false);
      expect(streamingCallbacks.get(sessionId)!.chunksReceived).toBe(0);
    });

    it('permission requests do NOT increment chunksReceived', () => {
      recordStreamingActivity(sessionId); // permission
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(false);
      expect(streamingCallbacks.get(sessionId)!.chunksReceived).toBe(0);
    });

    it('regression: file-op-then-stall correctly errors out via normal timeout', () => {
      // Scenario: Agent does file operations (which set hasReceivedActivity=true)
      // but the stream genuinely stalls — no session/update chunks arrive.
      // The normal-timeout path should see chunksReceived=0 and reject (error),
      // NOT silently resolve as if the stream completed.
      recordStreamingActivity(sessionId); // fs/write_text_file
      recordStreamingActivity(sessionId); // fs/read_text_file

      // Post-interrupt would correctly see activity
      expect(checkPostInterruptActivity(sessionId)).toBe(true);

      // But normal-timeout should NOT see chunks — stream never started
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(false);
      // This means the normal-timeout path will reject() → error, which is correct.
      // Previously, chunksReceived was incremented by file ops too, causing a
      // silent resolve() that left the agent hung in 'responding' state.
    });

    it('mixed activity: only session/update counts for normal timeout', () => {
      recordStreamingActivity(sessionId); // file op (no chunk increment)
      recordStreamChunk(sessionId); // session/update (chunk increment)
      recordStreamingActivity(sessionId); // permission (no chunk increment)

      expect(streamingCallbacks.get(sessionId)!.chunksReceived).toBe(1);
      expect(checkNormalTimeoutHasChunks(sessionId)).toBe(true);
      expect(checkPostInterruptActivity(sessionId)).toBe(true);
    });
  });
});
