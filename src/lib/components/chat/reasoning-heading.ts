export interface ReasoningHeading {
  heading: string | null;
  body: string;
}

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

export function extractReasoningHeading(content: string): ReasoningHeading {
  const atx = content.match(
    /^(?:\uFEFF)?[ \t]{0,3}#{1,6}[ \t]+([^\r\n]*?)[ \t]*#*[ \t]*(?:\r?\n|$)/,
  );
  if (atx) {
    const heading = markdownInlineToPlainText(atx[1]);
    if (heading) return { heading, body: content.slice(atx[0].length).replace(/^\r?\n/, '') };
  }

  const setext = content.match(/^([^\r\n]+)\r?\n[ \t]{0,3}(?:=+|-+)[ \t]*(?:\r?\n|$)/);
  if (setext) {
    const heading = markdownInlineToPlainText(setext[1]);
    if (heading) return { heading, body: content.slice(setext[0].length).replace(/^\r?\n/, '') };
  }

  return { heading: null, body: content };
}
