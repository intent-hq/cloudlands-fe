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
import { combineReducers, legacy_createStore as createStore, type Store } from 'redux';
import { messageAccumulatorReducer } from '../../../../../store/main/slices/message-accumulator/message-accumulator-slice';

let testStore: Store;

vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: (action: any) => testStore?.dispatch(action),
  getMainState: () => testStore?.getState(),
  getMainStore: () => testStore,
  initMainStoreBridge: vi.fn(),
}));

import { ACPProviderStreaming, testStreamManager } from '../acp-provider-streaming';
import * as messageAccumulator from '../../../../../store/main/slices/message-accumulator/message-accumulator-api';

describe('ACP Provider Streaming Handler Lifecycle', () => {
  const agentId = 'lifecycle-test-agent';
  let streaming: ACPProviderStreaming;

  beforeEach(() => {
    testStore = createStore(combineReducers({ messageAccumulator: messageAccumulatorReducer }));
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

  // ── Scenario 3: blank/missing toolCallId does not produce poisoned tool_result
  //
  // The agent-20a9e410 bundle shows 5 tool_result blocks with tool_use_id: ""
  // referencing no prior tool_use. Those blocks were persisted and then replayed
  // to chat-stream, which rejects them with HTTP 400/invalidArgument. Prevent the
  // poisoned block at the source by never emitting a tool_result with a blank id.

  describe('blank toolCallId handling in tool_call_update', () => {
    it('drops a tool_call_update with blank toolCallId when no pending tool id is recoverable', async () => {
      const sessionId = 'ses_blank_tool';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: '',
          status: 'failed',
          rawOutput: { output: '' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(0);
    });

    it('drops a tool_call_update with whitespace-only toolCallId', async () => {
      const sessionId = 'ses_ws_tool';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: '   ',
          status: 'failed',
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(0);
    });

    it('falls back to lastPendingToolId when the update omits toolCallId', async () => {
      const sessionId = 'ses_fallback_tool';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      // Establish a pending tool via a tool_call event so lastPendingToolId is set
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_recoverable',
          title: 'Read file',
          name: 'read_file',
          kind: 'read',
          rawInput: { path: '/x' },
        } as any,
      });

      // Provider then sends a tool_call_update that accidentally drops toolCallId
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: '',
          status: 'completed',
          rawOutput: { output: 'contents' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_recoverable');
    });

    it('does not emit a tool_result with tool_use_id="" even when status is failed', async () => {
      // This is the exact shape seen in agent-20a9e410: failed update, empty id,
      // empty rawOutput, sometimes an error message. It must not reach the accumulator.
      const sessionId = 'ses_error_blank';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: '',
          status: 'failed',
          error: { message: 'something went wrong' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      for (const block of partial.contentBlocks) {
        if (block.type === 'tool_result') {
          const id = (block as any).tool_use_id;
          expect(typeof id === 'string' && id.trim().length > 0).toBe(true);
        }
      }
    });

    it('preserves a normal tool_call_update with a valid toolCallId', async () => {
      const sessionId = 'ses_normal_tool';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_good',
          status: 'completed',
          rawOutput: { output: 'ok' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_good');
    });
  });
});

