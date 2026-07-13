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

  it('hides empty cancelled assistant stubs', () => {
    expect(
      shouldShowStoppedIndicator({
        message: assistant({ contentBlocks: [{ type: 'text', text: '   ' }] }),
        isStreaming: false,
      }),
    ).toBe(false);
  });
});