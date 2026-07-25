/**
 * Anchor reconciliation helpers (monorepo#710).
 *
 * Pure functions used by CommentManagerV2 to reconcile stored comments with
 * the TipTap document without falsely orphaning them.
 */

import type { CommentAnchor } from '../comment-types-v2';

/**
 * The comment id that owns a comment's in-document anchor nodes.
 *
 * Thread replies share the thread root's persistent anchors (the daemon's
 * `comment.respond` clones the parent's anchor), so a reply's anchor ids look
 * like `"<rootId>:start"` while its own `id` differs. Anchor lookups in the
 * document must use the id embedded in the anchor ids, not the comment's own
 * id — otherwise every reply falls through to text search and is orphaned.
 */
export function getAnchorOwnerCommentId(comment: {
  id: string;
  anchor?: CommentAnchor;
}): string {
  const anchorId = comment.anchor?.pointId ?? comment.anchor?.startId ?? comment.anchor?.endId;
  if (!anchorId) return comment.id;
  const sep = anchorId.lastIndexOf(':');
  return sep > 0 ? anchorId.slice(0, sep) : comment.id;
}

/**
 * Characters dropped from BOTH the search needle and the document projection.
 * Mirrors the daemon's `is_normalized_away` (note_ops.rs): whitespace (block
 * joins and newline/space differences become flexible) plus inline
 * emphasis/code delimiters, link brackets, and `@` (mention chips).
 */
export function isProjectionDroppedChar(ch: string): boolean {
  return (
    /\s/.test(ch) ||
    ch === '*' ||
    ch === '_' ||
    ch === '`' ||
    ch === '~' ||
    ch === '[' ||
    ch === ']' ||
    ch === '@'
  );
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
/** `](url)` → `]` so link text survives while the target is dropped. */
const LINK_URL_RE = /\]\([^)]*\)/g;
/** Leading heading / blockquote / task-list / list markers on a line. */
const LEADING_MARKER_RE =
  /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/;

/**
 * Minimum projected-needle length accepted by the projection fallback.
 * With whitespace and delimiters dropped, a very short needle would
 * first-match anywhere and silently anchor onto unrelated text; mirrors the
 * spirit of the daemon's `MIN_RESCUE_CONTEXT_OVERLAP` guard.
 */
export const MIN_PROJECTED_NEEDLE_LENGTH = 4;

/**
 * Project a stored markdown `anchorText` to the same normalized plaintext
 * space as [`projectDocChar`]-filtered document text: HTML comments (including
 * `<!--anchor:…-->` markers) stripped, per-line block markers removed, link
 * urls dropped, [`isProjectionDroppedChar`] characters removed, lowercased.
 */
export function projectAnchorNeedle(text: string): string {
  // Strip repeatedly: removing one comment can concatenate `<!` + `--…` into
  // a new `<!--…-->` sequence, so a single pass may leave markers behind.
  let withoutComments = text;
  let previous;
  do {
    previous = withoutComments;
    withoutComments = withoutComments.replace(HTML_COMMENT_RE, '');
  } while (withoutComments !== previous);
  const withoutUrls = withoutComments.replace(LINK_URL_RE, ']');
  const withoutMarkers = withoutUrls
    .split('\n')
    .map((line) => line.replace(LEADING_MARKER_RE, ''))
    .join('\n');

  let out = '';
  for (let i = 0; i < withoutMarkers.length; i++) {
    const ch = withoutMarkers[i];
    if (!isProjectionDroppedChar(ch)) {
      out += ch.toLowerCase();
    }
  }
  return out;
}
