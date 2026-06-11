import {
  describe,
  expect,
  it,
} from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  computeMessageContentHash,
  deduplicateAgentMessages,
  hasNearDuplicateAssistantContent,
  insertAgentMessageWithDedup,
  mergeAgentSessionMessagesWithPolicy,
  replaceAgentMessageByIdWithDedup,
} from '../message-dedup';

function makeAssistant(
  id: string,
  text: string,
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2024-01-01T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
    ...overrides,
  };
}

describe('message-dedup utility', () => {
  it('removes exact duplicate ids', () => {
    const message = makeAssistant('msg_same', 'hello');
    expect(deduplicateAgentMessages([message, message])).toEqual([message]);
  });

  it('merges app-owned ids and keeps canonical backend identity', () => {
    const local = makeAssistant('local-id', 'draft', { appMessageId: 'app_msg_1' });
    const backend = makeAssistant('msg_backend', 'final', {
      appMessageId: 'app_msg_1',
      metadata: { model: 'test' },
    });

    expect(deduplicateAgentMessages([local, backend])).toMatchObject([
      { id: 'msg_backend', appMessageId: 'app_msg_1', metadata: { model: 'test' } },
    ]);
  });

  it('merges an optimistic user message into the canonical one without duplicating', () => {
    const optimistic: AgentMessage = {
      id: 'optimistic_abc',
      role: 'user',
      appMessageId: 'app_msg_user_1',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello there' }],
    };
    const canonical: AgentMessage = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      role: 'user',
      appMessageId: 'app_msg_user_1',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [
        { type: 'text', text: 'Hello there' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
      ],
      metadata: { contextReferences: [{ type: 'file', identifier: 'src/foo.ts' }] },
    };

    const merged = insertAgentMessageWithDedup([optimistic], canonical);
    expect(merged).toHaveLength(1);
    // Canonical contentBlocks (with attachments) and metadata win the merge
    expect(merged[0]).toMatchObject({
      role: 'user',
      appMessageId: 'app_msg_user_1',
      contentBlocks: canonical.contentBlocks,
      metadata: canonical.metadata,
    });
  });

  it('collapses the observed same-appMessageId assistant duplicate shape', () => {
    const appMessageId = 'app_msg_observed';
    const streaming = makeAssistant(
      '550e8400-e29b-41d4-a716-446655440001',
      'I inspected the file.',
      {
        appMessageId,
        isStreaming: true,
        contentBlocks: [
          { type: 'text', text: 'I inspected the file.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
        ],
      },
    );
    const backendFinal = makeAssistant('msg_backend_observed', 'I inspected the file.', {
      appMessageId,
      isStreaming: false,
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [
        { type: 'text', text: 'I inspected the file.' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
        { type: 'tool_result', tool_use_id: 'toolu_1', output: { content: 'file contents' } },
      ],
    });

    const deduped = deduplicateAgentMessages([streaming, backendFinal]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: 'msg_backend_observed',
      appMessageId,
      isStreaming: false,
    });
  });

  it('collapses a streaming placeholder into its finalized assistant message', () => {
    const streaming = makeAssistant('msg_stream', 'same final text', {
      appMessageId: 'app_msg_stream',
      isStreaming: true,
    });
    const final = makeAssistant('msg_final', 'same final text', {
      appMessageId: 'app_msg_final',
      isStreaming: false,
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(deduplicateAgentMessages([streaming, final])).toMatchObject([
      { id: 'msg_final', appMessageId: 'app_msg_final', isStreaming: false },
    ]);
  });

  it('preserves close-timestamp same-content assistant replies with different appMessageIds when turnNumber is missing', () => {
    const first = makeAssistant('msg_first_reply', 'Repeated answer', {
      appMessageId: 'app_msg_first_reply',
    });
    const second = makeAssistant('msg_second_reply', 'Repeated answer', {
      appMessageId: 'app_msg_second_reply',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(deduplicateAgentMessages([first, second])).toEqual([first, second]);
  });

  it('preserves close-timestamp same-content final assistant replies when exactly one has appMessageId and turnNumber is missing', () => {
    const first = makeAssistant('msg_first_reply', 'Repeated answer');
    const second = makeAssistant('msg_second_reply', 'Repeated answer', {
      appMessageId: 'app_msg_second_reply',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(deduplicateAgentMessages([first, second])).toEqual([first, second]);
  });

  it('collapses exactly-one-appMessageId final assistant replies when explicit turnNumber matches', () => {
    const first = makeAssistant('msg_first_reply', 'Repeated answer', { turnNumber: 7 });
    const second = makeAssistant('msg_second_reply', 'Repeated answer', {
      appMessageId: 'app_msg_second_reply',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 7,
    });

    expect(deduplicateAgentMessages([first, second])).toMatchObject([
      { id: 'msg_second_reply', appMessageId: 'app_msg_second_reply', turnNumber: 7 },
    ]);
  });

  it('preserves close-timestamp same-content canonical assistant replies when turnNumber is missing', () => {
    const first = makeAssistant('msg_first_reply', 'Repeated answer');
    const second = makeAssistant('msg_second_reply', 'Repeated answer', {
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(deduplicateAgentMessages([first, second])).toEqual([first, second]);
  });

  it('preserves near-duplicate assistant replies with different appMessageIds when turnNumber is missing', () => {
    const prefix = 'Shared assistant answer. '.repeat(20);
    const first = makeAssistant('msg_first_reply', `${prefix}first distinct ending`, {
      appMessageId: 'app_msg_first_reply',
    });
    const second = makeAssistant('msg_second_reply', `${prefix}second distinct ending`, {
      appMessageId: 'app_msg_second_reply',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(hasNearDuplicateAssistantContent(first, second)).toBe(false);
    expect(deduplicateAgentMessages([first, second])).toEqual([first, second]);
  });

  it('preserves near-duplicate final-final restore/backend messages with one appMessageId and missing turnNumber', () => {
    const prefix = 'Shared assistant reasoning. '.repeat(20);
    const restored = makeAssistant('msg_restored', `${prefix}temporary restored ending`);
    const backendFinal = makeAssistant('msg_backend_final', `${prefix}backend final ending`, {
      appMessageId: 'app_msg_backend_final',
      timestamp: '2024-01-01T00:00:04.000Z',
      metadata: { stopReason: 'end_turn' },
    });

    expect(hasNearDuplicateAssistantContent(restored, backendFinal)).toBe(false);
    expect(deduplicateAgentMessages([restored, backendFinal])).toEqual([restored, backendFinal]);
  });

  it('uses the same exactly-one-appMessageId near-duplicate policy for incremental insertion', () => {
    const prefix = 'Long common assistant answer. '.repeat(18);
    const existing = makeAssistant('msg_restored', `${prefix}renderer ending`);
    const incoming = makeAssistant('msg_backend_final', `${prefix}backend ending`, {
      appMessageId: 'app_msg_backend_final',
      timestamp: '2024-01-01T00:00:03.000Z',
    });

    expect(insertAgentMessageWithDedup([existing], incoming)).toEqual([existing, incoming]);
  });

  it('preserves near text across explicit different turns', () => {
    const prefix = 'Repeated answer body. '.repeat(20);
    const firstTurn = makeAssistant('msg_first', `${prefix}first`, { turnNumber: 1 });
    const secondTurn = makeAssistant('msg_second', `${prefix}second`, {
      appMessageId: 'app_msg_second',
      timestamp: '2024-01-01T00:00:03.000Z',
      turnNumber: 2,
    });

    expect(deduplicateAgentMessages([firstTurn, secondTurn])).toHaveLength(2);
  });

  it('preserves genuinely different assistant answers with early divergence', () => {
    const first = makeAssistant('msg_first', `First answer. ${'A'.repeat(250)}`);
    const second = makeAssistant('msg_second', `Second answer. ${'A'.repeat(250)}`, {
      appMessageId: 'app_msg_second',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(hasNearDuplicateAssistantContent(first, second)).toBe(false);
    expect(deduplicateAgentMessages([first, second])).toHaveLength(2);
  });

  it('keeps distinct tool_result content hashes when only legacy tool ids differ', () => {
    const first = makeAssistant('msg_first', '', {
      contentBlocks: [{ type: 'tool_result', toolCallId: 'tool-1', output: 'ok' }],
    });
    const second = makeAssistant('msg_second', '', {
      contentBlocks: [{ type: 'tool_result', toolCallId: 'tool-2', output: 'ok' }],
    });

    expect(computeMessageContentHash(first)).not.toBe(computeMessageContentHash(second));
  });

  it('deduplicates after replacing a local message with an existing canonical id', () => {
    const local = makeAssistant('local-id', 'same text');
    const canonical = makeAssistant('msg_backend', 'same text');
    const replacement = makeAssistant('msg_backend', 'same text', {
      metadata: { stopReason: 'end_turn' },
    });

    expect(
      replaceAgentMessageByIdWithDedup([local, canonical], 'local-id', replacement),
    ).toMatchObject([{ id: 'msg_backend', metadata: { stopReason: 'end_turn' } }]);
  });

  it('preserves late-diverging answers when the differing suffix exceeds ten percent', () => {
    const prefix = 'A'.repeat(180);
    const first = makeAssistant('msg_first', `${prefix}${'B'.repeat(60)}`);
    const second = makeAssistant('msg_second', `${prefix}${'C'.repeat(60)}`, {
      appMessageId: 'app_msg_second',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    expect(hasNearDuplicateAssistantContent(first, second)).toBe(false);
    expect(deduplicateAgentMessages([first, second])).toHaveLength(2);
  });

  it('rejects stale shorter session snapshots outside stream reducers', () => {
    const currentMessages = [makeAssistant('msg_user', 'prompt', { role: 'user' }), makeAssistant('msg_reply', 'complete')];

    const result = mergeAgentSessionMessagesWithPolicy({
      currentMessages,
      incomingMessages: [currentMessages[0]],
      currentIsStreaming: false,
      nextIsStreaming: false,
    });

    expect(result).toMatchObject({ accepted: false, reason: 'stale-fewer-messages' });
    expect(result.messages).toBe(currentMessages);
  });

  it('rejects same-length lower-content snapshots outside stream reducers', () => {
    const current = makeAssistant('msg_reply', 'complete assistant content');
    const stale = makeAssistant('msg_reply', 'short');

    const result = mergeAgentSessionMessagesWithPolicy({
      currentMessages: [current],
      incomingMessages: [stale],
      currentIsStreaming: false,
      nextIsStreaming: false,
    });

    expect(result).toMatchObject({ accepted: false, reason: 'stale-less-content' });
  });

  it('rejects active streaming content-block count regressions outside stream reducers', () => {
    const current = makeAssistant('msg_reply', 'Before', {
      isStreaming: true,
      contentBlocks: [
        { type: 'text', text: 'Before' },
        { type: 'tool_use', id: 'tool-1', name: 'search' },
      ],
    });
    const stale = makeAssistant('msg_reply', 'Before', {
      isStreaming: true,
      contentBlocks: [{ type: 'text', text: 'Before' }],
    });

    const result = mergeAgentSessionMessagesWithPolicy({
      currentMessages: [current],
      incomingMessages: [stale],
      currentIsStreaming: true,
      nextIsStreaming: true,
    });

    expect(result).toMatchObject({ accepted: false, reason: 'streaming-fewer-content-blocks' });
  });
});
