/**
 * Regression tests for ACP provider streaming handler lifecycle.
 *
 * Covers two critical scenarios:
 * 1. Streaming handler survives error recovery — after handleError destroys the
 *    BackendStreamManager session/callbacks, a new startStreaming() call must
 *    succeed and stream chunks normally.
 * 2. Cancelled session IDs are tracked so stale events from a cancelled session
 *    are silently rejected, preventing interleaved text.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACPProviderStreaming, testStreamManager } from '../acp-provider-streaming';
import { messageAccumulator } from '../../../services/message-accumulator.service';

describe('ACP Provider Streaming Handler Lifecycle', () => {
  const agentId = 'lifecycle-test-agent';
  let streaming: ACPProviderStreaming;

  beforeEach(() => {
    streaming = new ACPProviderStreaming(agentId);
  });

  afterEach(() => {
    streaming.dispose();
    testStreamManager.cleanupAll();
    messageAccumulator.clearAll();
  });

  // ── Scenario 1: streaming survives error recovery ──────────────────────

  describe('streaming handler survives error recovery', () => {
    it('can start a new stream after handleError destroys the previous session', async () => {
      const sessionId1 = 'ses_first';
      const sessionId2 = 'ses_second';

      // --- First streaming session ---
      streaming.setInternalSessionId(sessionId1);
      const onChunk1 = vi.fn();
      const onError1 = vi.fn();
      const onComplete1 = vi.fn();

      streaming.startStreaming({
        workspaceId: 'ws-1',
        frontendSessionId: 'fe-1',
        onChunk: onChunk1,
        onError: onError1,
        onComplete: onComplete1,
      });

      // Send a chunk to prove first session works
      await streaming.handleSessionUpdate({
        sessionId: sessionId1,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      });
      expect(onChunk1).toHaveBeenCalledWith('hello');

      // --- Trigger error (this deletes sessions + callbacks in BackendStreamManager) ---
      await streaming.handleError(new Error('simulated crash'));
      expect(onError1).toHaveBeenCalledTimes(1);

      // --- Second streaming session (recovery) ---
      streaming.setInternalSessionId(sessionId2);
      const onChunk2 = vi.fn();
      const onError2 = vi.fn();
      const onComplete2 = vi.fn();

      // This MUST NOT throw — the handler must be reusable after error
      streaming.startStreaming({
        workspaceId: 'ws-1',
        frontendSessionId: 'fe-2',
        onChunk: onChunk2,
        onError: onError2,
        onComplete: onComplete2,
      });

      // Send a chunk on the new session — must reach the new callbacks
      await streaming.handleSessionUpdate({
        sessionId: sessionId2,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'recovered' } },
      });

      expect(onChunk2).toHaveBeenCalledWith('recovered');
      // Old callback must NOT receive the new chunk
      expect(onChunk1).toHaveBeenCalledTimes(1);

      // Complete the second session cleanly
      await streaming.handleSessionUpdate({
        sessionId: sessionId2,
        update: { sessionUpdate: 'done', stopReason: 'end_turn' },
      });
      expect(onComplete2).toHaveBeenCalledTimes(1);
      expect(onError2).not.toHaveBeenCalled();
    });

    it('handleError is idempotent when no session exists', async () => {
      // Calling handleError with no active session should not throw
      await streaming.handleError(new Error('no session'));
      // And we can still start streaming afterwards
      streaming.setInternalSessionId('ses_after_noop_error');
      const onChunk = vi.fn();
      streaming.startStreaming({
        workspaceId: 'ws-1',
        onChunk,
      });

      await streaming.handleSessionUpdate({
        sessionId: 'ses_after_noop_error',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'works' } },
      });
      expect(onChunk).toHaveBeenCalledWith('works');
    });
  });

  // ── Scenario 2: cancelled session IDs reject stale events ──────────────

  describe('cancelled session IDs reject stale events', () => {
    it('stale chunks from a cancelled session are silently dropped', async () => {
      const oldSessionId = 'ses_old';
      const newSessionId = 'ses_new';

      streaming.setInternalSessionId(oldSessionId);
      const onChunk = vi.fn();
      streaming.startStreaming({
        workspaceId: 'ws-1',
        onChunk,
      });

      // Mark old session as cancelled (simulates what ACPProvider does before createSession)
      streaming.markSessionCancelled(oldSessionId);
      // Update to new session
      streaming.setInternalSessionId(newSessionId);

      // Re-start streaming for the new session
      streaming.startStreaming({ workspaceId: 'ws-1', onChunk });

      // Stale chunk from old session — must be dropped
      await streaming.handleSessionUpdate({
        sessionId: oldSessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stale' } },
      });
      expect(onChunk).not.toHaveBeenCalled();

      // New chunk from new session — must be delivered
      await streaming.handleSessionUpdate({
        sessionId: newSessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fresh' } },
      });
      expect(onChunk).toHaveBeenCalledWith('fresh');
      expect(onChunk).toHaveBeenCalledTimes(1);
    });

    it('setInternalSessionId removes the new ID from cancelledSessionIds', () => {
      // Edge case: if a provider reuses session IDs, the new session must not
      // be blocked by a stale cancel entry.
      const reusedId = 'ses_reused';
      streaming.markSessionCancelled(reusedId);
      expect(streaming.isSessionCancelled(reusedId)).toBe(true);

      // Setting it as the active session should unblock it
      streaming.setInternalSessionId(reusedId);
      expect(streaming.isSessionCancelled(reusedId)).toBe(false);
    });

    it('cancelledSessionIds set is capped at 20 entries', () => {
      // Add 25 cancelled sessions — oldest should be evicted
      for (let i = 0; i < 25; i++) {
        streaming.markSessionCancelled(`ses_cap_${i}`);
      }
      // The first few should have been evicted
      expect(streaming.isSessionCancelled('ses_cap_0')).toBe(false);
      expect(streaming.isSessionCancelled('ses_cap_4')).toBe(false);
      // Recent ones should still be present
      expect(streaming.isSessionCancelled('ses_cap_24')).toBe(true);
      expect(streaming.isSessionCancelled('ses_cap_20')).toBe(true);
    });

    it('chunks from a mismatched (non-cancelled) session ID are also dropped', async () => {
      const activeSession = 'ses_active';
      streaming.setInternalSessionId(activeSession);
      const onChunk = vi.fn();
      streaming.startStreaming({ workspaceId: 'ws-1', onChunk });

      // A chunk with a completely different session ID (not cancelled, just different)
      await streaming.handleSessionUpdate({
        sessionId: 'ses_unknown_other',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wrong' } },
      });
      expect(onChunk).not.toHaveBeenCalled();
    });
  });
});

