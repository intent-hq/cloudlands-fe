/**
 * Terminal and script mention prompt tokens: `@terminal[<id>:<name>]` and
 * `@script[<id>:<name>]`.
 *
 * Same grammar as note tokens (note-mention-token.ts): the id is
 * authoritative, the name is the readable label, and the bracketed form keeps
 * a multi-word name inside one whitespace-safe token. The legacy
 * `@terminal/<name>` form saved no id and ended at the first space, so
 * "Build server" read back as a file chip "terminal/Build" followed by plain
 * " server". Legacy tokens are left to the existing path matchers so old
 * messages render unchanged.
 *
 * Terminal and script mentions always name the current workspace, so the
 * token carries no workspace segment.
 */
import { sanitizeMentionTitle } from './note-mention-token';

export type RuntimeMentionKind = 'terminal' | 'script';

export interface RuntimeMention {
  kind: RuntimeMentionKind;
  id: string;
  name: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Regex source (no flags, no groups) matching a whole token body after the `@`. */
export const RUNTIME_MENTION_BODY_SOURCE = String.raw`(?:terminal|script)\[[A-Za-z0-9_-]+:[^[\]\n]*\]`;

const PARSE_RE = /^@?(terminal|script)\[([A-Za-z0-9_-]+):([^[\]\n]*)\]$/;

/**
 * Serialize a terminal or script mention. Returns null when the id is not
 * token-safe so the caller can fall back to plain text.
 */
export function serializeRuntimeMention(mention: RuntimeMention): string | null {
  if (!SAFE_ID.test(mention.id)) return null;
  const name = sanitizeMentionTitle(mention.name) || mention.id;
  return `@${mention.kind}[${mention.id}:${name}]`;
}

/** Parse a `@terminal[...]` / `@script[...]` token (leading `@` optional); null if malformed. */
export function parseRuntimeMention(token: string): RuntimeMention | null {
  const match = PARSE_RE.exec(token);
  if (!match) return null;
  const [, kind, id, rawName] = match;
  return { kind: kind as RuntimeMentionKind, id, name: rawName.trim() || id };
}

/** Mention-chip attributes for a parsed token (note editor / markdown chips). */
export function runtimeMentionChipAttrs(mention: RuntimeMention): {
  type: RuntimeMentionKind;
  id: string;
  label: string;
} {
  return { type: mention.kind, id: mention.id, label: mention.name };
}

const RUNTIME_MENTION_GLOBAL = new RegExp(`@${RUNTIME_MENTION_BODY_SOURCE}`, 'g');

/** Plain-text previews: render each terminal/script token as `@<name>`. */
export function runtimeMentionsToText(text: string): string {
  return text.replace(RUNTIME_MENTION_GLOBAL, (token) => {
    const mention = parseRuntimeMention(token);
    return mention ? `@${mention.name}` : token;
  });
}
