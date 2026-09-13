/**
 * @vitest-environment jsdom
 *
 * Regression test for live thinking-block streaming (monorepo reasoning-dropdown task).
 * The daemon emits incremental `thinking` deltas with `blockType: "thinking"` on
 * `chat:stream:delta`, and the FE's `ChatTranscriptReconciler` must accumulate them
 * exactly like text chunks — updated deltas carrying the full reasoning so far.
 */
import { describe, it, expect } from 'vitest';
import { ChatTranscriptReconciler } from '../live-chat-client';

describe('ChatTranscriptReconciler — thinking blocks', () => {
  it('accumulates incremental thinking deltas into one growing block', () => {
    const reconciler = new ChatTranscriptReconciler();

    // Snapshot: empty transcript
    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });

    // Delta 1: first thinking chunk (added)
    reconciler.applyDelta(1, {
      added: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Let me ' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    let transcript = reconciler.transcript();
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0].contentBlocks).toHaveLength(1);
    expect(transcript.messages[0].contentBlocks![0]).toMatchObject({
      type: 'thinking',
      id: 'msg-1:0',
      text: 'Let me ',
    });

    // Delta 2: second thinking chunk (updated — full text so far)
    reconciler.applyDelta(2, {
      added: [],
      updated: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Let me think.' },
        },
      ],
      removedIds: [],
    });

    transcript = reconciler.transcript();
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0].contentBlocks).toHaveLength(1);
    expect(transcript.messages[0].contentBlocks![0]).toMatchObject({
      type: 'thinking',
      id: 'msg-1:0',
      text: 'Let me think.',
    });

    // Delta 3: assistant text starts (separate block)
    reconciler.applyDelta(3, {
      added: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'text', id: 'msg-1:1', text: 'The answer is 42.' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    transcript = reconciler.transcript();
    expect(transcript.messages[0].contentBlocks).toHaveLength(2);
    expect(transcript.messages[0].contentBlocks![0].type).toBe('thinking');
    expect(transcript.messages[0].contentBlocks![0].text).toBe('Let me think.');
    expect(transcript.messages[0].contentBlocks![1].type).toBe('text');
    expect(transcript.messages[0].contentBlocks![1].text).toBe('The answer is 42.');
  });

  it('seeds thinking blocks from a mid-turn snapshot and resumes accumulation', () => {
    const reconciler = new ChatTranscriptReconciler();

    // Mid-turn snapshot: assistant already has partial thinking
    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          timestamp: '2026-06-27T01:00:00.500Z',
          isStreaming: true,
          contentBlocks: [{ type: 'thinking', id: 'msg-1:0', text: 'Let me ' }],
        },
      ],
      truncated: false,
      totalMessages: 1,
    });

    let transcript = reconciler.transcript();
    expect(transcript.messages[0].contentBlocks![0].text).toBe('Let me ');

    // Delta: next thinking chunk (updated with full text)
    reconciler.applyDelta(1, {
      added: [],
      updated: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Let me think.' },
        },
      ],
      removedIds: [],
    });

    transcript = reconciler.transcript();
    expect(transcript.messages[0].contentBlocks![0].text).toBe('Let me think.');
  });
});
