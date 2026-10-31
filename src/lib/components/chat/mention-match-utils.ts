/**
 * Shared inline @mention matching for chat message rendering
 * (ChatMessage, StickyMessageHeader).
 *
 * Matches:
 * - @context[provider|identifier|title] — context mentions (Linear, GitHub, etc.)
 * - @note[({workspaceId}/){noteId}:{title}] — note mentions (current form)
 * - @note/{noteId} — legacy note mentions
 * - @terminal[{id}:{name}], @script[{id}:{name}] — terminal and script mentions
 * - @{path} — file/folder mentions (paths with / or file extensions)
 *
 * The `@` must not be preceded by an email-local-part character (letters,
 * digits, `._%+-`), so email addresses like clement@shv.com and URL userinfo
 * like https://user@host/path stay plain text instead of rendering `@shv.com`
 * as a mention chip — while punctuation-adjacent mentions such as
 * `(@note/spec)` or `"@src/foo.rs"` (which the input typeahead can produce)
 * still chip. Runs BEFORE URL linkification (splitTextByUrls), which handles
 * the remaining text segments.
 *
 * Patterns and parsing come from the mention registry (`chat` surface).
 */

import {
  scanMentions,
  type ContextMention,
  type ParsedMention,
} from '$lib/services/mentions/registry';
import type { MentionCandidate } from '$lib/services/mentions/types';
import type { NoteMention } from '$lib/utils/note-mention-token';
import type { RuntimeMention } from '$lib/utils/runtime-mention-token';
import { m } from '$shared/paraglide/messages.js';

export interface InlineMentionMatch {
  /** Index of the `@` in the source text. */
  index: number;
  /** Full matched text including the `@`, e.g. "@note/spec". */
  fullMatch: string;
  /** Matched text without the `@`, e.g. "note/spec". */
  captured: string;
}

/** What the registry parsed each found match as (null when malformed). */
const parsedMatches = new WeakMap<InlineMentionMatch, ParsedMention | null>();

/** Find all inline @mentions in `text`, in order of appearance. */
export function findInlineMentions(text: string): InlineMentionMatch[] {
  return scanMentions(text, 'chat').map((match) => {
    const inline = { index: match.index, fullMatch: match.text, captured: match.text.slice(1) };
    parsedMatches.set(inline, match.parsed);
    return inline;
  });
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
  | { kind: 'runtime'; mention: RuntimeMention }
  | { kind: 'file'; path: string; line?: number; label: string };

function decodeContext(context: ContextMention): DecodedInlineMention {
  return {
    kind: 'context',
    provider: context.provider,
    identifier: context.identifier,
    title: context.title || context.identifier || m.chat_shared_context_fallback(),
    ...(context.url ? { url: context.url } : {}),
  };
}

/** Decode one {@link findInlineMentions} match into the mention it names. */
export function decodeInlineMention(match: InlineMentionMatch): DecodedInlineMention {
  const parsed = parsedMatches.has(match)
    ? parsedMatches.get(match)
    : (scanMentions(match.fullMatch, 'chat')[0]?.parsed ?? null);
  if (!parsed) return { kind: 'text' };
  switch (parsed.kind) {
    case 'member':
      return { kind: 'member', member: parsed.member };
    case 'context':
      return decodeContext(parsed.context);
    case 'note':
      return { kind: 'note', note: parsed.note, legacy: parsed.form === 'legacy' };
    case 'runtime':
      return { kind: 'runtime', mention: parsed.mention };
    case 'path': {
      // File/folder mention: @path/to/file.ext(:line), labelled by its last segment.
      const fileName = parsed.path.split('/').pop() || parsed.path;
      return {
        kind: 'file',
        path: parsed.path,
        ...(parsed.line !== undefined ? { line: parsed.line } : {}),
        label: `${fileName}${parsed.target.slice(parsed.path.length)}`,
      };
    }
    default:
      return { kind: 'text' };
  }
}
