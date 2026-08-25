import type { AgentMessage } from '$shared/types';
import {
  deduplicateAgentMessages,
  insertAgentMessageWithDedup,
  replaceAgentMessageByIdWithDedup,
} from '$shared/utils/message-dedup';
import { describe, expect, it } from 'vitest';

function message(id: string, text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2026-08-25T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
    ...overrides,
  };
}

describe('Message duplication prevention', () => {
  it('collapses a streaming placeholder into its finalized daemon message', () => {
    const streaming = message('local-stream', 'Final response', {
      appMessageId: 'app-message-1',
      isStreaming: true,
    });
    const final = message('msg-daemon-final', 'Final response', {
      appMessageId: 'app-message-1',
      isStreaming: false,
      metadata: { model: 'test-model' },
    });

    expect(deduplicateAgentMessages([streaming, final])).toMatchObject([
      { id: 'msg-daemon-final', isStreaming: false, metadata: { model: 'test-model' } },
    ]);
  });

  it('updates an existing streamed message without adding a second row', () => {
    const current = [message('msg-1', 'Hello', { isStreaming: true })];
    const updated = message('msg-1', 'Hello world', { isStreaming: false });
    const result = replaceAgentMessageByIdWithDedup(current, 'msg-1', updated);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'msg-1', isStreaming: false });
    expect(result[0].contentBlocks).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('keeps distinct user sends even when their text is the same', () => {
    const first = message('user-msg-1', 'Yes', { role: 'user', appMessageId: 'app-user-1' });
    const second = message('user-msg-2', 'Yes', { role: 'user', appMessageId: 'app-user-2' });

    expect(insertAgentMessageWithDedup([first], second)).toEqual([first, second]);
  });
});
