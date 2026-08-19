import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

const INLINE_TAGS = new Map([
  ['STRONG', 'strong'],
  ['B', 'strong'],
  ['EM', 'em'],
  ['I', 'em'],
  ['CODE', 'code'],
]);

const OMITTED_TAGS = new Set([
  'AUDIO',
  'BUTTON',
  'CANVAS',
  'DETAILS',
  'EMBED',
  'HR',
  'IFRAME',
  'IMG',
  'INPUT',
  'OBJECT',
  'PICTURE',
  'PRE',
  'SELECT',
  'SVG',
  'TABLE',
  'TEXTAREA',
  'VIDEO',
]);

const BLOCK_TAGS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DT',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'P',
  'SECTION',
]);

interface RenderState {
  visibleLength: number;
  hasText: boolean;
  lastWasSpace: boolean;
  truncated: boolean;
}

function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      ({ segment }) => segment,
    );
  }
  return Array.from(text);
}

function appendText(target: HTMLElement, text: string, limit: number, state: RenderState): void {
  for (const grapheme of splitGraphemes(text.replace(/\s+/gu, ' '))) {
    const isSpace = grapheme === ' ';
    if (isSpace && (!state.hasText || state.lastWasSpace)) continue;
    if (state.visibleLength >= limit) {
      if (isSpace) return;
      if (!state.truncated) target.append(document.createTextNode('…'));
      state.truncated = true;
      return;
    }
    target.append(document.createTextNode(grapheme));
    state.visibleLength += 1;
    state.hasText = true;
    state.lastWasSpace = isSpace;
  }
}

function appendNode(source: Node, target: HTMLElement, limit: number, state: RenderState): void {
  if (state.truncated) return;
  if (source.nodeType === Node.TEXT_NODE) {
    appendText(target, source.textContent ?? '', limit, state);
    return;
  }
  if (!(source instanceof HTMLElement)) return;

  if (OMITTED_TAGS.has(source.tagName)) return;
  if (source.tagName === 'BR') {
    appendText(target, ' ', limit, state);
    return;
  }

  const inlineTag = INLINE_TAGS.get(source.tagName);
  if (inlineTag) {
    const inline = document.createElement(inlineTag);
    target.append(inline);
    for (const child of source.childNodes) appendNode(child, inline, limit, state);
    if (!inline.textContent) inline.remove();
    return;
  }

  if (BLOCK_TAGS.has(source.tagName) && state.hasText) appendText(target, ' ', limit, state);
  for (const child of source.childNodes) appendNode(child, target, limit, state);
}

/** Parse and sanitize with the shared Markdown pipeline, then keep inert inline semantics only. */
export async function renderInlineMarkdownSnippet(
  content: string,
  maxVisibleCharacters = 80,
): Promise<string> {
  const sanitizedHTML = await processMarkdownToHTML(content, {
    allowEmpty: true,
    skipIfHTML: false,
    preserveAnchors: false,
    processPrimitives: false,
    taskBlockRenderMode: 'content',
  });
  const source = document.createElement('template');
  source.innerHTML = sanitizedHTML;
  const output = document.createElement('span');
  const state: RenderState = {
    visibleLength: 0,
    hasText: false,
    lastWasSpace: false,
    truncated: false,
  };
  const limit = Math.max(0, Math.floor(maxVisibleCharacters));
  for (const child of source.content.childNodes) appendNode(child, output, limit, state);
  return output.innerHTML.trim();
}

/** Return the sanitized inline projection as plain text with no Markdown presentation. */
export async function renderInlineMarkdownPlainText(content: string): Promise<string> {
  const inlineHTML = await renderInlineMarkdownSnippet(content, Number.MAX_SAFE_INTEGER);
  const output = document.createElement('span');
  output.innerHTML = inlineHTML;
  return (output.textContent ?? '')
    .replace(/<\/?[A-Za-z][^>]*>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
