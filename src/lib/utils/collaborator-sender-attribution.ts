/**
 * Exact historical human-sender presentation. The daemon emits distinct host-member
 * and legacy guest templates from the bound caller's durable role. Rebuild only
 * from the served local author snapshot and a known, unequal workspace owner;
 * never infer an author or current permission from the prose. Portable snapshots
 * cannot qualify. The accepted producer appends exactly two newlines.
 * Matching and stripping create presentation copies only; stored bytes stay intact.
 */

import type { AgentMessage, MessageAuthor, MessageRole } from '$shared/types/agent-message';
import { stripLiteralHeader } from './agent-message-attribution';
import { isUserAuthoredMetadata } from './message-authorship';
import { isCollaborationIdentity } from '$features/collaboration-auth/identity';

export interface CollaboratorSenderAttribution {
  /** The row's `author` projection the preamble was rebuilt from. */
  author: MessageAuthor;
  /** The exact preamble line the daemon prepended (no trailing newlines). */
  preamble: string;
  /** Historical display role from the exact template, never current authority. */
  role: 'member' | 'guest';
}

/**
 * Mirror of the daemon's `single_line_name`: control characters collapse to
 * spaces, whitespace runs collapse to one space, and a name that sanitizes
 * to empty is dropped. Shared with the sender chip so its label carries the
 * same identity the preamble named.
 */
export function singleLineName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const collapsed = name
    .replace(/\p{Cc}/gu, ' ')
    .split(/\p{White_Space}+/u)
    .filter((part) => part !== '')
    .join(' ');
  return collapsed === '' ? null : collapsed;
}

/**
 * Byte-exact rebuild of the accepted guest (v1) and member (v2.9) templates: login +
 * display name, then login alone, then display name alone, then the
 * principal id.
 */
export function buildCollaboratorSenderPreamble(
  login: string | null | undefined,
  displayName: string | null | undefined,
  principalId: string,
  sender?: { role: 'member'; identity?: MessageAuthor['identity'] },
): string {
  const cleanLogin = singleLineName(login);
  const cleanName = singleLineName(displayName);
  const principal = sender ? (singleLineName(principalId) ?? '') : principalId;
  let who: string;
  if (cleanLogin && cleanName) who = `@${cleanLogin} (${cleanName})`;
  else if (cleanLogin) who = `@${cleanLogin}`;
  else if (cleanName) who = cleanName;
  else who = `principal ${principal}`;
  if (sender) {
    const identity = sender.identity;
    // i18n-ignore (byte-exact accepted daemon member template, harness v2.9)
    const clause = identity
      ? `; ${singleLineName(identity.provider) ?? ''}@${singleLineName(identity.host) ?? ''} user ${singleLineName(identity.externalUserId) ?? ''}`
      : '';
    // i18n-ignore (byte-exact accepted daemon member template, harness v2.9)
    return `Message from ${who}, a host member (principal ${principal}${clause}) — not the workspace owner.`;
  }
  // i18n-ignore (mirrors the daemon's collaborator sender preamble, PROTOCOL §5.5)
  return `Message from ${who}, a collaborator (guest) of this workspace — not the workspace owner.`;
}

/** Narrow a served local author without trusting provenance or unknown additive fields. */
function asMessageAuthor(value: unknown): (MessageAuthor & { principalId: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { principalId } = raw;
  if (typeof principalId !== 'string' || !singleLineName(principalId)) return null;
  for (const field of ['login', 'displayName', 'avatarUrl']) {
    if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string')
      return null;
  }
  if (
    raw.identity !== undefined &&
    (!isCollaborationIdentity(raw.identity) || !singleLineName(raw.identity.externalUserId))
  )
    return null;
  return {
    principalId,
    login: typeof raw.login === 'string' ? raw.login : null,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : null,
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    ...(isCollaborationIdentity(raw.identity)
      ? {
          identity: {
            provider: raw.identity.provider,
            host: raw.identity.host,
            externalUserId: raw.identity.externalUserId,
          },
        }
      : {}),
  };
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
 * `author` projection, that author is not the workspace owner
 * (`ownerPrincipalId`, PROTOCOL §5.1 — the daemon never prepends the preamble
 * for the owner, so an owner row starting with the exact line is the owner's
 * own prose), and its content starts with the exact preamble the daemon would
 * have built from that projection. Rows from older daemons (no `author`),
 * owner rows, and lookalike first lines yield null. The owner exclusion is
 * not optional: without `ownerPrincipalId` (no workspace at hand, or a
 * workspace the daemon served without an owner) nothing qualifies, so the
 * owner's own prose is never stripped on an unguarded surface.
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
  ownerPrincipalId: string | null | undefined,
): CollaboratorSenderAttribution | null {
  if (typeof ownerPrincipalId !== 'string' || !ownerPrincipalId.trim()) return null;
  if (!message || message.role !== 'user') return null;
  if (!isUserAuthoredMetadata(message.metadata)) return null;
  const author = asMessageAuthor(message.author);
  if (!author) return null;
  if (author.principalId === ownerPrincipalId) return null;
  const text = leadingText(message);
  for (const role of ['member', 'guest'] as const) {
    const preamble = buildCollaboratorSenderPreamble(
      author.login,
      author.displayName,
      author.principalId,
      role === 'member' ? { role, identity: author.identity } : undefined,
    );
    if (!text.startsWith(`${preamble}\n\n`)) continue;
    if (stripLiteralHeader(text, preamble) !== null) return { author, preamble, role };
  }
  return null;
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
  if (!attribution || !text.startsWith(`${attribution.preamble}\n\n`)) return text;
  return stripLiteralHeader(text, attribution.preamble) ?? text;
}
