/**
 * Message-authorship core predicate, shared by the queue surface
 * (`isUserQueuedMessage` in queued-message-visibility.ts, reads
 * `messageMetadata`) and the transcript surface (`isAutomatedChatMessage`
 * in previous-user-message.ts, reads `metadata`) so the rules cannot drift.
 *
 * Authenticated human stamps take precedence over semantic type/source hints.
 * Without a stamp, daemon-origin messages
 * (agent-to-agent sends, event-notification wakes, hook wakes, PR-monitor
 * wakes, system wakes) carry metadata with a `type` string, a daemon-stamped
 * `fromAgentId`, or `source: 'system'` (PROTOCOL §5.5). Benign fields that
 * can appear on user messages (`model`, `userAppMessageId`, `queueInfo`) do
 * not mark a message as non-user. Absent or malformed metadata means
 * user-authored (fail open). Author display never changes admission or actions.
 */

import type { MessageAuthor, MessageRole } from '$shared/types/agent-message';
import { isCollaborationIdentity } from '$features/collaboration-auth/identity';
import { m } from '$shared/paraglide/messages.js';

/**
 * True when daemon-served metadata identifies a human author. Authenticated
 * principal stamps win; automatic ingress strips these stamps. Without one,
 * a message is NON-user iff its metadata is an object and any of: `type` is a string
 * (except the user-authored `question_answers` wizard tag), `fromAgentId`
 * is a non-empty string, or `source === 'system'`.
 */
export function isUserAuthoredMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return true;
  const md = metadata as Record<string, unknown>;
  if (typeof md.fromPrincipalId === 'string' && md.fromPrincipalId.trim()) return true;
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
 * `isUserAuthoredMetadata`, and the projection carries a local principal id
 * or explicit portable null. Portable snapshots never resolve against local ids.
 * Optimistic local rows and rows from older daemons carry no `author`.
 *
 * `ownPrincipalId` is the viewer's own principal (`presence.ownPrincipalId`):
 * the viewer's own rows yield null, so they render as in a single-member
 * workspace. While it is still unknown (`null` / omitted) nobody can be told
 * apart from the viewer and every author is kept.
 */
export function getHumanMessageAuthor(
  message: { role: MessageRole; author?: unknown; metadata?: unknown } | null | undefined,
  ownPrincipalId?: string | null,
): MessageAuthor | null {
  if (!message || message.role !== 'user') return null;
  if (!isUserAuthoredMetadata(message.metadata)) return null;
  return withoutOwnAuthor(asMessageAuthor(message.author), ownPrincipalId);
}

/** Narrow served profile fields without consulting provenance, presence or membership. */
function asMessageAuthor(value: unknown): MessageAuthor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { principalId } = raw;
  if (principalId !== null && (typeof principalId !== 'string' || !principalId.trim())) return null;
  const profile = (field: unknown): string | null => (typeof field === 'string' ? field : null);
  const author: MessageAuthor = {
    principalId,
    login: profile(raw.login),
    displayName: profile(raw.displayName),
    avatarUrl: profile(raw.avatarUrl),
  };
  if (isCollaborationIdentity(raw.identity) && raw.identity.externalUserId.trim()) {
    const { provider, host, externalUserId } = raw.identity;
    author.identity = { provider, host, externalUserId };
  }
  // Keep existing local profile references when no projection is needed.
  if (
    raw.identity === undefined &&
    Object.keys(raw).every((key) =>
      ['principalId', 'login', 'displayName', 'avatarUrl'].includes(key),
    ) &&
    raw.login === author.login &&
    raw.displayName === author.displayName &&
    raw.avatarUrl === author.avatarUrl
  )
    return value as MessageAuthor;
  return author;
}

/** `author`, or null when it is the viewer's own principal (an unknown own principal keeps it). */
function withoutOwnAuthor(
  author: MessageAuthor | null,
  ownPrincipalId: string | null | undefined,
): MessageAuthor | null {
  if (!author || !ownPrincipalId) return author;
  return author.principalId === ownPrincipalId ? null : author;
}

