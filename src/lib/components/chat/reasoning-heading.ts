import { Marked } from 'marked';
import { strikethroughDoubleTilde } from '$lib/utils/marked-strikethrough';

export interface ReasoningHeading {
  heading: string | null;
  body: string;
}

export interface ReasoningHistoryItem {
  title: string | null;
  body: string;
}

const MAX_TITLE_CHARACTERS = 80;
const MAX_TITLE_WORDS = 10;

const inlineMarkdown = new Marked(strikethroughDoubleTilde, {
  renderer: {
    image({ tokens }) {
      return this.parser.parseInline(tokens);
    },
  },
});

function markdownInlineToReadableText(value: string): string {
  // The inert template decodes entities after Markdown has protected code and escapes.
  // Only its text is returned; the parsed HTML is never mounted.
  const template = document.createElement('template');
  template.innerHTML = inlineMarkdown.parseInline(value, { async: false });
  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function markdownInlineToPlainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*?)`+/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
    .replace(/[*~]/g, '')
    .replace(/(^|[^A-Za-z0-9])_+/g, '$1')
    .replace(/_+([^A-Za-z0-9]|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyAfterHeading(content: string, end: number): string {
  return content.slice(end).replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, '');
}

function isShortTitleLike(rawLine: string, plainText: string): boolean {
  if (!plainText || plainText.length > MAX_TITLE_CHARACTERS) return false;
  if (plainText.split(/\s+/).length > MAX_TITLE_WORDS) return false;
  if (/[.!?;]$/.test(plainText)) return false;
  // i18n-ignore (Markdown block syntax, not display text)
  return !/^[ \t]*(?:[-+*][ \t]+|\d+[.)][ \t]+|>|```|~~~|\|)/.test(rawLine);
}

export function extractStandaloneReasoningTitle(content: string): string | null {
  const candidate = content.trim();
  const strongTitle = candidate.match(/^\*\*([^\r\n]+)\*\*$/);
  if (!strongTitle) return null;

  const title = markdownInlineToPlainText(strongTitle[1]);
  return isShortTitleLike(strongTitle[0], title) ? title : null;
}

function extractLeadingStrongReasoningTitle(
  content: string,
  singleSpanOnly = false,
): { title: string; body: string } | null {
  const leading = content.match(/^(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);
  const strongTitle = candidate.match(/^\*\*([^\r\n]+)\*\*[ \t]*(?:(?:\r\n|\n|\r)|$)/);
  if (!strongTitle) return null;
  if (singleSpanOnly) {
    const inner = strongTitle[1];
    const trailingBackslashes = inner.match(/\\+$/)?.[0].length ?? 0;
    if (
      inner !== inner.trim() ||
      inner.includes('**') ||
      inner.startsWith('*') ||
      inner.endsWith('*') ||
      trailingBackslashes % 2 !== 0
    ) {
      return null;
    }
  }

  const title = markdownInlineToPlainText(strongTitle[1]);
  if (!isShortTitleLike(strongTitle[0], title)) return null;
  return {
    title: singleSpanOnly ? markdownInlineToReadableText(strongTitle[1]) : title,
    body: bodyAfterHeading(content, leading.length + strongTitle[0].length),
  };
}

/** Null retains the body disclosure; plain-line history titles never qualify. */
export function extractStandaloneReasoningTitles(content: string): string[] | null {
  const titles: string[] = [];
  let remainder = content;

  while (remainder.trim()) {
    const markdown = extractMarkdownReasoningHeading(remainder, true, markdownInlineToReadableText);
    const explicit = markdown.heading
      ? { title: markdown.heading, body: markdown.body }
      : extractLeadingStrongReasoningTitle(remainder, true);
    if (!explicit) return null;
    titles.push(explicit.title);
    remainder = explicit.body;
  }

  return titles.length ? titles : null;
}

export function extractReasoningHistory(content: string): ReasoningHistoryItem[] {
  const reasoning = extractReasoningHeading(content);
  const items: ReasoningHistoryItem[] = [];
  let remainder = content;

  if (reasoning.heading) {
    items.push({ title: reasoning.heading, body: '' });
    remainder = reasoning.body;
  }

  while (remainder) {
    const strongTitle = extractLeadingStrongReasoningTitle(remainder);
    if (!strongTitle || strongTitle.body.length >= remainder.length) break;
    items.push({ title: strongTitle.title, body: '' });
    remainder = strongTitle.body;
  }

  if (items.length === 0) {
    const candidate = content.trim();
    const title = markdownInlineToPlainText(candidate);
    if (!candidate.includes('\n') && isShortTitleLike(candidate, title)) {
      return [{ title, body: '' }];
    }
    return candidate ? [{ title: null, body: candidate }] : [];
  }

  items[items.length - 1].body = remainder.trim();
  return items;
}

function isStandaloneSetextTitle(line: string): boolean {
  const candidate = line.replace(/^ {0,3}/, '');
  // These start other Markdown blocks, even when a horizontal rule follows.
  return (
    !/^(?:\s|>|`{3}|~{3}|(?:[-+*]|\d+[.)])(?:[ \t]|$)|#{1,6}(?:[ \t]|$)|<|\[[^\]]*\]:)/.test(
      candidate,
    ) && !/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(candidate)
  );
}

function extractMarkdownReasoningHeading(
  content: string,
  standaloneOnly = false,
  projectInline = markdownInlineToPlainText,
): ReasoningHeading {
  const leading = content.match(/^(?:\uFEFF)?(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);
  if (standaloneOnly && /^(?: {4}| {0,3}\t)/.test(candidate)) {
    return { heading: null, body: content };
  }

  const atx = candidate.match(
    /^[ \t]{0,3}#{1,6}[ \t]+([^\r\n]*?)(?:[ \t]+#+)?[ \t]*(?:\r\n|\n|\r|$)/,
  );
  if (atx) {
    const heading = markdownInlineToPlainText(atx[1]);
    if (heading) {
      return {
        heading: projectInline(atx[1]),
        body: bodyAfterHeading(content, leading.length + atx[0].length),
      };
    }
  }

  const setext = candidate.match(
    /^([^\r\n]+)(?:\r\n|\n|\r)([ \t]{0,3})(?:=+|-+)[ \t]*(?:\r\n|\n|\r|$)/,
  );
  if (
    setext &&
    (!standaloneOnly || (isStandaloneSetextTitle(setext[1]) && !setext[2].includes('\t')))
  ) {
    const heading = markdownInlineToPlainText(setext[1]);
    if (heading) {
      return {
        heading: projectInline(setext[1]),
        body: bodyAfterHeading(content, leading.length + setext[0].length),
      };
    }
  }

  return { heading: null, body: content };
}

export function extractReasoningHeading(
  content: string,
  { preserveInlineText = false }: { preserveInlineText?: boolean } = {},
): ReasoningHeading {
  const projectInline = preserveInlineText
    ? markdownInlineToReadableText
    : markdownInlineToPlainText;
  const markdown = extractMarkdownReasoningHeading(content, false, projectInline);
  if (markdown.heading) return markdown;

  const leading = content.match(/^(?:\uFEFF)?(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);
  const shortTitle = candidate.match(/^([^\r\n]+)(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))+/);
  if (shortTitle) {
    const heading = markdownInlineToPlainText(shortTitle[1]);
    const body = content.slice(leading.length + shortTitle[0].length);
    if (body.trim() && isShortTitleLike(shortTitle[1], heading)) {
      return { heading: projectInline(shortTitle[1]), body };
    }
  }

  return { heading: null, body: content };
}
