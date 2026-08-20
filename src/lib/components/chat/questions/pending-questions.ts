import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import { getAnsweredQuestionsMessageId } from './answer-message';

/**
 * Pending Agent Q&A questions for the composer-slot wizard. The daemon's
 * three-state pending marker is authoritative when present: an empty string
 * clears the slot, while a message id permits only that question-bearing row.
 * Legacy sessions without the marker keep the transcript-based fallback.
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
 * user bubble is shown, the question-bearing message is still streaming, or a
 * later user row answers it (matching `answeredQuestionsMessageId`). Because
 * this reads only the transcript, restored sessions re-surface unanswered
 * questions automatically when the daemon marker is absent.
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

  // Newest question-bearing assistant message wins (an older set is
  // superseded by construction); later plain user rows and assistant replies
  // do NOT resolve it.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const questions = questionsOf(msg);
    if (questions.length === 0) continue;
    if (msg.isStreaming) return null;
    // Resolution is id-keyed: a later user row tagged with this message id.
    for (let j = i + 1; j < messages.length; j++) {
      const later = messages[j];
      if (later.role !== 'user') continue;
      if (getAnsweredQuestionsMessageId(later) === msg.id) return null;
    }
    return { messageId: msg.id, questions };
  }
  return null;
}
