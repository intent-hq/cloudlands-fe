import { describe, it, expect } from 'vitest';
import { isUserQueuedMessage, isVisibleQueuedMessage } from './queued-message-visibility';
import type { QueuedMessage } from '$shared/types';

function makeMessage(messageMetadata?: unknown, content = 'hello'): QueuedMessage {
  return {
    id: 'qm-1',
    content,
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

  it('hides undelivered dismissal notifications (type questions_dismissed)', () => {
    // Full PROTOCOL shape delivered by agent.dismissQuestions.
    expect(
      isUserQueuedMessage(
        makeMessage({
          type: 'questions_dismissed',
          source: 'system',
          dismissedQuestionsMessageId: 'msg-q1',
        }),
      ),
    ).toBe(false);
    // Explicit type rule holds even without the source tag.
    expect(isUserQueuedMessage(makeMessage({ type: 'questions_dismissed' }))).toBe(false);
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

// Canonical queue-rendering table: visible iff user-authored or the entry has
// a renderable attribution row; every other daemon-origin entry is hidden.
describe('isVisibleQueuedMessage', () => {
  it('shows a user-typed entry without metadata', () => {
    expect(isVisibleQueuedMessage(makeMessage())).toBe(true);
  });

  it('shows entries whose metadata carries only benign fields', () => {
    expect(isVisibleQueuedMessage(makeMessage({ userAppMessageId: 'app-msg-1' }))).toBe(true);
    expect(
      isVisibleQueuedMessage(
        makeMessage({ queueInfo: { queuedAt: '2026-08-04T00:00:00Z', waitedMs: 1200 } }),
      ),
    ).toBe(true);
  });

  it('shows entries with malformed metadata (fail open)', () => {
    expect(isVisibleQueuedMessage(makeMessage('not-an-object'))).toBe(true);
    expect(isVisibleQueuedMessage(makeMessage({ type: 7 }))).toBe(true);
  });

  it('shows agent-to-agent messages with a usable attribution', () => {
    expect(
      isVisibleQueuedMessage(
        makeMessage({ type: 'agent_message', fromAgentId: 'agent-1', fromAgentName: 'Auggie' }),
      ),
    ).toBe(true);
  });

  it('hides agent_message entries whose attribution is unusable', () => {
    expect(isVisibleQueuedMessage(makeMessage({ type: 'agent_message', fromAgentId: 42 }))).toBe(
      false,
    );
  });

  it('shows event-notification wakes (metadata type)', () => {
    expect(
      isVisibleQueuedMessage(makeMessage({ type: 'event_notification', eventTypes: ['file:*'] })),
    ).toBe(true);
  });

  it('shows event wakes via the [WORKSPACE EVENTS] content-prefix fallback', () => {
    expect(
      isVisibleQueuedMessage(
        makeMessage({ source: 'system' }, '[WORKSPACE EVENTS] You have been woken up'),
      ),
    ).toBe(true);
  });

  it('shows background-hook wakes (type hook_wake)', () => {
    expect(
      isVisibleQueuedMessage(
        makeMessage({ type: 'hook_wake', hookId: 'h-1', hookName: 'ci-watch' }),
      ),
    ).toBe(true);
  });

  it('shows PR-monitor wakes with a usable attribution', () => {
    expect(
      isVisibleQueuedMessage(
        makeMessage({
          type: 'pr_monitor_wake',
          monitorId: 'mon-1',
          repo: 'acme/widgets',
          prNumber: 7,
          reason: 'changed',
        }),
      ),
    ).toBe(true);
  });

  it('hides pr_monitor_wake entries whose attribution is unusable', () => {
    expect(isVisibleQueuedMessage(makeMessage({ type: 'pr_monitor_wake', prNumber: 7 }))).toBe(
      false,
    );
    expect(
      isVisibleQueuedMessage(makeMessage({ type: 'pr_monitor_wake', repo: 'acme/widgets' })),
    ).toBe(false);
  });

  it('hides dismissal notifications (type questions_dismissed)', () => {
    expect(
      isVisibleQueuedMessage(
        makeMessage({
          type: 'questions_dismissed',
          source: 'system',
          dismissedQuestionsMessageId: 'msg-q1',
        }),
      ),
    ).toBe(false);
  });

  it('hides system-origin entries (source system)', () => {
    expect(isVisibleQueuedMessage(makeMessage({ source: 'system' }))).toBe(false);
  });

  it('hides entries with an unknown string type', () => {
    expect(isVisibleQueuedMessage(makeMessage({ type: 'mystery_wake' }))).toBe(false);
  });

  it('hides entries with a daemon-stamped fromAgentId and no renderable attribution', () => {
    expect(isVisibleQueuedMessage(makeMessage({ fromAgentId: 'agent-2' }))).toBe(false);
  });
});
