/**
 * Pure string-based mention injection for HTML.
 *
 * Converts canonical @-tokens to <span data-mention> elements so TipTap
 * re-parses them as mention nodes. Token patterns, parsing and chip
 * attributes come from the mention registry; this module only emits them as
 * HTML strings (the note editor emits the same elements as DOM).
 *
 * This module is intentionally free of DOM dependencies so it can run in
 * a Web Worker as well as on the main thread.
 */

import { mentionElement, scanMentions } from '$lib/services/mentions/registry';

// --- Helper: escape HTML attribute values ---
const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Helper: decode the entities escAttr produces (HTML text -> plain text) ---
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};
const unescapeHtmlText = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body] ?? entity;
  });

// --- Process a text segment: replace each registry match with its element ---
function processText(text: string): string {
  const parts: string[] = [];
  let idx = 0;
  // Input is HTML text, so entities in titles and names are still escaped.
  for (const match of scanMentions(text, 'markdown', { decode: unescapeHtmlText })) {
    if (match.index > idx) parts.push(text.slice(idx, match.index));
    const element = match.parsed ? mentionElement(match.parsed) : null;
    if (element) {
      const attributes = element.attributes
        .map(([name, value]) => ` ${name}="${escAttr(value)}"`)
        .join('');
      parts.push(`<span${attributes} class="${element.className}">${escAttr(element.text)}</span>`);
    } else {
      // Malformed token or a non-note link: keep the original text.
      parts.push(match.text);
    }
    idx = match.index + match.text.length;
  }
  if (idx < text.length) parts.push(text.slice(idx));
  return parts.join('');
}

// --- Blocked tags whose content should not be processed ---
const BLOCK_TAGS = new Set(['code', 'pre', 'script', 'style', 'a']);

/**
 * Inject mention chips into HTML by converting canonical @-tokens to
 * `<span data-mention>` elements so TipTap re-parses them as mention nodes.
 *
 * - Skips inside code/pre/script/style/a tags, existing data-mention spans and math
 * - Pure string-based implementation (no DOM required) for performance
 */
export function injectMentionSpans(html: string): string {
  const result: string[] = [];
  let i = 0;
  // Stack of open blocked tags (lowercase tag names)
  const blockStack: string[] = [];

  while (i < html.length) {
    if (html[i] === '<') {
      // Find end of tag
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        // Malformed — append rest as-is
        result.push(html.slice(i));
        break;
      }
      const tag = html.slice(i, tagEnd + 1);

      // Check if this is a closing tag
      const closeMatch = tag.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (closeMatch) {
        const tagName = closeMatch[1].toLowerCase();
        // Pop from block stack if it matches
        if (blockStack.length > 0 && blockStack[blockStack.length - 1] === tagName) {
          blockStack.pop();
        }
        result.push(tag);
        i = tagEnd + 1;
        continue;
      }

      // Check if this is an opening tag
      const openMatch = tag.match(/^<\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (openMatch) {
        const tagName = openMatch[1].toLowerCase();
        const isSelfClosing = tag.endsWith('/>');
        const isBlocked =
          BLOCK_TAGS.has(tagName) ||
          tag.includes('data-mention') ||
          tag.includes('data-math-source');

        if (isBlocked && !isSelfClosing) {
          blockStack.push(tagName);
        }
      }

      result.push(tag);
      i = tagEnd + 1;
    } else {
      // Text content — find the next tag
      const nextTag = html.indexOf('<', i);
      const textEnd = nextTag === -1 ? html.length : nextTag;
      const text = html.slice(i, textEnd);

      if (blockStack.length === 0 && text.length > 0) {
        // Not inside a blocked region — process mentions
        result.push(processText(text));
      } else {
        result.push(text);
      }
      i = textEnd;
    }
  }

  return result.join('');
}
