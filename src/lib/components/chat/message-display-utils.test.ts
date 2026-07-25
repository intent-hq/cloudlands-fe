import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { shouldShowStoppedIndicator } from './message-display-utils';

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