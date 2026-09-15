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

/**
 * `[label](url)` where the label has no brackets or newlines and the
 * destination has no whitespace or angle brackets. One level of balanced
 * parentheses is allowed inside the destination so wikipedia-style URLs
 * (`…/Foo_(bar)`) survive; anything deeper stays literal.
 */
const INLINE_LINK_REGEX = /\[([^[\]\n]+)\]\(((?:[^\s()<>]|\([^\s()<>]*\))+)\)/g;

const LINK_URL_SCHEME_REGEX = /^(?:https?|intent):\/\//i;

/**
 * Split a prompt into alternating text and link parts. Text parts preserve
 * whitespace; rebuilding `[label](url)` for link parts and concatenating all
 * parts in order reproduces the input exactly.
 */
export function splitPromptMarkdownLinks(prompt: string): PromptMarkdownLinkPart[] {
  const parts: PromptMarkdownLinkPart[] = [];
  let lastIndex = 0;
  INLINE_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_LINK_REGEX.exec(prompt)) !== null) {
    const [source, label, url] = match;
    const isImage = match.index > 0 && prompt[match.index - 1] === '!';
    if (isImage || label.trim().length === 0 || !LINK_URL_SCHEME_REGEX.test(url)) {
      INLINE_LINK_REGEX.lastIndex = match.index + 1;
      continue;
    }
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: prompt.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'link', label, url });
    lastIndex = match.index + source.length;
  }
  if (lastIndex < prompt.length) {
    parts.push({ type: 'text', content: prompt.slice(lastIndex) });
  }
  return parts;
}

/** The text a user sees for a prompt: link labels in place of their markdown. */
export function promptVisibleText(prompt: string): string {
  return splitPromptMarkdownLinks(prompt)
    .map((part) => (part.type === 'link' ? part.label : part.content))
    .join('');
}
