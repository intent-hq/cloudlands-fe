import { isCollaborationIdentity } from '../collaboration-auth/identity';
import type { CommentAttribution, NoteComment } from '$shared/types/comment.types';
import { m } from '$shared/paraglide/messages.js';

/** Project only the daemon's human creator fields. Local ids are not portable identities. */
export function projectCommentAttribution(raw: {
  authorType?: unknown;
  authorPrincipalId?: unknown;
  authorIdentity?: unknown;
}): CommentAttribution {
  if (raw.authorType !== 'user') return {};
  const result: CommentAttribution = {};
  if (typeof raw.authorPrincipalId === 'string' && raw.authorPrincipalId.trim()) {
    result.authorPrincipalId = raw.authorPrincipalId;
  }
  if (isCollaborationIdentity(raw.authorIdentity) && raw.authorIdentity.externalUserId.trim()) {
    const { provider, host, externalUserId } = raw.authorIdentity;
    result.authorIdentity = { provider, host, externalUserId };
  }
  return result;
}

/** Every field belongs to the same selected latest row, including authoritative omissions. */
export function projectLatestCommentAuthor(
  raw: Record<string, unknown>,
): Partial<Pick<NoteComment, 'author' | 'authorType' | 'authorPrincipalId' | 'authorIdentity'>> {
  const authorType =
    raw.latestCommentAuthorType === 'user' || raw.latestCommentAuthorType === 'agent'
      ? raw.latestCommentAuthorType
      : undefined;
  const attribution = projectCommentAttribution({
    authorType,
    authorPrincipalId: raw.latestCommentAuthorPrincipalId,
    authorIdentity: raw.latestCommentAuthorIdentity,
  });
  return {
    author: typeof raw.latestCommentAuthor === 'string' ? raw.latestCommentAuthor : undefined,
    authorType,
    authorPrincipalId: attribution.authorPrincipalId,
    authorIdentity: attribution.authorIdentity,
  };
}

/** A qualified display label, never a role, lookup key, or permission decision. */
export function commentAuthorLabel(comment: {
  author?: string;
  authorType?: unknown;
  authorIdentity?: unknown;
}): string {
  const name = comment.author || m.tiptap_comment_unknownAuthor_label();
  const { authorIdentity } = projectCommentAttribution(comment);
  if (!authorIdentity) return name;
  const { provider, host, externalUserId } = authorIdentity;
  // i18n-ignore (qualified account identifiers are data, not translated prose)
  const handle = `${provider}@${host} · ${externalUserId}`;
  return m.presence_person_forge_label({ name, handle });
}
