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
): { title: string; body: string } | null {
  const leading = content.match(/^(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);
  const strongTitle = candidate.match(/^\*\*([^\r\n]+)\*\*[ \t]*(?:(?:\r\n|\n|\r)|$)/);
  if (!strongTitle) return null;

  const title = markdownInlineToPlainText(strongTitle[1]);
  if (!isShortTitleLike(strongTitle[0], title)) return null;
  return {
    title,
    body: bodyAfterHeading(content, leading.length + strongTitle[0].length),
  };
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

export function extractReasoningHeading(content: string): ReasoningHeading {
  const leading = content.match(/^(?:\uFEFF)?(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);

  const atx = candidate.match(
    /^[ \t]{0,3}#{1,6}[ \t]+([^\r\n]*?)(?:[ \t]+#+)?[ \t]*(?:\r\n|\n|\r|$)/,
  );
  if (atx) {
    const heading = markdownInlineToPlainText(atx[1]);
    if (heading) {
      return { heading, body: bodyAfterHeading(content, leading.length + atx[0].length) };
    }
  }

  const setext = candidate.match(
    /^([^\r\n]+)(?:\r\n|\n|\r)[ \t]{0,3}(?:=+|-+)[ \t]*(?:\r\n|\n|\r|$)/,
  );
  if (setext) {
    const heading = markdownInlineToPlainText(setext[1]);
    if (heading) {
      return { heading, body: bodyAfterHeading(content, leading.length + setext[0].length) };
    }
  }

  const shortTitle = candidate.match(/^([^\r\n]+)(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))+/);
  if (shortTitle) {
    const heading = markdownInlineToPlainText(shortTitle[1]);
    const body = content.slice(leading.length + shortTitle[0].length);
    if (body.trim() && isShortTitleLike(shortTitle[1], heading)) return { heading, body };
  }

  return { heading: null, body: content };
}
