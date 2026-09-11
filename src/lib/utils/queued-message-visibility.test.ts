import { describe, it, expect } from 'vitest';
import { isUserQueuedMessage, omitDrainedQueuedMessages } from './queued-message-visibility';
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

  it('shows the Q&A wizard answer message (type question_answers)', () => {
    // User-authored despite the tag: sent through the ordinary send path and
    // possibly auto-queued during the turn-startup race — must stay
    // editable/removable/sendable in the queue.
    expect(
      isUserQueuedMessage(
        makeMessage({ type: 'question_answers', answeredQuestionsMessageId: 'msg-q1' }),
      ),
    ).toBe(true);
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

  it('hides PR-monitor wakes (type pr_monitor_wake)', () => {
    expect(
      isUserQueuedMessage(
        makeMessage({
          type: 'pr_monitor_wake',
          monitorId: 'mon-1',
          repo: 'acme/widgets',
          prNumber: 7,
          reason: 'changed',
        }),
      ),
    ).toBe(false);
  });

  it('hides entries with an unknown string type', () => {
    expect(isUserQueuedMessage(makeMessage({ type: 'mystery_wake' }))).toBe(false);
  });

  it('keeps fail-open semantics for [WORKSPACE EVENTS] content without daemon metadata', () => {
    expect(
      isUserQueuedMessage(makeMessage(undefined, '[WORKSPACE EVENTS] You have been woken up')),
    ).toBe(true);
    expect(
      isUserQueuedMessage(
        makeMessage({ source: 'system' }, '[WORKSPACE EVENTS] You have been woken up'),
      ),
    ).toBe(false);
  });
});

describe('omitDrainedQueuedMessages', () => {
  const entry = (id: string): QueuedMessage => ({ ...makeMessage(), id });
  // Literal wire shape of a drained user row's metadata (PROTOCOL §5.5): the
  // daemon stamps `queueInfo.queuedMessageId` with the source entry's `id`.
  const drainedRow = (queuedMessageId: string, extra: Record<string, unknown> = {}) => ({
    metadata: {
      queueInfo: {
        queuedAt: '2026-08-04T00:00:00Z',
        waitedMs: 12000,
        queuedMessageId,
        ...extra,
      },
    },
  });

  it('omits the entry named by a transcript row stamp', () => {
    const queue = [entry('qm-1'), entry('qm-2')];
    expect(omitDrainedQueuedMessages(queue, [drainedRow('qm-1')]).map((m) => m.id)).toEqual([
      'qm-2',
    ]);
  });

  it('keeps every entry when rows carry no stamp or a foreign stamp', () => {
    const queue = [entry('qm-1'), entry('qm-2')];
    const legacyRow = {
      metadata: { queueInfo: { queuedAt: '2026-08-04T00:00:00Z', waitedMs: 1 } },
    };
    expect(omitDrainedQueuedMessages(queue, []).map((m) => m.id)).toEqual(['qm-1', 'qm-2']);
    expect(omitDrainedQueuedMessages(queue, [legacyRow, {}]).map((m) => m.id)).toEqual([
      'qm-1',
      'qm-2',
    ]);
    expect(omitDrainedQueuedMessages(queue, [drainedRow('qm-other')]).map((m) => m.id)).toEqual([
      'qm-1',
      'qm-2',
    ]);
  });

  it('hides only the corresponding entries for batch rows sharing a turnId', () => {
    const queue = [entry('qm-1'), entry('qm-2'), entry('qm-3')];
    const rows = [
      { turnId: 'turn-head', ...drainedRow('qm-1', { batchId: 'batch-a' }) },
      { turnId: 'turn-head', ...drainedRow('qm-3', { batchId: 'batch-a' }) },
    ];
    expect(omitDrainedQueuedMessages(queue, rows).map((m) => m.id)).toEqual(['qm-2']);
  });

  it('ignores malformed stamps', () => {
    const queue = [entry('qm-1')];
    const rows = [
      { metadata: { queueInfo: { queuedMessageId: '' } } },
      { metadata: { queueInfo: { queuedMessageId: 42 } } },
      { metadata: { queueInfo: 'soon' } },
      { metadata: null },
    ];
    expect(omitDrainedQueuedMessages(queue, rows).map((m) => m.id)).toEqual(['qm-1']);
  });

  it('never mutates the canonical queue array', () => {
    const queue = [entry('qm-1'), entry('qm-2')];
    const snapshot = queue.map((m) => ({ ...m }));
    const visible = omitDrainedQueuedMessages(queue, [drainedRow('qm-1')]);
    expect(visible).not.toBe(queue);
    expect(queue).toEqual(snapshot);
    expect(queue).toHaveLength(2);
  });
});
