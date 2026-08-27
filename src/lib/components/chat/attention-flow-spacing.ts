import type { AgentMessage } from '$shared/types';

type AttentionFlowMessage = Pick<AgentMessage, 'role' | 'metadata'>;

interface AttentionFlowTurn {
  userMessage: AttentionFlowMessage | null;
  assistantMessages: readonly unknown[];
}

export function isAttentionRequestEventNotification(
  message: AttentionFlowMessage | null | undefined,
): boolean {
  if (message?.role !== 'user' || message.metadata?.type !== 'event_notification') return false;
  const events = message.metadata.events;
  if (!Array.isArray(events)) return false;
  return events.some((event: unknown) => {
    if (!event || typeof event !== 'object') return false;
    const { type, data } = event as Record<string, unknown>;
    if (type !== 'agent:attention-requested' || !data || typeof data !== 'object') return false;
    const kind = (data as Record<string, unknown>).kind;
    return kind === 'discussion' || kind === 'blocker';
  });
}

export function isQuestionAnswerMessage(message: AttentionFlowMessage | null | undefined): boolean {
  if (message?.role !== 'user' || message.metadata?.type !== 'question_answers') return false;
  const answeredId = message.metadata.answeredQuestionsMessageId;
  return typeof answeredId === 'string' && answeredId.trim().length > 0;
}

export function isAttentionQuestionAnswerSeam(
  currentTurn: AttentionFlowTurn,
  nextTurn: AttentionFlowTurn | null | undefined,
): boolean {
  return (
    isAttentionRequestEventNotification(currentTurn.userMessage) &&
    isQuestionAnswerMessage(nextTurn?.userMessage)
  );
}

export function eventCardAssistantMarginClass(
  message: AttentionFlowMessage | null | undefined,
  hasAssistantMessages: boolean,
): string {
  if (!hasAssistantMessages) return '';
  return isAttentionRequestEventNotification(message) ? 'mb-4' : 'mb-8';
}
