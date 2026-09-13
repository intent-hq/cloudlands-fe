/**
 * Message-authorship core predicate, shared by the queue surface
 * (`isUserQueuedMessage` in queued-message-visibility.ts, reads
 * `messageMetadata`) and the transcript surface (`isAutomatedChatMessage`
 * in previous-user-message.ts, reads `metadata`) so the rules cannot drift.
 *
 * User-typed messages never carry an origin tag; daemon-origin messages
 * (agent-to-agent sends, event-notification wakes, hook wakes, PR-monitor
 * wakes, system wakes) carry metadata with a `type` string, a daemon-stamped
 * `fromAgentId`, or `source: 'system'` (PROTOCOL §5.5). Benign fields that
 * can appear on user messages (`model`, `userAppMessageId`, `queueInfo`) do
 * not mark a message as non-user. Absent or malformed metadata means
 * user-authored (fail open). Dependency-light on purpose: type-only imports.
 */

import type { MessageAuthor, MessageRole } from '$shared/types/agent-message';

/**
 * True when a metadata object marks its message as user-authored. A message
 * is NON-user iff the metadata is an object and any of: `type` is a string
 * (except the user-authored `question_answers` wizard tag), `fromAgentId`
 * is a non-empty string, or `source === 'system'`.
 */
export function isUserAuthoredMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return true;
  const md = metadata as Record<string, unknown>;
  // Explicit contract pin for dismissal notifications (`agent.dismissQuestions`,
  // `{ type: 'questions_dismissed', source: 'system', dismissedQuestionsMessageId }`).
  // Redundant with the generic string-`type` rule below, kept as belt-and-braces.
  if (md.type === 'questions_dismissed') return false;
  // The Q&A wizard's answer message is USER-authored despite its tag
  // (`{ type: 'question_answers', answeredQuestionsMessageId }`, see
  // questions/answer-message.ts): it travels through the ordinary send path,
  // so it stays user-authored regardless of the other markers.
  if (md.type === 'question_answers') return true;
  if (typeof md.type === 'string') return false;
  if (typeof md.fromAgentId === 'string' && md.fromAgentId.trim() !== '') return false;
  if (md.source === 'system') return false;
  return true;
}

/**
 * The human author of a transcript row, or null. The daemon attaches its
 * serve-time `author` projection to every `user` row of a workspace
 * (PROTOCOL §5.5, intent-hq/intentd#1869) — including agent-to-agent sends
 * and automated wakes, which fall back to the workspace owner — so a row
 * counts as human-authored only when its role is `user`, its metadata passes
 * `isUserAuthoredMetadata`, and the projection carries a principal id.
 * Optimistic local rows and rows from older daemons carry no `author`.
 */
export function getHumanMessageAuthor(
  message: { role: MessageRole; author?: unknown; metadata?: unknown } | null | undefined,
): MessageAuthor | null {
  if (!message || message.role !== 'user') return null;
  if (!isUserAuthoredMetadata(message.metadata)) return null;
  const author = message.author;
  if (!author || typeof author !== 'object') return null;
  const { principalId } = author as { principalId?: unknown };
  if (typeof principalId !== 'string' || principalId.length === 0) return null;
  return author as MessageAuthor;
}

/**
 * Display label for a message author: `displayName`, else `login`, else null
 * (the principal row is gone — the caller renders its own placeholder).
 */
export function getMessageAuthorLabel(author: MessageAuthor): string | null {
  if (typeof author.displayName === 'string' && author.displayName.trim() !== '') {
    return author.displayName;
  }
  if (typeof author.login === 'string' && author.login.trim() !== '') return author.login;
  return null;
}
