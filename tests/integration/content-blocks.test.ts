import type { ContentBlock } from '$shared/types';
import {
  addChunk,
  addContentBlock,
  completeAccumulation,
  initialState,
  messageAccumulatorReducer,
  startAccumulation,
} from '$store/main/slices/message-accumulator/message-accumulator-slice';
import { describe, expect, it } from 'vitest';

const SESSION_ID = 'session-content-blocks';

describe('Content block handling', () => {
  it('keeps streamed text and daemon content blocks in arrival order', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'msg-1:1',
      toolCallId: 'call-1',
      name: 'search',
      input: { query: 'test' },
    } as ContentBlock;
    const toolResult = {
      type: 'tool_result',
      id: 'msg-1:2',
      tool_use_id: 'call-1',
      output: { count: 3 },
      is_error: false,
    } as ContentBlock;

    let state = messageAccumulatorReducer(initialState, startAccumulation(SESSION_ID));
    state = messageAccumulatorReducer(state, addChunk(SESSION_ID, 'Searching', 9));
    state = messageAccumulatorReducer(state, addContentBlock(SESSION_ID, toolUse));
    state = messageAccumulatorReducer(state, addContentBlock(SESSION_ID, toolResult));
    state = messageAccumulatorReducer(state, addChunk(SESSION_ID, 'Done', 4));
    state = messageAccumulatorReducer(state, completeAccumulation(SESSION_ID));

    expect(state.accumulators[SESSION_ID].contentBlocks).toEqual([
      { type: 'text', text: 'Searching' },
      toolUse,
      toolResult,
      { type: 'text', text: 'Done' },
    ]);
  });

  it('preserves complex tool input and structured error output', () => {
    const toolUse = {
      type: 'tool_use',
      id: 'msg-2:0',
      toolCallId: 'call-complex',
      name: 'analyze',
      input: { data: [1, 2, 3], options: { includeOutliers: false } },
    } as ContentBlock;
    const toolResult = {
      type: 'tool_result',
      id: 'msg-2:1',
      tool_use_id: 'call-complex',
      output: { message: 'analysis timed out', retryable: true },
      is_error: true,
    } as ContentBlock;

    let state = messageAccumulatorReducer(initialState, startAccumulation(SESSION_ID));
    state = messageAccumulatorReducer(state, addContentBlock(SESSION_ID, toolUse));
    state = messageAccumulatorReducer(state, addContentBlock(SESSION_ID, toolResult));

    expect(state.accumulators[SESSION_ID].contentBlocks).toEqual([toolUse, toolResult]);
  });
});
