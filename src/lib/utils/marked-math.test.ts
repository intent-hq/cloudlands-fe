import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderKatexToString } from './marked-math';

function errorTitle(html: string): string | undefined {
  if (!html.includes('katex-error')) return undefined;
  return /title="([^"]*)"/.exec(html)?.[1] ?? '';
}

describe('renderKatexToString strict policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['inline', 'x^2 + y^2', false],
    ['display', String.raw`\int_0^1 x\,dx`, true],
    ['matrix', String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, true],
    ['text', String.raw`\text{if } x > 0`, false],
    ['colour', String.raw`\color{red}{x}`, false],
    ['CJK text', String.raw`\text{日本語}`, false],
  ])('renders %s math without an error', (_label, tex, displayMode) => {
    expect(errorTitle(renderKatexToString(tex, displayMode))).toBeUndefined();
  });

  // KaTeX 0.19 reports glyphs without font metrics through `strict`; with a
  // plain `strict: 'error'` these became render errors. Keep the 0.18 outcome
  // (render with a fallback font) without console noise.
  it('renders characters that lack KaTeX font metrics instead of erroring', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderKatexToString(String.raw`\text{\char"263A}`, false);
    expect(errorTitle(html)).toBeUndefined();
    expect(html).toContain('☺');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown Unicode symbol', String.raw`\text{€}`, 'unknownSymbol'],
    ['Unicode text in math mode', 'é', 'unicodeTextInMathMode'],
  ])('still rejects %s as LaTeX-incompatible input', (_label, tex, code) => {
    expect(errorTitle(renderKatexToString(tex, false))).toContain(`[${code}]`);
  });

  it('renders invalid TeX as a KaTeX error instead of throwing', () => {
    expect(errorTitle(renderKatexToString(String.raw`\frac{1}{`, false))).toContain('ParseError');
  });

  it('does not trust commands that need trust', () => {
    expect(
      errorTitle(renderKatexToString(String.raw`\href{https://example.com}{x}`, false)),
    ).toBeUndefined();
    expect(renderKatexToString(String.raw`\href{https://example.com}{x}`, false)).not.toContain(
      '<a ',
    );
  });
});
