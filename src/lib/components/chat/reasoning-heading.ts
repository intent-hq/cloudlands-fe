export interface ReasoningHeading {
  heading: string | null;
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
    .replace(/[*_~]/g, '')
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
