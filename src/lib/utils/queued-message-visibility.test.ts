import { describe, it, expect } from 'vitest';
import { isUserQueuedMessage } from './queued-message-visibility';
import type { QueuedMessage } from '$shared/types';

function makeMessage(messageMetadata?: unknown): QueuedMessage {
  return {
    id: 'qm-1',
    content: 'hello',
    queuedAt: '2026-08-04T00:00:00Z',
    position: 0,
    ...(messageMetadata !== undefined
      ? { messageMetadata: messageMetadata as QueuedMessage['messageMetadata'] }
      : {}),
  };
}

describe('isUserQueuedMessage', () => {
  it('shows a plain user entry without metadata', () => {
    expect(isUserQueuedMessage(makeMessage())).toBe(true);
  });

  it('hides agent-to-agent messages (type agent_message)', () => {
    expect(
      isUserQueuedMessage(
        makeMessage({ type: 'agent_message', fromAgentId: 'agent-1', fromAgentName: 'Auggie' }),
      ),
    ).toBe(false);
  });

  it('hides event-notification wakes (type event_notification)', () => {
    expect(
      isUserQueuedMessage(makeMessage({ type: 'event_notification', eventTypes: ['file:*'] })),
    ).toBe(false);
  });

  it('hides background-hook wakes (type hook_wake)', () => {
    expect(
      isUserQueuedMessage(makeMessage({ type: 'hook_wake', hookId: 'h-1', hookName: 'ci-watch' })),
    ).toBe(false);
  });

  it('hides system-origin entries (source system)', () => {
    expect(isUserQueuedMessage(makeMessage({ source: 'system' }))).toBe(false);
  });

  it('hides entries with a daemon-stamped fromAgentId and no type', () => {
    expect(isUserQueuedMessage(makeMessage({ fromAgentId: 'agent-2' }))).toBe(false);
  });

  it('shows entries whose metadata carries only benign fields (userAppMessageId)', () => {
    expect(isUserQueuedMessage(makeMessage({ userAppMessageId: 'app-msg-1' }))).toBe(true);
  });

  it('shows entries whose metadata carries only queueInfo', () => {
    expect(
      isUserQueuedMessage(
        makeMessage({ queueInfo: { queuedAt: '2026-08-04T00:00:00Z', waitedMs: 1200 } }),
      ),
    ).toBe(true);
  });

  it('shows entries with malformed metadata (fail open)', () => {
    expect(isUserQueuedMessage(makeMessage('not-an-object'))).toBe(true);
    expect(isUserQueuedMessage(makeMessage(42))).toBe(true);
    expect(isUserQueuedMessage(makeMessage(null))).toBe(true);
    expect(isUserQueuedMessage(makeMessage({ type: 7 }))).toBe(true);
    expect(isUserQueuedMessage(makeMessage({ fromAgentId: '   ' }))).toBe(true);
    expect(isUserQueuedMessage(makeMessage({ source: 'user' }))).toBe(true);
  });
});