/**
 * Display label: profile name plus a complete qualified identity when supplied.
 * All-null human profiles leave the caller its existing unknown-human label.
 */
export function getMessageAuthorLabel(author: MessageAuthor): string | null {
  const safe = asMessageAuthor(author);
  if (!safe) return null;
  const name = safe.displayName?.trim() ? safe.displayName : safe.login?.trim() ? safe.login : null;
  if (!safe.identity) return name;
  const { provider, host, externalUserId } = safe.identity;
  // i18n-ignore (qualified account identifiers are data, not translated prose)
  const handle = `${provider}@${host} · ${externalUserId}`;
  return m.presence_person_forge_label({
    name: name ?? m.chat_chatMessage_authorUnknown_label(),
    handle,
  });
}

/**
 * The `author` projections the transcript already carries, keyed by
 * nonempty local `principalId` (later rows win). Portable authors never enter
 * this transcript-scoped map. The queue surface falls back to this map
 * for entries from a daemon that stamps `messageMetadata.fromPrincipalId`
 * but does not yet serve an `author` projection on queue entries.
 */
export function collectMessageAuthors(
  messages: ReadonlyArray<{ role: MessageRole; author?: unknown; metadata?: unknown }>,
): Map<string, MessageAuthor> {
  const authors = new Map<string, MessageAuthor>();
  for (const message of messages) {
    const author = getHumanMessageAuthor(message);
    if (author && typeof author.principalId === 'string') authors.set(author.principalId, author);
  }
  return authors;
}

/**
 * The authors the queue surface may attribute against, or null when the
 * local fallback surface is off: local attribution lights up once the workspace has more
 * than one member (`memberCount >= 2`; absent on older daemons = off).
 */
export function getQueueSurfaceAuthors(
  memberCount: number | null | undefined,
  messages: ReadonlyArray<{ role: MessageRole; author?: unknown; metadata?: unknown }>,
): Map<string, MessageAuthor> | null {
  return (memberCount ?? 0) >= 2 ? collectMessageAuthors(messages) : null;
}

/**
 * The human author of a queue entry, or null. A valid portable projection
 * remains displayable without a roster; `authors === null` disables only local
 * attribution and legacy fallback (see `getQueueSurfaceAuthors`). The entry must
 * pass `isUserAuthoredMetadata`; its own `author` projection (served by the
 * daemon next to the `fromPrincipalId` stamp) is authoritative: a valid
 * projection is used and an explicit `null` means "no author" (the principal
 * row is gone) with no fallback. Only an ABSENT field (older daemon) resolves
 * the stamp against `authors`; a malformed non-null value is treated as
 * absent. Unstamped entries and unresolvable principals yield null — the
 * caller renders no attribution rather than a placeholder. The viewer's own
 * entries yield null too (`ownPrincipalId`, as in `getHumanMessageAuthor`).
 */
export function getQueuedMessageAuthor(
  queued: { messageMetadata?: unknown; author?: unknown } | null | undefined,
  authors: ReadonlyMap<string, MessageAuthor> | null | undefined,
  ownPrincipalId?: string | null,
): MessageAuthor | null {
  if (!queued) return null;
  const metadata = queued.messageMetadata;
  if (!isUserAuthoredMetadata(metadata)) return null;
  if (queued.author === null) return null;
  const own = asMessageAuthor(queued.author);
  if (own?.principalId === null) return own;
  if (!authors) return null;
  if (own) return withoutOwnAuthor(own, ownPrincipalId);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { fromPrincipalId } = metadata as { fromPrincipalId?: unknown };
  if (typeof fromPrincipalId !== 'string' || fromPrincipalId.length === 0) return null;
  const cached = asMessageAuthor(authors.get(fromPrincipalId));
  return cached?.principalId === fromPrincipalId ? withoutOwnAuthor(cached, ownPrincipalId) : null;
}
