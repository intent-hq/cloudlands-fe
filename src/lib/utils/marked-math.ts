import { renderToString } from 'katex';
import { Lexer, type Marked } from 'marked';

export const MAX_MATH_SOURCE_LENGTH = 4096;

export function renderKatexToString(text: string, displayMode: boolean): string {
  return renderToString(text, {
    displayMode,
    output: 'htmlAndMathml',
    throwOnError: false,
    strict: 'error',
    trust: false,
    maxExpand: 100,
    maxSize: 20,
  });
}

type MathToken = {
  type: 'mathInline' | 'mathDisplay';
  raw: string;
  text: string;
  source: string;
  displayMode: boolean;
  literalOnly?: boolean;
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(value: string): string {
  return escapeAttribute(value).replace(/>/g, '&gt;');
}

function renderMath(token: MathToken, enabled: boolean): string {
  if (!enabled || token.literalOnly || token.text.length > MAX_MATH_SOURCE_LENGTH) {
    const literal = escapeText(token.source);
    return token.displayMode ? `<p>${literal.replace(/\n/g, '<br>')}</p>\n` : literal;
  }

  try {
    const rendered = renderKatexToString(token.text, token.displayMode);
    const tag = token.displayMode ? 'div' : 'span';
    const className = token.displayMode ? 'math-display' : 'math-inline';
    const newline = token.displayMode ? '\n' : '';
    return `<${tag} class="${className}" data-math-source="${escapeAttribute(token.source)}">${rendered}</${tag}>${newline}`;
  } catch {
    return escapeText(token.source);
  }
}

function inlineDollarToken(src: string): MathToken | undefined {
  if (src.startsWith('$$')) return undefined;
  const match = /^\$((?:\\.|[^\\$\n])+?)\$/.exec(src);
  if (!match) return undefined;
  const text = match[1];
  if (/^\s|\s$/.test(text) || /^[\d.,]+$/.test(text)) return undefined;
  const next = src[match[0].length];
  if (next && /\d/.test(next)) return undefined;
  return { type: 'mathInline', raw: match[0], text, source: match[0], displayMode: false };
}

function misplacedDisplayToken(src: string): MathToken | undefined {
  const source = /^\$\$[^\n]*?\$\$/.exec(src)?.[0] ?? /^\\\[[^\n]*?\\\]/.exec(src)?.[0];
  if (!source) return undefined;
  return {
    type: 'mathInline',
    raw: source,
    text: '',
    source,
    displayMode: false,
    literalOnly: true,
  };
}

function inlineParenthesisToken(src: string): MathToken | undefined {
  const match = /^\\\(((?:\\.|[^\\\n])*?)\\\)/.exec(src);
  if (!match) {
    const unfinished = /^\\\([^\n]*/.exec(src)?.[0];
    return unfinished
      ? {
          type: 'mathInline',
          raw: unfinished,
          text: '',
          source: unfinished,
          displayMode: false,
          literalOnly: true,
        }
      : undefined;
  }
  return {
    type: 'mathInline',
    raw: match[0],
    text: match[1],
    source: match[0],
    displayMode: false,
    literalOnly: !match[1].trim(),
  };
}

function displayToken(src: string): MathToken | undefined {
  const dollar = /^( {0,3})\$\$[ \t]*([\s\S]*?)[ \t]*\$\$(?:[ \t]*(?:\n|$))/.exec(src);
  const bracket = /^( {0,3})\\\[[ \t]*([\s\S]*?)[ \t]*\\\](?:[ \t]*(?:\n|$))/.exec(src);
  const match = dollar ?? bracket;
  if (!match) {
    const unfinished = /^( {0,3})(?:\$\$|\\\[)[^\n]*(?:\n|$)/.exec(src);
    if (!unfinished) return undefined;
    const source = unfinished[0].trimEnd().slice(unfinished[1].length);
    return {
      type: 'mathDisplay',
      raw: unfinished[0],
      text: '',
      source,
      displayMode: true,
      literalOnly: true,
    };
  }
  const source = match[0].trimEnd().slice(match[1].length);
  return {
    type: 'mathDisplay',
    raw: match[0],
    text: match[2],
    source,
    displayMode: true,
    literalOnly: !match[2].trim(),
  };
}

function inlineToken(src: string): MathToken | undefined {
  return misplacedDisplayToken(src) ?? inlineDollarToken(src) ?? inlineParenthesisToken(src);
}

/** Protect original TeX before HTML-like text is escaped, using the parser's token rules. */
export function protectMathSource(content: string, protect: (source: string) => string): string {
  const candidates = /\\.|\$/g;
  const parts: string[] = [];
  let copiedThrough = 0;
  let lineEnd = -1;
  let blockStart = 0;
  let candidate: RegExpExecArray | null;
  while ((candidate = candidates.exec(content))) {
    const start = candidate.index;
    const src = content.slice(start);
    if (start > lineEnd) {
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const newline = content.indexOf('\n', start);
      lineEnd = newline < 0 ? content.length : newline;
      // Account for Markdown containers that the block lexer removes before
      // invoking displayToken. Keep those prefixes in the protected raw source.
      const prefix =
        /^(?: {0,3}>[ \t]?)*(?: {0,3}(?:[-+*]|\d+[.)])[ \t]+)? {0,3}/.exec(
          content.slice(lineStart),
        )?.[0] ?? '';
      blockStart = lineStart + prefix.length;
    }
    const token = (start === blockStart ? displayToken(src) : undefined) ?? inlineToken(src);
    if (!token) continue;
    parts.push(content.slice(copiedThrough, start), protect(token.raw));
    copiedThrough = start + token.raw.length;
    candidates.lastIndex = copiedThrough;
  }
  parts.push(content.slice(copiedThrough));
  return parts.join('');
}

export function addMathSupport(markedInstance: Marked, renderEnabled: boolean): void {
  markedInstance.use({
    extensions: [
      {
        name: 'mathHtmlParagraph',
        level: 'block',
        tokenizer(src) {
          // Marked otherwise treats a leading comment or inline tag as a raw HTML
          // block and never visits the math tokens, leaving their source as HTML.
          if (!/^(?: {0,3})(?:<!--|<br\s*\/?>|<\/?(?:sub|sup)>)/i.test(src)) return;
          // Use the same paragraph grammar and extension clipping as Marked's
          // block lexer, so recovering math cannot swallow subsequent blocks.
          const { pedantic, gfm, extensions } = this.lexer.options;
          const rules = Lexer.rules.block[pedantic ? 'pedantic' : gfm ? 'gfm' : 'normal'];
          let end = src.length;
          const afterFirstCharacter = src.slice(1);
          const blockStarts = extensions?.startBlock ?? [];
          for (const start of blockStarts) {
            const index = start.call(this, afterFirstCharacter);
            if (typeof index === 'number' && index >= 0) end = Math.min(end, index + 1);
          }
          let raw = rules.paragraph.exec(src.slice(0, end))?.[0];
          if (!raw) return;
          // Some registered hints (task blocks) only recognize a current line,
          // rather than searching ahead. Consult those hints at line boundaries
          // too, without duplicating their block-opening syntax here.
          const lines = raw.split('\n');
          let offset = lines[0].length + 1;
          for (const line of lines.slice(1)) {
            if (blockStarts.some((start) => start.call(this, `${line}\n`) === 0)) {
              raw = raw.slice(0, offset);
              break;
            }
            offset += line.length + 1;
          }
          const tokens = this.lexer.inlineTokens(raw.trimEnd());
          if (!tokens.some((token) => token.type === 'mathInline')) return;
          return { type: 'mathHtmlParagraph', raw, tokens };
        },
        renderer(token) {
          return `<p>${this.parser.parseInline(token.tokens ?? [])}</p>\n`;
        },
      },
      {
        name: 'mathDisplay',
        level: 'block',
        start: (src) => src.search(/^(?: {0,3})(?:\$\$|\\\[)/m),
        tokenizer: displayToken,
        renderer: (token) => renderMath(token as MathToken, renderEnabled),
      },
      {
        name: 'mathInline',
        level: 'inline',
        start: (src) => src.search(/\$|\\[([]/),
        tokenizer: inlineToken,
        renderer: (token) => renderMath(token as MathToken, renderEnabled),
      },
    ],
  });
}
