/**
 * Shared inline @mention matching for chat message rendering
 * (ChatMessage, StickyMessageHeader).
 *
 * Matches:
 * - @context[provider|identifier|title] — context mentions (Linear, GitHub, etc.)
 * - @note/{noteId} — note mentions
 * - @{path} — file/folder mentions (paths with / or file extensions)
 *
 * The `@` must be at the start of the text or preceded by whitespace, so email
 * addresses like clement@shv.com stay plain text instead of rendering
 * `@shv.com` as a mention chip. Runs BEFORE URL linkification
 * (splitTextByUrls), which handles the remaining text segments.
 */

export interface InlineMentionMatch {
  /** Index of the `@` in the source text. */
  index: number;
  /** Full matched text including the `@`, e.g. "@note/spec". */
  fullMatch: string;
  /** Matched text without the `@`, e.g. "note/spec". */
  captured: string;
}

const MENTION_REGEX =
  /(?<!\S)@(context\[[^\]]+\]|note\/[^\s]+|[^\s@]+\.[a-zA-Z]+(?::[L\d-]+)?|[^\s@]*\/[^\s]+)/g;

/** Find all inline @mentions in `text`, in order of appearance. */
export function findInlineMentions(text: string): InlineMentionMatch[] {
  const matches: InlineMentionMatch[] = [];
  MENTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    matches.push({ index: match.index, fullMatch: match[0], captured: match[1] });
  }
  return matches;
}
