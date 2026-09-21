/**
 * Utilities for the markdown `[label](url)` links agents may put in
 * suggested prompts (e.g. PR references).
 *
 * Only well-formed inline links with a non-empty label and an `http://`,
 * `https://` or `intent://` destination become links. Everything else —
 * bare URLs, bare `#N`, other schemes (`javascript:`, `mailto:`), images
 * (`![alt](url)`), reference-style links, unbalanced brackets — stays literal
 * text. The prompt string itself is never rewritten: the raw markdown is what
 * gets sent when the row is selected.
 */

export type PromptMarkdownLinkPart =
  { type: 'text'; content: string } | { type: 'link'; label: string; url: string };

const LINK_URL_SCHEME_REGEX = /^(?:https?|intent):\/\//i;
const URL_SCHEME_PREFIX_REGEX = /^[a-z][a-z0-9+.-]*(?=:\/\/)/i;

interface BracketConstruct {
  /** Index just past the construct (or past the literal span it collapses to). */
  end: number;
  label: string;
  /** Destination of a complete `[label](url)` construct; `null` when there is none. */
  url: string | null;
}

/**
 * Scan the bracket construct opening at `open`. Nested brackets are tracked so a
 * rejected outer construct (`[[label]](url)`, `![alt [inner](url)](img)`) is
 * consumed whole and its inner content is never re-scanned. A bracket that
 * never closes swallows the rest of its line as literal text.
 */
function scanBracketConstruct(prompt: string, open: number): BracketConstruct {
  let depth = 0;
  let close = open;
  for (; close < prompt.length; close++) {
    const ch = prompt[close];
    if (ch === '\n') return { end: close, label: '', url: null };
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) break;
  }
  if (close >= prompt.length) return { end: prompt.length, label: '', url: null };
  const label = prompt.slice(open + 1, close);
  if (prompt[close + 1] !== '(') return { end: close + 1, label, url: null };
  const destination = scanDestination(prompt, close + 2);
  if (destination === null) return { end: close + 1, label, url: null };
  return { end: destination.end, label, url: destination.url };
}

/**
 * Destination has no whitespace or angle brackets. One level of balanced
 * parentheses is allowed so wikipedia-style URLs (`…/Foo_(bar)`) survive;
 * anything deeper, empty, or unclosed is not a destination.
 */
function scanDestination(prompt: string, start: number): { url: string; end: number } | null {
  let depth = 0;
  let i = start;
  for (; i < prompt.length; i++) {
    const ch = prompt[i];
    if (ch === '<' || ch === '>' || /\s/.test(ch)) return null;
    if (ch === '(') {
      if (depth > 0) return null;
      depth++;
    } else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
  }
  if (i >= prompt.length || i === start) return null;
  return { url: prompt.slice(start, i), end: i + 1 };
}

function isLinkLabel(label: string): boolean {
  return label.trim().length > 0 && !/[[\]\n]/.test(label);
}

/**
 * Split a prompt into alternating text and link parts. Text parts preserve
 * whitespace; rebuilding `[label](url)` for link parts and concatenating all
 * parts in order reproduces the input exactly.
 */
export function splitPromptMarkdownLinks(prompt: string): PromptMarkdownLinkPart[] {
  const parts: PromptMarkdownLinkPart[] = [];
  let textStart = 0;
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] !== '[') {
      i++;
      continue;
    }
    const construct = scanBracketConstruct(prompt, i);
    const isImage = i > 0 && prompt[i - 1] === '!';
    if (
      construct.url !== null &&
      !isImage &&
      isLinkLabel(construct.label) &&
      LINK_URL_SCHEME_REGEX.test(construct.url)
    ) {
      if (i > textStart) {
        parts.push({ type: 'text', content: prompt.slice(textStart, i) });
      }
      parts.push({ type: 'link', label: construct.label, url: construct.url });
      textStart = construct.end;
    }
    i = Math.max(construct.end, i + 1);
  }
  if (textStart < prompt.length) {
    parts.push({ type: 'text', content: prompt.slice(textStart) });
  }
  return parts;
}

/**
 * The URL to route a prompt link through `handleLink`: the scheme is lowercased
 * so `HTTPS://` / `INTENT://` links take the same path as their lowercase
 * spelling. The raw prompt string is never rewritten.
 */
export function promptLinkRoutingUrl(url: string): string {
  return url.replace(URL_SCHEME_PREFIX_REGEX, (scheme) => scheme.toLowerCase());
}

/** The text a user sees for a prompt: link labels in place of their markdown. */
export function promptVisibleText(prompt: string): string {
  return splitPromptMarkdownLinks(prompt)
    .map((part) => (part.type === 'link' ? part.label : part.content))
    .join('');
}
