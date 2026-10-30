/**
 * Shared inline @mention matching for chat message rendering
 * (ChatMessage, StickyMessageHeader).
 *
 * Matches:
 * - @context[provider|identifier|title] — context mentions (Linear, GitHub, etc.)
 * - @note[({workspaceId}/){noteId}:{title}] — note mentions (current form)
 * - @note/{noteId} — legacy note mentions
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

import type { MentionCandidate } from '$lib/services/mentions/types';
import { parseMemberMention } from '$lib/utils/member-mention-token';
import {
  NOTE_MENTION_BODY_SOURCE,
  parseNoteMention,
  type NoteMention,
} from '$lib/utils/note-mention-token';
import { m } from '$shared/paraglide/messages.js';
import { parseFilePathLineSuffix } from '$shared/utils/link-helpers';

export interface InlineMentionMatch {
  /** Index of the `@` in the source text. */
  index: number;
  /** Full matched text including the `@`, e.g. "@note/spec". */
  fullMatch: string;
  /** Matched text without the `@`, e.g. "note/spec". */
  captured: string;
}

const MENTION_REGEX = new RegExp(
  String.raw`(?<![A-Za-z0-9._%+-])@(member\[[^\]\s]*\]|context\[[^\]]+\]|` +
    NOTE_MENTION_BODY_SOURCE +
    String.raw`|note\/[^\s]+|[^\s@]+\.[a-zA-Z]+(?::\d+(?::\d+)?|#L\d+(?:-\d+)?|:L\d+(?:-\d+)?)?|[^\s@]*\/[^\s]+(?::\d+(?::\d+)?|#L\d+(?:-\d+)?)?)`,
  'g',
);

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

/**
 * What one inline match decodes to, before any store lookup or icon choice.
 * ChatMessage (and the mention contract test) read tokens through this, so the
 * chat bubble's interpretation of each token type lives in one testable place.
 */
export type DecodedInlineMention =
  /** Malformed token: render the matched text as plain text. */
  | { kind: 'text' }
  | { kind: 'member'; member: MentionCandidate }
  | { kind: 'context'; provider: string; identifier: string; title: string; url?: string }
  /** `legacy` is the whitespace-delimited `@note/<id>` form (no saved title). */
  | { kind: 'note'; note: NoteMention; legacy: boolean }
  | { kind: 'file'; path: string; line?: number; label: string };

function decodeContextMention(captured: string): DecodedInlineMention {
  // @context[provider|identifier|title] or @context[base64JSON]
  const inner = captured.slice(8, -1);
  const fromPipes = () => {
    const parts = inner.split('|');
    const identifier = parts[1] || '';
    return { provider: parts[0] || 'browser', identifier, title: parts[2] || identifier };
  };
  // Base64-encoded JSON starts with `eyJ` (`{"`).
  if (inner.startsWith('eyJ')) {
    try {
      const json = JSON.parse(atob(inner));
      const identifier = json.identifier || '';
      return {
        kind: 'context',
        provider: json.provider || 'browser',
        identifier,
        title: json.title || identifier || m.chat_shared_context_fallback(),
        url: json.url,
      };
    } catch {
      return { kind: 'context', ...fromPipes() };
    }
  }
  return { kind: 'context', ...fromPipes() };
}

/** Decode one {@link findInlineMentions} match into the mention it names. */
export function decodeInlineMention(match: InlineMentionMatch): DecodedInlineMention {
  const { captured, fullMatch } = match;
  if (captured.startsWith('member[')) {
    const member = parseMemberMention(fullMatch);
    return member ? { kind: 'member', member } : { kind: 'text' };
  }
  if (captured.startsWith('context[')) return decodeContextMention(captured);
  if (captured.startsWith('note[')) {
    const note = parseNoteMention(captured);
    return note ? { kind: 'note', note, legacy: false } : { kind: 'text' };
  }
  if (captured.startsWith('note/')) {
    const id = captured.slice(5);
    return { kind: 'note', note: { id, title: id }, legacy: true };
  }
  // File/folder mention: @path/to/file.ext(:line)
  const { path, line } = parseFilePathLineSuffix(captured);
  const fileName = path.split('/').pop() || path;
  return { kind: 'file', path, line, label: `${fileName}${captured.slice(path.length)}` };
}
