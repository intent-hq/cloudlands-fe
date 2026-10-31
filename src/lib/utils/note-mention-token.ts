/**
 * Note mention prompt token: `@note[<id>:<title>]`, or
 * `@note[<workspaceId>/<id>:<title>]` for a note in another workspace.
 *
 * The id (and optional workspace id) is authoritative for lookup and
 * navigation; the title is a human/agent-readable hint used as the display
 * fallback when the note is not in the local store. The bracketed form keeps
 * multi-word titles inside one whitespace-safe token — the legacy
 * `@note/<x>` form ends at the first space, so `@note/<title>` truncated
 * titles like "Meeting with Andre" to "Meeting". Legacy `@note/<id>` tokens
 * remain readable by the existing matchers.
 *
 * Ids are restricted to `[A-Za-z0-9_-]`, so the first `/` and `:` are
 * unambiguous delimiters and the title may contain either. The token holds
 * no `|` (it would split a GFM table cell) and titles are stripped of
 * markdown-significant characters, `@` and `://`/`www.` so a note round-trip
 * cannot re-parse them (emphasis, autolinks). Titles never contain `[`, so an
 * unterminated token cannot swallow following bracketed text.
 */

export interface NoteMention {
  id: string;
  title: string;
  /** Set only for a note that lives in another workspace. */
  workspaceId?: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Regex source (no flags, no groups) matching a whole token body after the `@`. */
export const NOTE_MENTION_BODY_SOURCE = String.raw`note\[(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+:[^[\]\n]*\]`;

const PARSE_RE = /^@?note\[(?:([A-Za-z0-9_-]+)\/)?([A-Za-z0-9_-]+):([^[\]\n]*)\]$/;

/** Matches what Markdown passes through as an HTML character reference (`&#93;`, `&amp;`). */
const CHARACTER_REFERENCE = /&(#?\w+);/g;

/**
 * Drop the `;` of every character-reference-shaped sequence. Markdown passes
 * `&#93;` through as a reference that the note editor's HTML parse decodes to
 * `]`, ending the token early; without the `;` Markdown escapes the `&` and
 * every reader keeps the same literal text. Repeats because removing one `;`
 * can complete another reference (`&ab;c;` → `&abc;`).
 */
function disarmCharacterReferences(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(CHARACTER_REFERENCE, '&$1');
  } while (current !== previous);
  return current;
}

/**
 * Strip delimiter and markdown-significant characters; collapse whitespace.
 * Shared by the other bracketed mention tokens (runtime-mention-token.ts).
 */
export function sanitizeMentionTitle(title: string): string {
  return disarmCharacterReferences(title)
    .replace(/[[\]|*_`~\\<>@]/g, ' ')
    .replace(/:\/\//g, ' ')
    .replace(/\bwww\./gi, 'www ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Serialize a note mention. Returns null when the id is not token-safe so the
 * caller can fall back to another representation.
 */
export function serializeNoteMention(mention: NoteMention): string | null {
  if (!SAFE_ID.test(mention.id)) return null;
  // An unsafe workspace id must not silently degrade into a same-workspace
  // token that would resolve the wrong note.
  if (mention.workspaceId && !SAFE_ID.test(mention.workspaceId)) return null;
  const title = sanitizeMentionTitle(mention.title) || mention.id;
  const ws = mention.workspaceId ? `${mention.workspaceId}/` : '';
  return `@note[${ws}${mention.id}:${title}]`;
}

/** Parse a `@note[...]` token (with or without the leading `@`); null if malformed. */
export function parseNoteMention(token: string): NoteMention | null {
  const match = PARSE_RE.exec(token);
  if (!match) return null;
  const [, workspaceId, id, rawTitle] = match;
  const title = rawTitle.trim() || id;
  return workspaceId ? { id, title, workspaceId } : { id, title };
}

/** Mention-chip attributes for a parsed note token (note editor / markdown chips). */
export function noteMentionChipAttrs(note: NoteMention): {
  type: 'note';
  id: string;
  label: string;
  meta?: { workspaceId: string; isExternalLink: true };
} {
  return {
    type: 'note',
    id: note.id,
    label: note.title,
    ...(note.workspaceId
      ? {
          meta: { workspaceId: note.workspaceId, isExternalLink: true },
        }
      : {}),
  };
}
