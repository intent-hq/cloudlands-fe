/**
 * Shared inline @mention matching for chat message rendering
 * (ChatMessage, StickyMessageHeader).
 *
 * Matches:
 * - @context[provider|identifier|title] — context mentions (Linear, GitHub, etc.)
 * - @note/{noteId} — note mentions
 * - @{path} — file/folder mentions (paths with / or file extensions)
 *
 * The `@` must not be preceded by an email-local-part character (letters,
 * digits, `._%+-`), so email addresses like clement@shv.com and URL userinfo
 * like https://user@host/path stay plain text instead of rendering `@shv.com`
 * as a mention chip — while punctuation-adjacent mentions such as
 * `(@note/spec)` or `"@src/foo.rs"` (which the input typeahead can produce)
 * still chip. Runs BEFORE URL linkification (splitTextByUrls), which handles
 * the remaining text segments.
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
  /(?<![A-Za-z0-9._%+-])@(context\[[^\]]+\]|note\/[^\s]+|[^\s@]+\.[a-zA-Z]+(?::\d+(?::\d+)?|#L\d+(?:-\d+)?|:L\d+(?:-\d+)?)?|[^\s@]*\/[^\s]+(?::\d+(?::\d+)?|#L\d+(?:-\d+)?)?)/g;

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
