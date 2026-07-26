/**
 * Pending Agent Q&A derivation (wire contract): questions on the LAST
 * assistant message with NO later user message are pending; ANY later user
 * message supersedes them; streaming/running turns never pend. Because the
 * derivation reads only the transcript, restored sessions re-surface
 * unanswered questions automatically — covered explicitly below.
 */
import { describe, expect, it } from 'vitest';
import { derivePendingQuestions } from '../pending-questions';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import type { AgentMessage, ContentBlock } from '$shared/types';

const QUESTION = {
  attachmentId: 'tar-abc123def456',
  header: 'Auth method',
  question: 'Which authentication method should the new endpoint use?',
  options: [
    { label: 'OAuth', description: 'Standard OAuth 2.0 flow' },
    { label: 'API key', description: 'Static key in header' },
  ],
  multiSelect: false,
};

function questionBlock(overrides: Partial<typeof QUESTION> = {}): ContentBlock {
  const q = { ...QUESTION, ...overrides };
  return {
    type: 'resource',
    resource: {
      uri: `intent-question://${q.attachmentId}`,
      name: q.header,
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify(q),
    },
  } as unknown as ContentBlock;
}

function assistantMessage(
  blocks: ContentBlock[],
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id: overrides.id ?? 'msg-assistant-1',
    role: 'assistant',
    contentBlocks: blocks,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function userMessage(id = 'msg-user-1'): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'a reply' }],
    timestamp: new Date().toISOString(),
  };
}

describe('derivePendingQuestions', () => {
  it('derives questions from the last assistant message', () => {
    const msg = assistantMessage([
      { type: 'text', text: 'Some context first.' },
      questionBlock(),
      questionBlock({ attachmentId: 'tar-bbb222ccc333', header: 'Scope' }),
    ]);
    const pending = derivePendingQuestions([msg], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-assistant-1');
    expect(pending!.questions.map((q) => q.header)).toEqual(['Auth method', 'Scope']);
  });

  it('returns null while the agent is running', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg], true)).toBeNull();
  });

  it('returns null while the last assistant message is streaming', () => {
    const msg = assistantMessage([questionBlock()], { isStreaming: true });
    expect(derivePendingQuestions([msg], false)).toBeNull();
  });

  it('returns null when ANY later user message supersedes the questions', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg, userMessage()], false)).toBeNull();
  });

  it('returns null when an optimistic pending user bubble is shown', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg], false, true)).toBeNull();
  });

  it('returns null when the last assistant message has no question blocks', () => {
    const msg = assistantMessage([{ type: 'text', text: 'No questions here.' }]);
    expect(derivePendingQuestions([msg], false)).toBeNull();
    expect(derivePendingQuestions([], false)).toBeNull();
  });

  it('ignores questions on earlier assistant messages', () => {
    const earlier = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const later = assistantMessage([{ type: 'text', text: 'Done.' }], { id: 'msg-a2' });
    expect(derivePendingQuestions([earlier, userMessage(), later], false)).toBeNull();
  });

  it('collapses duplicate resource blocks to one question', () => {
    const msg = assistantMessage([questionBlock(), questionBlock()]);
    const pending = derivePendingQuestions([msg], false);
    expect(pending!.questions).toHaveLength(1);
  });

  it('re-surfaces unanswered questions on session restore (transcript-only derivation)', () => {
    // A restored session replays the same transcript: user asked, assistant
    // answered with trailing question blocks, no later user message. The
    // derivation must pend again with no persisted state involved.
    const restored: AgentMessage[] = [
      userMessage('msg-u0'),
      assistantMessage([{ type: 'text', text: 'Before I proceed:' }, questionBlock()], {
        id: 'msg-a1',
      }),
    ];
    const pending = derivePendingQuestions(restored, false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
    expect(pending!.questions[0].header).toBe('Auth method');
  });
});
