/**
 * Regression tests for ACP/OpenCode empty-completion handling.
 *
 * Verifies that the streaming layer faithfully passes through stopReason
 * metadata so the upper ACPProvider layer can distinguish:
 *   - cancelled empty completions (expected cleanup, no error)
 *   - non-cancelled empty completions (provider failure, should surface error)
 *
 * These tests exercise ACPProviderStreaming.handleComplete via the
 * 'done' / 'agent_message_complete' session update path.
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

vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: (action: any) => testStore?.dispatch(action),
  getMainState: () => testStore?.getState(),
  getMainStore: () => testStore,
  initMainStoreBridge: vi.fn(),
}));

import {
  ACPProviderStreaming,
  testStreamManager,
} from '../acp-provider-streaming';
import * as messageAccumulator from '../../../../../store/main/slices/message-accumulator/message-accumulator-api';

describe('ACP Empty Completion Handling', () => {
  let streaming: ACPProviderStreaming;
  const agentId = 'test-empty-agent';
  const sessionId = 'test-empty-session';
  const frontendSessionId = 'frontend-empty-session';

  beforeEach(() => {
    testStore = createStore(combineReducers({ messageAccumulator: messageAccumulatorReducer }));
    streaming = new ACPProviderStreaming(agentId);
    streaming.setInternalSessionId(sessionId);
  });

  afterEach(() => {
    streaming.dispose();
    testStreamManager.cleanupAll();
    messageAccumulator.clearAll();
  });

  it('cancelled empty stream completes with empty content and no error', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();

    streaming.startStreaming({
      frontendSessionId,
      onComplete,
      onError,
    });

    // Stream completes immediately with 'cancelled' — no chunks were sent
    await streaming.handleSessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'done',
        stopReason: 'cancelled',
      },
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const msg = onComplete.mock.calls[0][0];
    expect(msg.content).toBe('');
    expect(msg.contentBlocks).toEqual([]);
    expect(msg.metadata.stopReason).toBe('cancelled');
    expect(msg.role).toBe('assistant');

    // Cancelled is expected cleanup — onError must NOT fire
    expect(onError).not.toHaveBeenCalled();
  });

  it('end_turn empty stream completes with empty content and end_turn metadata', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();

    streaming.startStreaming({
      frontendSessionId,
      onComplete,
      onError,
    });

    // Stream completes with 'end_turn' but no content was streamed.
    // At the streaming layer this still calls onComplete — the upper
    // ACPProvider.handleStreamCompletion is responsible for detecting
    // empty + non-cancelled and surfacing a provider error.
    await streaming.handleSessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'done',
        stopReason: 'end_turn',
      },
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const msg = onComplete.mock.calls[0][0];
    expect(msg.content).toBe('');
    expect(msg.contentBlocks).toEqual([]);
    expect(msg.metadata.stopReason).toBe('end_turn');
  });

  it('preserves stopReason for all provider-failure stop reasons', async () => {
    // The streaming layer must faithfully pass through every stopReason
    // so handleStreamCompletion can classify cancelled vs error.
    const failureReasons = ['process_died', 'process_null', 'provider_stopped', 'workspace_deleted'];

    for (const stopReason of failureReasons) {
      const onComplete = vi.fn();
      const local = new ACPProviderStreaming(`agent-${stopReason}`);
      local.setInternalSessionId(`session-${stopReason}`);

      local.startStreaming({
        frontendSessionId: `fe-${stopReason}`,
        onComplete,
      });

      await local.handleSessionUpdate({
        sessionId: `session-${stopReason}`,
        update: { sessionUpdate: 'done', stopReason },
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0].metadata.stopReason).toBe(stopReason);
      expect(onComplete.mock.calls[0][0].content).toBe('');

      local.dispose();
    }
  });

  it('normal stream with content completes successfully (sanity baseline)', async () => {
    const onComplete = vi.fn();

    streaming.startStreaming({
      frontendSessionId,
      onComplete,
    });

    // Send a text chunk, then complete
    await streaming.handleSessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello from OpenCode' },
      },
    });

    await streaming.handleSessionUpdate({
      sessionId,
      update: { sessionUpdate: 'done', stopReason: 'end_turn' },
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const msg = onComplete.mock.calls[0][0];
    expect(msg.content).toBe('Hello from OpenCode');
    expect(msg.metadata.stopReason).toBe('end_turn');
  });
});

