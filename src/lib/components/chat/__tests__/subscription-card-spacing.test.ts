import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import {
  getSubscriptionCardSeam,
  hasVisibleTurnBody,
  isChatCardMessage,
  isSubscriptionCardMessage,
} from '../subscription-card-spacing';

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
    {},
    { queueInfo: { batchId: 'batch-1' } },
    { type: 'agent_message', fromAgentId: 'agent-1' },
    { type: 'event_notification' },
    { type: 'question_answers' },
  ])('uses filled-card spacing for user-role surfaces with metadata %j', (metadata) => {
    const card = message(metadata);
    expect(isChatCardMessage(card)).toBe(true);
    expect(getSubscriptionCardSeam(isChatCardMessage(message({})), isChatCardMessage(card))).toBe(
      'cards',
    );
    expect(
      getSubscriptionCardSeam(
        isChatCardMessage({ ...card, role: 'assistant' }),
        isChatCardMessage(card),
      ),
    ).toBe('content');
  });

  it('does not classify prose or notice rows as filled cards', () => {
    expect(isChatCardMessage(undefined)).toBe(false);
    for (const role of ['assistant', 'system'] as const) {
      expect(isChatCardMessage({ ...message({}), role })).toBe(false);
    }
  });

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

describe('visible turn body spacing', () => {
  const question: NonNullable<AgentMessage['contentBlocks']>[number] = {
    type: 'resource',
    resource: {
      uri: 'intent-question://spacing',
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: '{"attachmentId":"spacing"}',
    },
  };
  const assistant = (
    contentBlocks: AgentMessage['contentBlocks'],
    metadata: AgentMessage['metadata'] = {},
  ): AgentMessage => ({ ...message(metadata), role: 'assistant', contentBlocks });

  it.each([
    [],
    [assistant([])],
    [assistant([{ type: 'text', text: '  ' }])],
    [assistant([{ type: 'text', text: '<!-- suggested-prompts\nContinue\n-->' }])],
    [assistant([question])],
    [assistant([question, { type: 'text', text: ' ' }]), assistant([])],
  ])('keeps cards adjacent across non-rendering assistant rows %j', (...assistantMessages) => {
    const before = structuredClone(assistantMessages);
    expect(hasVisibleTurnBody({ assistantMessages })).toBe(false);
    expect(assistantMessages).toEqual(before);
  });

  it.each([
    [{ type: 'text', text: 'Visible answer' }],
    [{ type: 'tool_use', id: 'tool', name: 'view', input: {} }],
    [{ type: 'thinking', text: 'Reasoning' }],
    [question, { type: 'text', text: 'Visible answer' }],
    [
      {
        type: 'resource',
        resource: { uri: 'other://resource', mimeType: 'text/plain', text: 'Body' },
      },
    ],
  ] satisfies NonNullable<AgentMessage['contentBlocks']>[])(
    'preserves visible content %j',
    (...blocks) => {
      expect(hasVisibleTurnBody({ assistantMessages: [assistant(blocks)] })).toBe(true);
    },
  );

  it('preserves visible notices and pending/streaming/error status without message text', () => {
    expect(hasVisibleTurnBody({ assistantMessages: [], hasVisibleNotice: true })).toBe(true);
    expect(hasVisibleTurnBody({ assistantMessages: [], hasPendingStatus: true })).toBe(true);
    expect(hasVisibleTurnBody({ assistantMessages: [assistant([])], hasPendingStatus: true })).toBe(
      true,
    );
  });

  it('preserves stopped and finish notices, matching coordination suppression', () => {
    const assistantMessages = [
      assistant([question], { interrupted: true, stopReason: 'cancelled' }),
    ];
    expect(hasVisibleTurnBody({ assistantMessages })).toBe(true);
    expect(
      hasVisibleTurnBody({ assistantMessages, suppressCoordinationStoppedIndicator: true }),
    ).toBe(false);
    for (const finishReason of ['refusal', 'max_tokens', 'max_turn_requests']) {
      expect(hasVisibleTurnBody({ assistantMessages: [assistant([], { finishReason })] })).toBe(
        true,
      );
    }
  });
});
