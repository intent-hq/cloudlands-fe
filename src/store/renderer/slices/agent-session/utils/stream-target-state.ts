import type { AgentMessage, AgentSession } from '$shared/types';
import { hasCanonicalId } from '$shared/utils/message-dedup';

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

/**
 * Resolve the assistant message a stream payload should target. An exact
 * in-flight match on the canonical `assistantMessageId` wins; otherwise the
 * appMessageId / first-in-flight lookup applies — EXCEPT when the payload
 * carries only a canonical id and the fallback row is already bound to a
 * DIFFERENT canonical daemon id. That row is a stale leftover from an earlier
 * turn and must not absorb this payload's blocks (the caller creates a fresh
 * placeholder under `assistantMessageId` instead, keeping reconcile-by-id
 * dedupe intact).
 */
export function findStreamTargetAssistantMessage(
  session: AgentSession | undefined,
  assistantAppMessageId?: string,
  assistantMessageId?: string,
): AgentMessage | undefined {
  const messages = session?.messages || [];
  if (assistantMessageId) {
    const exact = messages.find(
      (message) => message.id === assistantMessageId && isInFlightAssistantMessage(message),
    );
    if (exact) return exact;
  }
  const fallback = findInFlightAssistantMessage(session, assistantAppMessageId);
  if (
    fallback &&
    !assistantAppMessageId &&
    assistantMessageId &&
    hasCanonicalId(fallback.id) &&
    fallback.id !== assistantMessageId
  ) {
    return undefined;
  }
  return fallback;
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