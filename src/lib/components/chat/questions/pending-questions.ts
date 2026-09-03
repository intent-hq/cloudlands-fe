import type { AgentMessage } from '$shared/types';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import { getAnsweredQuestionsMessageId } from './answer-message';

/**
 * Pending Agent Q&A questions for the composer-slot wizard. The daemon's
 * three-state pending marker is authoritative when present: an empty string
 * clears the slot, while a message id permits only that question-bearing row
 * — and keeps it pending across later automatic/user turns until the daemon
 * clears it (answer or dismissal). Legacy sessions without the marker use the
 * daemon's transcript-tail fallback. Dependency-light on purpose — no stores
 * or components.
 */

export interface PendingQuestionSet {
  /** Id of the question-bearing assistant message (keys wizard remounts). */
  messageId: string;
  /** The questions in transcript order (at least one). */
  questions: Question[];
}

export type PendingQuestionMarkerState =
  { kind: 'absent' } | { kind: 'cleared' } | { kind: 'set'; messageId: string };

/** Classify the daemon marker without conflating absent and written-empty. */
export function classifyPendingQuestionMarker(
  pendingQuestionsMessageId: string | undefined,
): PendingQuestionMarkerState {
  if (pendingQuestionsMessageId === undefined) return { kind: 'absent' };
  if (pendingQuestionsMessageId === '') return { kind: 'cleared' };
  return { kind: 'set', messageId: pendingQuestionsMessageId };
}

function questionsOf(message: AgentMessage): Question[] {
  return dedupeResourceBlocks(message.contentBlocks ?? [])
    .map(getQuestionFromResourceBlock)
    .filter((q): q is Question => q !== null);
}

/**
 * True when a user row in `messages` carries the wizard's answer tag naming
 * `messageId`. Bridges the window between the user hitting Send (the
 * optimistic row mirrors the tag) and the daemon's `agent:updated` clearing
 * the marker, so an answered set never pops back in.
 */
export function isQuestionSetAnswered(
  messages: readonly AgentMessage[],
  messageId: string,
): boolean {
  return messages.some(
    (message) => message.role === 'user' && getAnsweredQuestionsMessageId(message) === messageId,
  );
}

/**
 * Derive the pending question set, or null when there is none.
 *
 * With the daemon marker set, the marked question-bearing row stays pending
 * regardless of `isTurnActive`: the marker is only written once the asking
 * turn has ended, and later automatic/user turns must not hide the wizard.
 * It is null only while that row is still streaming, once a tagged answer
 * row names it, or while an optimistic pending user bubble is shown.
 *
 * Without the marker (legacy daemon) the transcript-tail fallback applies and
 * is additionally null whenever the agent's OWN turn is active (`isTurnActive`
 * mirrors the canonical `selectAgentIsResponding` gate — NOT the broader
 * `selectAgentIsRunning`, which stays true while the agent merely waits on
 * delegated agents and must not suppress the wizard): trailing system rows
 * are transparent and only a question-bearing assistant row at the
 * non-system tail is pending.
 */
export function derivePendingQuestions(
  messages: readonly AgentMessage[],
  isTurnActive: boolean,
  showingPendingUserMessage = false,
  pendingQuestionsMessageId?: string,
): PendingQuestionSet | null {
  if (showingPendingUserMessage || messages.length === 0) {
    return null;
  }
  const marker = classifyPendingQuestionMarker(pendingQuestionsMessageId);
  if (marker.kind === 'cleared') return null;

  if (marker.kind === 'set') {
    const marked = messages.find((message) => message.id === marker.messageId);
    if (!marked || marked.role !== 'assistant' || marked.isStreaming) return null;
    if (isQuestionSetAnswered(messages, marker.messageId)) return null;
    const questions = questionsOf(marked);
    return questions.length > 0 ? { messageId: marked.id, questions } : null;
  }

  if (isTurnActive) return null;

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
