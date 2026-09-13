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
  return asMessageAuthor(message.author);
}

/** The value as a `MessageAuthor` when it carries a principal id, else null. */
function asMessageAuthor(value: unknown): MessageAuthor | null {
  if (!value || typeof value !== 'object') return null;
  const { principalId } = value as { principalId?: unknown };
  if (typeof principalId !== 'string' || principalId.length === 0) return null;
  return value as MessageAuthor;
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

/**
 * The `author` projections the transcript already carries, keyed by
 * `principalId` (later rows win). The queue surface falls back to this map
 * for entries from a daemon that stamps `messageMetadata.fromPrincipalId`
 * but does not yet serve an `author` projection on queue entries.
 */
export function collectMessageAuthors(
  messages: ReadonlyArray<{ role: MessageRole; author?: unknown; metadata?: unknown }>,
): Map<string, MessageAuthor> {
  const authors = new Map<string, MessageAuthor>();
  for (const message of messages) {
    const author = getHumanMessageAuthor(message);
    if (author) authors.set(author.principalId, author);
  }
  return authors;
}

/**
 * The authors the queue surface may attribute against, or null when the
 * surface is off: attribution lights up only once the workspace has more
 * than one member (`memberCount >= 2`; absent on older daemons = off).
 */
export function getQueueSurfaceAuthors(
  memberCount: number | null | undefined,
  messages: ReadonlyArray<{ role: MessageRole; author?: unknown; metadata?: unknown }>,
): Map<string, MessageAuthor> | null {
  return (memberCount ?? 0) >= 2 ? collectMessageAuthors(messages) : null;
}

/**
 * The human author of a queue entry, or null. `authors === null` means the
 * surface is off (see `getQueueSurfaceAuthors`). Otherwise the entry must
 * pass `isUserAuthoredMetadata`; its own `author` projection (served by the
 * daemon next to the `fromPrincipalId` stamp) wins, and an entry without one
 * (older daemon) resolves its stamp against `authors`. Unstamped entries and
 * unresolvable principals yield null — the caller renders no attribution
 * rather than a placeholder.
 */
export function getQueuedMessageAuthor(
  queued: { messageMetadata?: unknown; author?: unknown } | null | undefined,
  authors: ReadonlyMap<string, MessageAuthor> | null | undefined,
): MessageAuthor | null {
  if (!queued || !authors) return null;
  const metadata = queued.messageMetadata;
  if (!isUserAuthoredMetadata(metadata)) return null;
  const own = asMessageAuthor(queued.author);
  if (own) return own;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { fromPrincipalId } = metadata as { fromPrincipalId?: unknown };
  if (typeof fromPrincipalId !== 'string' || fromPrincipalId.length === 0) return null;
  return authors.get(fromPrincipalId) ?? null;
}
