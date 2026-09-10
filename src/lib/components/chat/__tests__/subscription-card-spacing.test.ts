import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { getSubscriptionCardSeam, isSubscriptionCardMessage } from '../subscription-card-spacing';

function message(metadata: Record<string, unknown>, text = 'Update'): AgentMessage {
  return {
    id: 'message',
    role: 'user',
    metadata,
    contentBlocks: [{ type: 'text', text }],
  } as AgentMessage;
}

describe('subscription card boundaries', () => {
  it.each([
    [true, true, 'cards'],
    [true, false, 'content'],
    [false, true, 'content'],
    [false, false, undefined],
  ] as const)('classifies card=%s to card=%s as %s', (previous, current, expected) => {
    expect(getSubscriptionCardSeam(previous, current)).toBe(expected);
  });

  it('recognizes the rendered agent, chief, and event cards', () => {
    for (const type of ['agent_message', 'chief_message']) {
      expect(isSubscriptionCardMessage(message({ type, fromAgentId: 'agent-1' }))).toBe(true);
      expect(isSubscriptionCardMessage(message({ type }))).toBe(false);
    }
    expect(isSubscriptionCardMessage(message({ type: 'event_notification' }))).toBe(true);
    expect(isSubscriptionCardMessage(message({}, '[WORKSPACE EVENTS]\nAn agent finished'))).toBe(
      true,
    );
  });

  it('leaves ordinary, queued, answered, and assistant messages on the non-card path', () => {
    expect(isSubscriptionCardMessage(undefined)).toBe(false);
    expect(isSubscriptionCardMessage(message({}))).toBe(false);
    expect(isSubscriptionCardMessage(message({ queueInfo: { batchId: 'batch-1' } }))).toBe(false);
    expect(isSubscriptionCardMessage(message({ type: 'question_answers' }))).toBe(false);
    expect(
      isSubscriptionCardMessage({ ...message({ type: 'event_notification' }), role: 'assistant' }),
    ).toBe(false);
  });

  it('recognizes hook and PR wake cards, including legacy text-only notifications', () => {
    expect(
      isSubscriptionCardMessage(
        message({ type: 'hook_wake', hookId: 'hook-1', hookName: 'build', reason: 'dispatched' }),
      ),
    ).toBe(true);
    expect(
      isSubscriptionCardMessage(
        message({
          type: 'pr_monitor_wake',
          monitorId: 'monitor-1',
          repo: 'intent-hq/intent',
          prNumber: 42,
          reason: 'checks_passed',
        }),
      ),
    ).toBe(true);
    expect(isSubscriptionCardMessage(message({}, '[Background hook "build"] Ready'))).toBe(true);
    expect(isSubscriptionCardMessage(message({}, '[PR monitor intent-hq/intent#42] Ready'))).toBe(
      true,
    );
  });
});
