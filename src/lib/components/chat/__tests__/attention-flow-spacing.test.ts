import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  eventCardAssistantMarginClass,
  isAttentionQuestionAnswerSeam,
  isAttentionRequestEventNotification,
  isQuestionAnswerMessage,
} from '../attention-flow-spacing';

const message = (metadata: Record<string, unknown>): AgentMessage =>
  ({ id: 'message', role: 'user', contentBlocks: [], metadata }) as AgentMessage;

const attention = message({
  type: 'event_notification',
  events: [{ type: 'agent:attention-requested', data: { kind: 'discussion', reason: 'Choose' } }],
  queueInfo: { batchId: 'batch-1' },
});
const answer = message({
  type: 'question_answers',
  answeredQuestionsMessageId: 'questions-1',
  queueInfo: { batchId: 'batch-1' },
});

describe('attention flow spacing', () => {
  it('uses only structured attention and question-answer metadata', () => {
    expect(isAttentionRequestEventNotification(attention)).toBe(true);
    expect(isQuestionAnswerMessage(answer)).toBe(true);
    expect(
      isAttentionQuestionAnswerSeam(
        { userMessage: attention, assistantMessages: [] },
        { userMessage: answer, assistantMessages: [] },
      ),
    ).toBe(true);
    expect(eventCardAssistantMarginClass(attention, true)).toBe('mb-4');
  });

  it('keeps unrelated and malformed same-batch rows on their standard path', () => {
    const ordinaryEvent = message({
      type: 'event_notification',
      events: [{ type: 'agent:idle', data: { kind: 'discussion' } }],
      queueInfo: { batchId: 'batch-1' },
    });
    const malformedAnswer = message({
      type: 'question_answers',
      answeredQuestionsMessageId: '',
      queueInfo: { batchId: 'batch-1' },
    });
    expect(isAttentionRequestEventNotification(ordinaryEvent)).toBe(false);
    expect(isQuestionAnswerMessage(malformedAnswer)).toBe(false);
    expect(
      isAttentionQuestionAnswerSeam(
        { userMessage: ordinaryEvent, assistantMessages: [] },
        { userMessage: answer, assistantMessages: [] },
      ),
    ).toBe(false);
    expect(
      isAttentionQuestionAnswerSeam(
        { userMessage: attention, assistantMessages: [] },
        { userMessage: malformedAnswer, assistantMessages: [] },
      ),
    ).toBe(false);
    expect(eventCardAssistantMarginClass(ordinaryEvent, true)).toBe('mb-8');
    expect(eventCardAssistantMarginClass(attention, false)).toBe('');
  });
});
