/**
 * Pure helpers for chat message navigation (ChatPanel scroll-to-previous).
 * Kept dependency-light for unit testing.
 */

/** Minimal message shape needed to resolve navigation targets. */
export interface NavigableMessage {
  id: string;
  role: string;
}

/**
 * Resolve the id of the user message that precedes `currentMessageId`.
 * Returns null when the current message is the first user message or is not
 * found in the list (callers scroll to top in that case).
 */
export function resolvePreviousUserMessageId(
  messages: readonly NavigableMessage[],
  currentMessageId: string,
): string | null {
  const userMessages = messages.filter((m) => m.role === 'user');
  const currentIndex = userMessages.findIndex((m) => m.id === currentMessageId);
  if (currentIndex <= 0) return null;
  return userMessages[currentIndex - 1].id;
}
