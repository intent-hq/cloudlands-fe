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
const GENERIC_REASONING_HEADING = /^(?:reasoning|thinking)[\s.,!?;:…—–-]*$/i;

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

function isPlainShortHeadingLike(rawLine: string, plainText: string): boolean {
  if (!isShortTitleLike(rawLine, plainText) || !/^[A-Z0-9]/.test(plainText)) return false;
  return !/^(?:I|we|you|he|she|it|they|this|that|these|those|there|here)\b/i.test(plainText);
}

export function isGenericReasoningHeading(heading: string): boolean {
  return GENERIC_REASONING_HEADING.test(heading.trim());
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

function extractLeadingGenericReasoningHeading(content: string): ReasoningHeading | null {
  const leading = content.match(/^(?:\uFEFF)?(?:[ \t]*(?:\r\n|\n|\r))*/)?.[0] ?? '';
  const candidate = content.slice(leading.length);
  const shortTitle = candidate.match(/^([^\r\n]+)(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))+/);
  if (!shortTitle) return null;

  const heading = markdownInlineToPlainText(shortTitle[1]);
  const body = content.slice(leading.length + shortTitle[0].length);
  return body.trim() && isGenericReasoningHeading(heading) ? { heading, body } : null;
}

export function extractReasoningDisclosureHeading(content: string): ReasoningHeading {
  const first = extractLeadingGenericReasoningHeading(content) ?? extractReasoningHeading(content);
  if (!first.heading || !isGenericReasoningHeading(first.heading)) return first;

  let remainder = first.body;
  while (remainder) {
    const next = extractLeadingStrongReasoningTitle(remainder);
    if (!next) return first;
    if (!isGenericReasoningHeading(next.title)) return { heading: next.title, body: next.body };
    remainder = next.body;
  }
  return first;
}

export function extractReasoningHistory(content: string): ReasoningHistoryItem[] {
  const lines = Array.from(content.matchAll(/.*(?:\r\n|\n|\r|$)/g))
    .map((match) => ({ raw: match[0].replace(/(?:\r\n|\n|\r)$/, ''), start: match.index }))
    .filter((line, index, all) => line.raw || index < all.length - 1);
  const headings: Array<{ title: string; start: number; end: number }> = [];
  let fenced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[ \t]{0,3}(?:```|~~~)/.test(line.raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || (index > 0 && lines[index - 1].raw.trim())) continue;

    const next = lines[index + 1];
    const atx = line.raw.match(/^[ \t]{0,3}#{1,6}[ \t]+([^\r\n]*?)(?:[ \t]+#+)?[ \t]*$/);
    const strong = line.raw.match(/^[ \t]*\*\*([^\r\n]+)\*\*[ \t]*$/);
    const setext = next && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(next.raw) ? line.raw : null;
    const plain = next?.raw.trim() === '' || !next ? line.raw : null;
    const rawTitle = atx?.[1] ?? strong?.[1] ?? setext ?? plain;
    if (rawTitle === null || rawTitle === undefined) continue;

    const title = markdownInlineToPlainText(rawTitle);
    const explicitHeading = Boolean(atx || strong || setext);
    if (
      !(explicitHeading
        ? isShortTitleLike(line.raw, title)
        : isPlainShortHeadingLike(line.raw, title))
    ) {
      continue;
    }
    const endLine = setext ? next : line;
    headings.push({ title, start: line.start, end: endLine.start + endLine.raw.length });
    if (setext) index += 1;
  }

  if (headings.length === 0) {
    const candidate = content.trim();
    const title = markdownInlineToPlainText(candidate);
    if (!candidate.includes('\n') && isPlainShortHeadingLike(candidate, title)) {
      return [{ title, body: '' }];
    }
    return candidate ? [{ title: null, body: candidate }] : [];
  }

  const items: ReasoningHistoryItem[] = [];
  const leadingBody = content.slice(0, headings[0].start).trim();
  if (leadingBody) items.push({ title: null, body: leadingBody });
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    items.push({
      title: heading.title,
      body: content.slice(heading.end, headings[index + 1]?.start).trim(),
    });
  }
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
    if (body.trim() && isPlainShortHeadingLike(shortTitle[1], heading)) return { heading, body };
  }

  return { heading: null, body: content };
}
