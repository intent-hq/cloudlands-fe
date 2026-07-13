import type { AgentMessage, AgentSession } from '$shared/types';

export function isInFlightAssistantMessage(message: AgentMessage): boolean {
  return (
    message.role === 'assistant' &&
    (message.isStreaming === true || message.streamingComplete === false)
  );
}

export function findInFlightAssistantMessage(
  session: AgentSession | undefined,
  assistantAppMessageId?: string,
): AgentMessage | undefined {
  const messages = session?.messages || [];
  if (assistantAppMessageId) {
    return messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.appMessageId === assistantAppMessageId &&
        isInFlightAssistantMessage(message),
    );
  }
  return messages.find(isInFlightAssistantMessage);
}

export function hasFinalizedAssistantMessage(
  session: AgentSession | undefined,
  assistantAppMessageId?: string,
): boolean {
  if (!assistantAppMessageId) return false;
  return (session?.messages || []).some(
    (message) =>
      message.role === 'assistant' &&
      message.appMessageId === assistantAppMessageId &&
      !isInFlightAssistantMessage(message),
  );
}

export function isStaleFinalizedAssistantStream(
  session: AgentSession | undefined,
  assistantAppMessageId?: string,
): boolean {
  return (
    !findInFlightAssistantMessage(session, assistantAppMessageId) &&
    hasFinalizedAssistantMessage(session, assistantAppMessageId)
  );
}