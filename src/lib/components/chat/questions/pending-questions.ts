import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import { getAnsweredQuestionsMessageId } from './answer-message';

/**
 * Pending Agent Q&A questions for the composer-slot wizard (wire contract:
 * pendingness is PERSISTENT — the newest question-bearing assistant message
 * keeps pending across later plain user messages AND the agent's subsequent
 * replies. It resolves only on an answer (a later user row tagged
 * `messageMetadata { type: "question_answers", answeredQuestionsMessageId }`),
 * on the `dismissedQuestionsMessageId` marker (wizard-gate), or when a NEWER
 * question-bearing assistant message supersedes it — single slot, newest set
 * wins). Dependency-light on purpose — no stores, no components — so
 * ChatPanel's derivation and the vitest suites share one implementation.
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
 * questions automatically.
 */
export function derivePendingQuestions(
  messages: readonly AgentMessage[],
  isTurnActive: boolean,
  showingPendingUserMessage = false,
): PendingQuestionSet | null {
  if (isTurnActive || showingPendingUserMessage || messages.length === 0) {
    return null;
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
