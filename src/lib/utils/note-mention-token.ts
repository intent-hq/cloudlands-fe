/**
 * Note mention prompt token: `@note[<id>|<title>]`, or
 * `@note[<id>|<title>|<workspaceId>]` for a note in another workspace.
 *
 * The id (and optional workspace id) is authoritative for lookup and
 * navigation; the title is a human/agent-readable hint used as the display
 * fallback when the note is not in the local store. The bracketed form keeps
 * multi-word titles inside one whitespace-safe token — the legacy
 * `@note/<x>` form ends at the first space, so `@note/<title>` truncated
 * titles like "Meeting with Andre" to "Meeting". Legacy `@note/<id>` tokens
 * remain readable by the existing matchers.
 */

export interface NoteMention {
  id: string;
  title: string;
  /** Set only for a note that lives in another workspace. */
  workspaceId?: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Regex source (no flags) matching a whole `@note[...]` token's body after the `@`. */
export const NOTE_MENTION_BODY_SOURCE = String.raw`note\[[A-Za-z0-9_-]+\|[^\]\n]*\]`;

/** Strip characters that would break the token's delimiters; collapse whitespace. */
function sanitizeTitle(title: string): string {
  return title
    .replace(/[[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Serialize a note mention. Returns null when the id is not token-safe so the
 * caller can fall back to another representation.
 */
export function serializeNoteMention(mention: NoteMention): string | null {
  if (!SAFE_ID.test(mention.id)) return null;
  const title = sanitizeTitle(mention.title) || mention.id;
  const ws =
    mention.workspaceId && SAFE_ID.test(mention.workspaceId) ? `|${mention.workspaceId}` : '';
  return `@note[${mention.id}|${title}${ws}]`;
}

/**
 * Parse a `@note[...]` token (with or without the leading `@`). Treats input
 * as untrusted: returns null unless the id (and workspace id, if present)
 * are token-safe.
 */
export function parseNoteMention(token: string): NoteMention | null {
  const match = /^@?note\[([^\]\n]*)\]$/.exec(token);
  if (!match) return null;
  const parts = match[1].split('|');
  if (parts.length < 2 || parts.length > 3) return null;
  const [id, rawTitle, workspaceId] = parts;
  if (!SAFE_ID.test(id)) return null;
  if (workspaceId !== undefined && !SAFE_ID.test(workspaceId)) return null;
  const title = rawTitle.trim() || id;
  return workspaceId ? { id, title, workspaceId } : { id, title };
}
