import { describe, expect, it } from 'vitest';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { isQuestionOnlyContent, shouldShowStoppedIndicator } from './message-display-utils';

function assistant(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    timestamp: '2026-06-22T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text: 'Partial answer' }],
    metadata: { interrupted: true, stopReason: 'cancelled' },
    ...overrides,
  };
}

describe('message display utils', () => {
  it('keeps stopped visible for user-visible interrupted assistant content', () => {
    expect(shouldShowStoppedIndicator({ message: assistant(), isStreaming: false })).toBe(true);
  });

  it('hides stopped for interrupted automated coordination turns', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant(),
        isStreaming: false,
        suppressCoordinationStoppedIndicator: true,
      }),
    ).toBe(false);
  });

  // The old content-based suppression hid the indicator for interrupted
  // messages with no visible assistant content. That hid legitimate stops
  // (thinking-only turns, pre-first-token stops), so an interrupted message now
  // shows the indicator regardless of content.
  it('shows stopped for interrupted messages with only whitespace text', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({ contentBlocks: [{ type: 'text', text: '   ' }] }),
        isStreaming: false,
      }),
    ).toBe(true);
  });

  it('shows stopped for interrupted thinking-only messages', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({
          contentBlocks: [{ type: 'thinking', thinking: 'planning…' }],
          metadata: { interrupted: true, stopReason: 'interrupted' },
        }),
        isStreaming: false,
      }),
    ).toBe(true);
  });

  it('shows stopped for interrupted messages with zero content blocks', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({
          contentBlocks: [],
          metadata: { interrupted: true, stopReason: 'interrupted' },
        }),
        isStreaming: false,
      }),
    ).toBe(true);
  });

  it('still suppresses coordination stops even with no visible content', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({
          contentBlocks: [],
          metadata: { interrupted: true, stopReason: 'interrupted' },
        }),
        isStreaming: false,
        suppressCoordinationStoppedIndicator: true,
      }),
    ).toBe(false);
  });

  it('hides stopped while the message is still streaming', () => {
    expect(shouldShowStoppedIndicator({ message: assistant(), isStreaming: true })).toBe(false);
  });

  it('hides stopped for non-interrupted messages', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({ metadata: {} }),
        isStreaming: false,
      }),
    ).toBe(false);
  });
});

// Agent Q&A wizard-only rendering: a turn whose only content is question
// blocks renders NO transcript bubble (ChatMessage suppresses the whole
// assistant row via this predicate).
describe('isQuestionOnlyContent', () => {
  const question = (text = '{"attachmentId":"tar-aaa111bbb222"}'): ContentBlock =>
    ({
      type: 'resource',
      resource: {
        uri: 'intent-question://tar-aaa111bbb222',
        mimeType: QUESTION_RESOURCE_MIME_TYPE,
        text,
      },
    }) as unknown as ContentBlock;

  it('true for a single question block', () => {
    expect(isQuestionOnlyContent([question()])).toBe(true);
  });

  it('true for multiple question blocks plus empty/whitespace text', () => {
    expect(
      isQuestionOnlyContent([
        { type: 'text', text: '   ' } as ContentBlock,
        question(),
        question('{"attachmentId":"tar-ccc333ddd444"}'),
      ]),
    ).toBe(true);
  });

  it('true when the only text is a suggested-prompts payload (renders nothing itself)', () => {
    expect(
      isQuestionOnlyContent([
        {
          type: 'text',
          text: '<!-- suggested-prompts\nRun the tests\n-->',
        } as ContentBlock,
        question(),
      ]),
    ).toBe(true);
  });

  it('false when visible text accompanies the question', () => {
    expect(
      isQuestionOnlyContent([{ type: 'text', text: 'Some answer' } as ContentBlock, question()]),
    ).toBe(false);
  });

  it('false when a non-question resource block (e.g. proposal) is present', () => {
    expect(
      isQuestionOnlyContent([
        question(),
        {
          type: 'resource',
          resource: {
            uri: 'intent-proposal://x',
            mimeType: 'application/vnd.intent.proposal+json',
            text: '{}',
          },
        } as unknown as ContentBlock,
      ]),
    ).toBe(false);
  });

  it('false for empty content and for content with no question blocks', () => {
    expect(isQuestionOnlyContent([])).toBe(false);
    expect(isQuestionOnlyContent([{ type: 'text', text: 'hello' } as ContentBlock])).toBe(false);
  });
});