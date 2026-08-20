import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';

/**
 * Pending Agent Q&A questions for the composer-slot wizard. The daemon's
 * three-state pending marker is authoritative when present: an empty string
 * clears the slot, while a message id permits only that question-bearing row.
 * Legacy sessions without the marker use the daemon's transcript-tail fallback.
 * Dependency-light on purpose — no stores or components.
 */

export interface PendingQuestionSet {
  /** Id of the question-bearing assistant message (keys wizard remounts). */
  messageId: string;
  /** The questions in transcript order (at least one). */
  questions: Question[];
}

function questionsOf(message: AgentMessage): Question[] {
  return dedupeResourceBlocks(message.contentBlocks ?? [])
    .map(getQuestionFromResourceBlock)
    .filter((q): q is Question => q !== null);
}

/**
 * Derive the pending question set, or null when there is none.
 *
 * Null whenever the agent's OWN turn is still active (`isTurnActive` mirrors
 * the canonical `selectAgentIsResponding` gate — NOT the broader
 * `selectAgentIsRunning`, which stays true while the agent merely waits on
 * delegated agents and must not suppress the wizard), an optimistic pending
 * user bubble is shown, or the question-bearing message is still streaming.
 * When the marker is absent, trailing system rows are transparent and only a
 * question-bearing assistant row at the non-system tail is pending.
 */
export function derivePendingQuestions(
  messages: readonly AgentMessage[],
  isTurnActive: boolean,
  showingPendingUserMessage = false,
  pendingQuestionsMessageId?: string,
): PendingQuestionSet | null {
  if (isTurnActive || showingPendingUserMessage || messages.length === 0) {
    return null;
  }
  if (pendingQuestionsMessageId === '') return null;

  if (pendingQuestionsMessageId !== undefined) {
    const marked = messages.find((message) => message.id === pendingQuestionsMessageId);
    if (!marked || marked.role !== 'assistant' || marked.isStreaming) return null;
    const questions = questionsOf(marked);
    return questions.length > 0 ? { messageId: marked.id, questions } : null;
  }

  // Match the daemon's pre-marker fallback: trailing system rows are
  // transparent, but the first non-system row must itself be a
  // question-bearing assistant message.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'system') continue;
    if (msg.role !== 'assistant' || msg.isStreaming) return null;
    const questions = questionsOf(msg);
    return questions.length > 0 ? { messageId: msg.id, questions } : null;
  }
  return null;
}
