/**
 * Collaborator sender preamble (multiplayer).
 *
 * When a workspace collaborator (guest) sends a human message to an agent,
 * the daemon prepends a single plain-prose line naming the sender and their
 * role to the persisted content (`agent.sendMessage`, `agent.queueMessage`
 * and its drain, `agent.editQueuedMessage`; PROTOCOL §5.5, intentd#1987):
 *
 *   `Message from @{login} ({displayName}), a collaborator (guest) of this
 *   workspace — not the workspace owner.` + one blank line
 *
 * The chip conveys the sender instead, so presentation copies drop the
 * preamble — exact match only, the same way `stripAgentMessageHeader` strips
 * the A2A sender header: the literal preamble is rebuilt from the row's own
 * serve-time `author` projection (login / displayName / principalId are the
 * same fields the daemon built it from) and compared byte-for-byte. No regex
 * heuristic, so user-typed prose that merely resembles the preamble is left
 * byte-identical. Display-only — the stored message is never mutated.
 * Dependency-light on purpose: type-only imports.
 */

import type { AgentMessage, MessageAuthor, MessageRole } from '$shared/types/agent-message';
import { stripLiteralHeader } from './agent-message-attribution';
import { isUserAuthoredMetadata } from './message-authorship';

export interface CollaboratorSenderAttribution {
  /** The row's `author` projection the preamble was rebuilt from. */
  author: MessageAuthor;
  /** The exact preamble line the daemon prepended (no trailing newlines). */
  preamble: string;
}

/**
 * Mirror of the daemon's `single_line_name`: control characters collapse to
 * spaces, whitespace runs collapse to one space, and a name that sanitizes
 * to empty is dropped.
 */
function singleLineName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const collapsed = name
    .replace(/\p{Cc}/gu, ' ')
    .split(/\p{White_Space}+/u)
    .filter((part) => part !== '')
    .join(' ');
  return collapsed === '' ? null : collapsed;
}

/**
 * Byte-exact rebuild of `Harness::collaborator_sender_preamble` (v1): login +
 * display name, then login alone, then display name alone, then the
 * principal id.
 */
export function buildCollaboratorSenderPreamble(
  login: string | null | undefined,
  displayName: string | null | undefined,
  principalId: string,
): string {
  const cleanLogin = singleLineName(login);
  const cleanName = singleLineName(displayName);
  let who: string;
  if (cleanLogin && cleanName) who = `@${cleanLogin} (${cleanName})`;
  else if (cleanLogin) who = `@${cleanLogin}`;
  else if (cleanName) who = cleanName;
  else who = `principal ${principalId}`;
  // i18n-ignore (mirrors the daemon's collaborator sender preamble, PROTOCOL §5.5)
  return `Message from ${who}, a collaborator (guest) of this workspace — not the workspace owner.`;
}

/** The value as a `MessageAuthor` when it carries a principal id, else null. */
function asMessageAuthor(value: unknown): MessageAuthor | null {
  if (!value || typeof value !== 'object') return null;
  const { principalId } = value as { principalId?: unknown };
  if (typeof principalId !== 'string' || principalId.length === 0) return null;
  return value as MessageAuthor;
}

/** Leading text of a row, as the daemon persisted it (first text block onward). */
function leadingText(message: { contentBlocks?: AgentMessage['contentBlocks'] }): string {
  return (message.contentBlocks ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/**
 * Collaborator sender attribution of a transcript row, or null. A row
 * qualifies only when it is a plain human `user` row (agent-to-agent sends
 * and automated wakes never carry the preamble), it carries the serve-time
 * `author` projection, and its content starts with the exact preamble the
 * daemon would have built from that projection. Rows from older daemons (no
 * `author`), owner rows, and lookalike first lines yield null.
 */
export function getCollaboratorSenderAttribution(
  message:
    | {
        role: MessageRole;
        author?: unknown;
        metadata?: unknown;
        contentBlocks?: AgentMessage['contentBlocks'];
      }
    | null
    | undefined,
): CollaboratorSenderAttribution | null {
  if (!message || message.role !== 'user') return null;
  if (!isUserAuthoredMetadata(message.metadata)) return null;
  const author = asMessageAuthor(message.author);
  if (!author) return null;
  const preamble = buildCollaboratorSenderPreamble(
    author.login,
    author.displayName,
    author.principalId,
  );
  if (stripLiteralHeader(leadingText(message), preamble) === null) return null;
  return { author, preamble };
}

/**
 * Drop the exact preamble line plus the one blank separator line the daemon
 * emits (`{preamble}\n\n`), never body whitespace. Returns the input unchanged
 * when it does not start with the exact preamble.
 */
export function stripCollaboratorSenderPreamble(
  text: string,
  attribution: CollaboratorSenderAttribution | null | undefined,
): string {
  if (!attribution) return text;
  return stripLiteralHeader(text, attribution.preamble) ?? text;
}
