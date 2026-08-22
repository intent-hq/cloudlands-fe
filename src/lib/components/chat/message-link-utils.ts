/**
 * Utilities for detecting URLs inside plain-text segments of user messages.
 *
 * Only URLs with an explicit protocol (http://, https://, intent://) are
 * linkified — emails and bare TLD-like words (e.g. "healthcheck.rs") are left
 * as plain text. Runs AFTER mention parsing, on the remaining text segments.
 */

export type TextLinkPart = { type: 'text'; content: string } | { type: 'link'; url: string };

const URL_REGEX = /(?:https?|intent):\/\/[^\s<>]+/g;

/**
 * Characters that are almost certainly trailing punctuation, not part of the
 * URL. Includes markdown wrappers (backtick, `*`, `~`) users often put around
 * URLs in plain-text messages.
 */
const TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
  '`',
  '*',
  '~',
  '\u2019',
  '\u201d',
]);

/** Closing bracket → its opening counterpart, for balance-aware trimming. */
const CLOSING_BRACKETS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count++;
  return count;
}

/**
 * Trim trailing punctuation that is part of the surrounding sentence rather
 * than the URL. Closing brackets are only trimmed when unbalanced, so URLs
 * like https://en.wikipedia.org/wiki/Foo_(bar) stay intact.
 */
function trimTrailingPunctuation(url: string): string {
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (TRAILING_PUNCTUATION.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opening = CLOSING_BRACKETS[last];
    if (opening && countChar(url, last) > countChar(url, opening)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

/**
 * Split plain text into alternating text and link parts. Text parts preserve
 * all whitespace/newlines; concatenating all parts reproduces the input.
 */
export function splitTextByUrls(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = trimTrailingPunctuation(match[0]);
    // A bare protocol with nothing after it is not a link
    if (/^(?:https?|intent):\/\/$/.test(url)) continue;
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'link', url });
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return parts;
}
