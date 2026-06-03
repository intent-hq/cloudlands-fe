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

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  combineReducers,
  legacy_createStore as createStore,
  type Store,
} from 'redux';
import { messageAccumulatorReducer } from '../../../../../store/main/slices/message-accumulator/message-accumulator-slice';

let testStore: Store;

const getTestBridgeStore = () => ({
  get state() {
    return testStore?.getState();
  },
  dispatch: (action: any) => testStore?.dispatch(action),
});

const fileEditMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  sendToWorkspaceWindows: vi.fn(),
  recordAgentWrite: vi.fn(),
}));

vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: (action: any) => getTestBridgeStore().dispatch(action),
  getMainState: () => getTestBridgeStore().state,
  getMainStore: () => getTestBridgeStore(),
  initMainStoreBridge: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: fileEditMocks.readFile,
  },
  readFile: fileEditMocks.readFile,
}));

vi.mock('../../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: fileEditMocks.sendToWorkspaceWindows,
}));

vi.mock('../../../../workspace/main/provenance/attribution-engine', () => ({
  getAttributionEngine: () => ({
    recordAgentWrite: fileEditMocks.recordAgentWrite,
  }),
}));

import {
  ACPProviderStreaming,
  testStreamManager,
} from '../acp-provider-streaming';
import * as messageAccumulator from '../../../../../store/main/slices/message-accumulator/message-accumulator-api';

describe('ACP Provider Streaming Handler Lifecycle', () => {
  const agentId = 'lifecycle-test-agent';
  let streaming: ACPProviderStreaming;

  beforeEach(() => {
    vi.clearAllMocks();
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
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'recovered' },
        },
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

  describe('file content changed emitter contract', () => {
    it('emits static file:content-changed payload when a file edit tool completes', async () => {
      const sessionId = 'ses_file_content_emit';
      const workspaceId = 'ws-1';
      const workspacePath = '/repo';
      const relativePath = 'src/app.ts';
      const fullPath = '/repo/src/app.ts';

      fileEditMocks.readFile
        .mockResolvedValueOnce('old content')
        .mockResolvedValueOnce('new content');

      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId, workspacePath });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_save_file',
          title: 'Save src/app.ts',
          name: 'save-file',
          kind: 'edit',
          rawInput: { path: relativePath, file_content: 'new content' },
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_save_file',
          status: 'completed',
          rawOutput: { output: 'ok' },
        } as any,
      });

      expect(fileEditMocks.readFile).toHaveBeenNthCalledWith(1, fullPath, 'utf-8');
      expect(fileEditMocks.readFile).toHaveBeenNthCalledWith(2, fullPath, 'utf-8');
      expect(fileEditMocks.sendToWorkspaceWindows).toHaveBeenCalledWith(
        workspaceId,
        'file:content-changed',
        {
          workspaceId,
          path: fullPath,
          relativePath,
          content: 'new content',
          source: 'agent',
        },
      );
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

    it('emits content-array tool_call_update results using the top-level toolCallId', async () => {
      const sessionId = 'ses_v031_content_array_id';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_real',
          status: 'completed',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ],
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_real');
      expect((toolResults[0] as any).content).toBe('hello world');
    });

    it('recovers content-array tool_call_update results from lastPendingToolId when toolCallId is missing', async () => {
      const sessionId = 'ses_v031_content_array_fallback';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_recoverable_array',
          title: 'Read file',
          name: 'read_file',
          kind: 'read',
          rawInput: { path: '/tmp/example.txt' },
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          content: [
            { type: 'text', text: 'file ' },
            { type: 'text', text: 'contents' },
          ],
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_recoverable_array');
      expect((toolResults[0] as any).content).toBe('file contents');
    });

    it('emits rawOutput-only tool_call_update results using rawOutput.output', async () => {
      const sessionId = 'ses_v031_raw_output';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_raw_output',
          status: 'completed',
          rawOutput: { output: 'raw tool output' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_raw_output');
      expect((toolResults[0] as any).content).toBe('raw tool output');
    });

    it('preserves legacy plain-object content tool_call_update results', async () => {
      const sessionId = 'ses_v031_legacy_content';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          content: { result: 'ok', toolCallId: 'tc_legacy' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).tool_use_id).toBe('tc_legacy');
      expect((toolResults[0] as any).content).toBe('ok');
    });

    it('correlates reverse-order multi-tool updates by each top-level toolCallId', async () => {
      const sessionId = 'ses_v031_multi_tool_correlation';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_first',
          title: 'First tool',
          name: 'first_tool',
          kind: 'read',
          rawInput: { path: '/tmp/first.txt' },
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_second',
          title: 'Second tool',
          name: 'second_tool',
          kind: 'read',
          rawInput: { path: '/tmp/second.txt' },
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_second',
          status: 'completed',
          rawOutput: { output: 'second result' },
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_first',
          status: 'completed',
          rawOutput: { output: 'first result' },
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolUses = partial.contentBlocks.filter((b) => b.type === 'tool_use');
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');
      const nonEmptyToolResults = toolResults.filter((b) => (b as any).content);

      expect(toolUses.map((b) => (b as any).id)).toEqual(['tc_first', 'tc_second']);
      expect(nonEmptyToolResults).toHaveLength(2);
      expect(nonEmptyToolResults.map((b) => (b as any).tool_use_id)).toEqual([
        'tc_second',
        'tc_first',
      ]);
      expect(nonEmptyToolResults.map((b) => (b as any).content)).toEqual([
        'second result',
        'first result',
      ]);
      for (const result of nonEmptyToolResults) {
        expect(
          toolUses.some((toolUse) => (toolUse as any).id === (result as any).tool_use_id),
        ).toBe(true);
      }
    });

    it('correlates reverse-order Task tool content-array updates by top-level id', async () => {
      vi.useFakeTimers();
      const sessionId = 'ses_v031_task_tool_correlation';
      streaming.setInternalSessionId(sessionId);
      streaming.startStreaming({ workspaceId: 'ws-1' });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'A',
          title: 'Task',
          name: 'Task',
          kind: 'execute',
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'B',
          title: 'Task',
          name: 'Task',
          kind: 'execute',
        } as any,
      });

      await vi.advanceTimersByTimeAsync(300);
      vi.useRealTimers();

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'B',
          status: 'completed',
          content: [{ type: 'text', text: 'subagent B done' }],
        } as any,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'A',
          status: 'completed',
          content: [{ type: 'text', text: 'subagent A done' }],
        } as any,
      });

      const partial = messageAccumulator.getPartialContent(agentId);
      const toolUses = partial.contentBlocks.filter((b) => b.type === 'tool_use');
      const toolResults = partial.contentBlocks.filter((b) => b.type === 'tool_result');

      expect(toolUses.map((b) => (b as any).id)).toEqual(['A', 'B']);
      expect(toolUses.map((b) => (b as any).name)).toEqual(['Task', 'Task']);
      expect(toolResults).toHaveLength(2);
      expect(toolResults.map((b) => (b as any).tool_use_id)).toEqual(['B', 'A']);
      expect(toolResults.map((b) => (b as any).content)).toEqual([
        'subagent B done',
        'subagent A done',
      ]);
      for (const result of toolResults) {
        expect(
          toolUses.some((toolUse) => (toolUse as any).id === (result as any).tool_use_id),
        ).toBe(true);
      }
    });
  });
});
