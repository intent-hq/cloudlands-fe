import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';

/**
 * Pending Agent Q&A questions for the composer-slot wizard (wire contract:
 * pending vs. answered is derived purely from the transcript — questions on
 * the LAST assistant message with NO later user message are pending; ANY
 * later user message supersedes them). Dependency-light on purpose — no
 * stores, no components — so ChatPanel's derivation and the vitest suites
 * share one implementation.
 */

export interface PendingQuestionSet {
  /** Id of the question-bearing assistant message (keys wizard remounts). */
  messageId: string;
  /** The questions in transcript order (at least one). */
  questions: Question[];
}

/**
 * Derive the pending question set, or null when there is none.
 *
 * Null whenever the agent's OWN turn is still active (`isTurnActive` mirrors
 * the canonical `selectAgentIsResponding` gate — NOT the broader
 * `selectAgentIsRunning`, which stays true while the agent merely waits on
 * delegated agents and must not suppress the wizard), an optimistic pending
 * user bubble is shown, the last assistant message is still streaming, or a
 * user message trails the last assistant message (superseded). Because this
 * reads only the transcript, restored sessions re-surface unanswered
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
  // Walk back to the last assistant message; a user message encountered
  // first supersedes any questions (resolution is derivational, not id-keyed).
  let lastAssistant: AgentMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') return null;
    if (msg.role === 'assistant') {
      lastAssistant = msg;
      break;
    }
  }
  if (!lastAssistant || lastAssistant.isStreaming) return null;
  const questions = dedupeResourceBlocks(lastAssistant.contentBlocks ?? [])
    .map(getQuestionFromResourceBlock)
    .filter((q): q is Question => q !== null);
  if (questions.length === 0) return null;
  return { messageId: lastAssistant.id, questions };
}
