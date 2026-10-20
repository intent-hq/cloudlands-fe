import { Lexer, type Token } from 'marked';
import type { DiscussionAgentMention } from './discussion-agent-mentions';
import { parseDiscussionReference, type DiscussionReference } from './discussion-references';

export type DiscussionMessagePart =
  string | DiscussionReference | (DiscussionAgentMention & { kind: 'mention' });

function literalRanges(body: string) {
  const ranges: { start: number; end: number }[] = [];
  function walk(tokens: readonly Token[], text: string, base: number) {
    let cursor = 0;
    for (const token of tokens) {
      const offset = text.indexOf(token.raw, cursor);
      if (offset < 0) continue;
      cursor = offset + token.raw.length;
      if (token.type === 'code' || token.type === 'codespan' || token.type === 'html') {
        ranges.push({ start: base + offset, end: base + cursor });
      } else if ('tokens' in token && Array.isArray(token.tokens)) {
        walk(token.tokens, token.raw, base + offset);
      } else if (token.type === 'list') {
        walk(token.items, token.raw, base + offset);
      }
    }
  }
  walk(Lexer.lex(body), body, 0);
  return ranges;
}

/** Only retained, exact mention spans carry a person's agent selection into presentation. */
export function discussionMessageParts(
  body: string,
  workspaceId: string,
  mentions: readonly DiscussionAgentMention[] = [],
): DiscussionMessagePart[] {
  const ranges: { start: number; end: number; part: Exclude<DiscussionMessagePart, string> }[] = [];
  const literals = literalRanges(body);
  for (const match of body.matchAll(/\[([^\]\n]{1,200})\]\(([^\s)]+)\)/g)) {
    const reference = parseDiscussionReference(match[2], match[1], workspaceId);
    if (
      reference &&
      !literals.some(
        (range) => match.index < range.end && match.index + match[0].length > range.start,
      )
    )
      ranges.push({ start: match.index, end: match.index + match[0].length, part: reference });
  }
  for (const mention of mentions) {
    if (
      !Number.isSafeInteger(mention.start) ||
      !Number.isSafeInteger(mention.end) ||
      mention.start < 0 ||
      mention.end > body.length ||
      mention.end <= mention.start ||
      !mention.name ||
      /\p{Cc}/u.test(mention.name) ||
      !/^[A-Za-z0-9_-]+$/.test(mention.agentId) ||
      body.slice(mention.start, mention.end) !== `@${mention.name}` ||
      (mention.start > 0 && !/\s/.test(body[mention.start - 1])) ||
      (mention.end < body.length && !/[\s.,!?;:]/.test(body[mention.end])) ||
      [...literals, ...ranges].some(
        (range) => mention.start < range.end && mention.end > range.start,
      )
    )
      continue;
    ranges.push({ start: mention.start, end: mention.end, part: { ...mention, kind: 'mention' } });
  }
  ranges.sort((a, b) => a.start - b.start);
  const parts: DiscussionMessagePart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) parts.push(body.slice(cursor, range.start));
    parts.push(range.part);
    cursor = range.end;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

function escapeLabel(value: string) {
  return value.replace(/[\\`*_{}[\]<>()!|]/g, '\\$&');
}

/** Feed the existing sanitized read-only renderer, never generate raw HTML. */
export function discussionMessageMarkdown(
  parts: readonly DiscussionMessagePart[],
  workspaceId: string,
) {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.kind !== 'mention') return '';
      const label = escapeLabel(`@${part.name}`);
      const url = `intent://local/${workspaceId}/agent/${part.agentId}`;
      return parseDiscussionReference(url, part.name, workspaceId) ? `[${label}](${url})` : label;
    })
    .join('')
    .trim();
}

export function discussionReplyFirstLine(body: string) {
  return (
    body
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
}
