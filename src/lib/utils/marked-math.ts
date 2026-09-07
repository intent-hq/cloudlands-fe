import { renderToString } from 'katex';
import type { Marked } from 'marked';

export const MAX_MATH_SOURCE_LENGTH = 4096;

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
    return token.displayMode ? `<p>${literal}</p>\n` : literal;
  }

  try {
    const rendered = renderToString(token.text, {
      displayMode: token.displayMode,
      output: 'htmlAndMathml',
      throwOnError: false,
      strict: 'error',
      trust: false,
      maxExpand: 100,
      maxSize: 20,
    });
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

export function addMathSupport(markedInstance: Marked, renderEnabled: boolean): void {
  markedInstance.use({
    extensions: [
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
        tokenizer(src) {
          return (
            misplacedDisplayToken(src) ?? inlineDollarToken(src) ?? inlineParenthesisToken(src)
          );
        },
        renderer: (token) => renderMath(token as MathToken, renderEnabled),
      },
    ],
  });
}
