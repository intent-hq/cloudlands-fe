/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createEditorConfig } from './editor-config';
import { sanitizeMarkdownHTML } from './html-sanitizer';
import { MAX_MATH_SOURCE_LENGTH } from './marked-math';
import {
  clearMarkdownCache,
  processHTMLToMarkdown,
  processMarkdownToHTML,
  processMarkdownForDisplay,
} from './markdown-processor';
import { processMarkdownWorkerRequest } from './markdown-worker';

function containerFor(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('markdown math rendering', () => {
  it.each([false, true])('preserves review inequalities with renderMath=%s', async (renderMath) => {
    const markdown = '$a<b$ and $c>d$';
    const html = await processMarkdownToHTML(markdown, { renderMath });
    const container = containerFor(html);
    if (renderMath) {
      expect
        .soft(Array.from(container.querySelectorAll('annotation'), (node) => node.textContent))
        .toEqual(['a<b', 'c>d']);
      expect.soft(container.querySelector('.katex-error')).toBeNull();
    } else {
      expect.soft(container.textContent?.trim()).toBe(markdown);
    }
    expect(processHTMLToMarkdown(html)).toBe(markdown);
  });

  it.each([
    '$a<b>c$',
    String.raw`\(a<b\) and \(c>d\)`,
    '$$a<b>c$$',
    '$$\na<b>c\n$$',
    String.raw`\[
a<b>c
\]`,
    String.raw`$\text{<tag attr="quoted"> & &lt; &#60; </tag>}$`,
    '$a<`b`>c$',
    '$a&lt;b$ and $c&gt;d$',
  ])('preserves original special characters in %s', async (markdown) => {
    for (const renderMath of [false, true]) {
      const html = await processMarkdownToHTML(markdown, { renderMath, skipIfHTML: false });
      expect(processHTMLToMarkdown(html)).toBe(markdown);
      expect(containerFor(html).querySelector('tag, script, img, [onerror]')).toBeNull();
    }
    expect(processHTMLToMarkdown(await processMarkdownForDisplay(markdown))).toBe(markdown);
  });

  it('cannot forge protected sources or leak nested code placeholders', async () => {
    const markdown =
      'x__CODE_BLOCK_0__y x__MARKDOWN_SOURCE_0__y x__MARKDOWN_SOURCE__1__y ' +
      '`<img src=x onerror=alert(1)>` $a<`b`>c$';
    const html = await processMarkdownToHTML(markdown, { renderMath: true, skipIfHTML: false });
    expect(processHTMLToMarkdown(html)).toBe(markdown);
    expect(containerFor(html).querySelector('img')).toBeNull();
  });

  it.each([false, true])(
    'retains adjacent HTML policy with math enabled=%s',
    async (renderMath) => {
      const source = '$a<b$ and $c>d$ <img src=x onerror=alert(1)> <sub>2</sub><sup>3</sup><br>';
      const container = containerFor(
        await processMarkdownToHTML(source, { renderMath, skipIfHTML: false }),
      );
      expect(container.querySelector('img, script, [onerror]')).toBeNull();
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(container.querySelector('sub')?.textContent).toBe('2');
      expect(container.querySelector('sup')?.textContent).toBe('3');
      expect(container.querySelector('br')).toBeTruthy();
    },
  );

  it.each(['> $$\n> a<b>c\n> $$', '- $$\n  a<b>c\n  $$'])(
    'preserves display TeX recognized inside a Markdown container: %s',
    async (source) => {
      const html = await processMarkdownToHTML(source, { renderMath: true });
      const container = containerFor(html);
      expect(container.querySelector('annotation')?.textContent?.trim()).toBe('a<b>c');
      expect(container.querySelector('[data-math-source]')?.getAttribute('data-math-source')).toBe(
        '$$\na<b>c\n$$',
      );
    },
  );

  it.each([
    ['<!-- marker -->$x$\n# Heading', 'h1', 'Heading'],
    ['<!-- marker -->$x$\n- item', 'ul li', 'item'],
    ['<br>$x$\n# Heading', 'h1', 'Heading'],
    ['<!-- marker -->$x$\n```text\ncode\n```', 'pre code', 'code'],
  ])('preserves paragraph boundaries for %s', async (source, selector, text) => {
    for (const renderMath of [false, true]) {
      const container = containerFor(
        await processMarkdownToHTML(source, { renderMath, skipIfHTML: false }),
      );
      expect(container.querySelector(selector)?.textContent?.trim()).toBe(text);
    }
  });

  it.each([
    ['<!-- marker -->$x$\n> quotation', 'blockquote', 'quotation'],
    ['<sub>2</sub> $x$\n1. ordered', 'ol li', 'ordered'],
    ['<!-- marker -->$x$\n~~~text\ncode\n~~~', 'pre code', 'code'],
    ['<!-- marker -->$x$\n---', 'hr', ''],
    ['<!-- marker -->$x$\na | b\n--- | ---\nc | d', 'table th', 'a'],
  ])('retains neighboring Markdown block structure for %s', async (source, selector, text) => {
    const container = containerFor(
      await processMarkdownToHTML(source, { renderMath: true, skipIfHTML: false }),
    );
    expect(container.querySelector(selector)?.textContent?.trim()).toBe(text);
  });

  it('keeps multiline math paragraphs together and stops at registered display blocks', async () => {
    const source =
      '<!--anchor:cmt-boundary:start-->$a<b$ and $c>d$\ncontinued $e<f$<!--anchor:cmt-boundary:end-->\n$$g<h$$';
    const container = containerFor(
      await processMarkdownToHTML(source, { renderMath: true, skipIfHTML: false }),
    );
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('p')?.querySelectorAll('.math-inline')).toHaveLength(3);
    expect(container.querySelectorAll('.math-display')).toHaveLength(1);
    expect(container.querySelectorAll('[data-anchor-id]')).toHaveLength(2);
    expect(processHTMLToMarkdown(container.innerHTML)).toBe(source.replace('\n$$', () => '\n\n$$'));
  });

  it('stops math recovery before registered task blocks', async () => {
    const source = '<!-- marker -->$x$\n@@@task\n# Task heading\nTask body\n@@@';
    const container = containerFor(
      await processMarkdownToHTML(source, { renderMath: true, skipIfHTML: false }),
    );
    expect(
      container.querySelector<HTMLInputElement>('[data-type="task-block"] input')?.disabled,
    ).toBe(true);
    expect(container.querySelector('p')?.textContent).not.toContain('@@@task');
  });

  it.each([
    ['$x^2$', false],
    ['$2x$', false],
    [String.raw`\(x^2\)`, false],
    [String.raw`$$\frac{1}{2}$$`, true],
    [String.raw`\[\frac{1}{2}\]`, true],
  ])('renders supported delimiter form %s', async (markdown, displayMode) => {
    const html = await processMarkdownToHTML(markdown, { renderMath: true });
    const container = containerFor(html);

    expect(html).toContain('class="katex"');
    expect(
      container.querySelector(displayMode ? 'div.math-display' : 'span.math-inline'),
    ).toBeTruthy();
    expect(container.querySelector('math annotation')?.textContent).toBeTruthy();
    expect(processHTMLToMarkdown(html)).toBe(markdown);
  });

  it('renders representative math without linkifying formula internals', async () => {
    const markdown = [
      String.raw`Mixed $\sqrt{x}$, $\sum_{i=1}^n i$, $α + β$, and $\text{config.ts}$.`,
      'Adjacent $x$$y$.',
      String.raw`$$\begin{matrix}a & b \\ c & d\end{matrix}$$`,
    ].join('\n\n');
    const html = await processMarkdownToHTML(markdown, { renderMath: true });
    const container = containerFor(html);

    expect(container.querySelectorAll('.katex')).toHaveLength(7);
    expect(container.querySelector('math')).toBeTruthy();
    expect(container.querySelector('mtable')).toBeTruthy();
    expect(container.querySelector('[data-mention]')).toBeNull();
    expect(container.textContent).toContain('config.ts');
    expect(processHTMLToMarkdown(html)).toBe(markdown);
  });

  it.each([
    ['`$x^2$`', '$x^2$'],
    ['```tex\n$x^2$\n```', '$x^2$'],
    [String.raw`Escaped \$x^2$`, '$x^2$'],
    [String.raw`Empty \(\)`, String.raw`Empty \(\)`],
    ['Costs $5 and $10', 'Costs $5 and $10'],
    ['A single item costs $5.', 'A single item costs $5.'],
    ['Ambiguous numeric-only $42$ stays literal.', '$42$'],
  ])('keeps non-math input literal: %s', async (markdown, visibleText) => {
    const html = await processMarkdownToHTML(markdown, { renderMath: true });

    expect(containerFor(html).querySelector('.katex')).toBeNull();
    expect(containerFor(html).textContent).toContain(visibleText);
  });

  it('preserves surrounding text for unfinished and invalid equations', async () => {
    const unfinished = await processMarkdownToHTML('before $x^2 after', { renderMath: true });
    const unfinishedParenthesis = await processMarkdownToHTML(String.raw`before \(x^2 after`, {
      renderMath: true,
    });
    const unfinishedDisplay = await processMarkdownToHTML(
      String.raw`\[ unfinished

after`,
      { renderMath: true },
    );
    const emptyDisplay = await processMarkdownToHTML(String.raw`\[\]`, { renderMath: true });
    const invalid = await processMarkdownToHTML(String.raw`before $\frac{$ after`, {
      renderMath: true,
    });

    expect(containerFor(unfinished).textContent).toContain('before $x^2 after');
    expect(containerFor(unfinishedParenthesis).textContent).toContain(
      String.raw`before \(x^2 after`,
    );
    expect(containerFor(unfinishedDisplay).textContent).toContain(String.raw`\[ unfinished`);
    expect(containerFor(unfinishedDisplay).textContent).toContain('after');
    expect(containerFor(emptyDisplay).textContent).toContain(String.raw`\[\]`);
    expect(containerFor(invalid).textContent).toContain('before');
    expect(containerFor(invalid).textContent).toContain('after');
    expect(containerFor(invalid).querySelector('.katex-error')).toBeTruthy();
    expect(processHTMLToMarkdown(invalid)).toBe(String.raw`before $\frac{$ after`);
  });

  it.each([[String.raw`before $$\frac{1}{2}$$ after`], [String.raw`before \[\frac{1}{2}\] after`]])(
    'keeps misplaced display delimiters literal without partial inline math',
    async (markdown) => {
      const html = await processMarkdownToHTML(markdown, { renderMath: true });

      expect(containerFor(html).querySelector('.katex')).toBeNull();
      expect(containerFor(html).textContent).toContain(markdown);
      expect(processHTMLToMarkdown(html)).toBe(markdown);
    },
  );

  it('does not restore forged math source attributes', () => {
    const html = [
      '<p>before <span data-math-source="$x^2$">not math</span> after</p>',
      '<p>before <span class="math-inline" data-math-source="$x^2$"><span class="katex">not math</span></span> after</p>',
    ];

    expect(html.map((value) => processHTMLToMarkdown(value))).toEqual([
      'before not math after',
      'before not math after',
    ]);
  });

  it('rejects a forged source and annotation when the rendered math disagrees', async () => {
    const container = containerFor(await processMarkdownToHTML('$2x$', { renderMath: true }));
    const wrapper = container.querySelector('.math-inline');
    const annotation = wrapper?.querySelector('annotation[encoding="application/x-tex"]');
    expect(wrapper).not.toBeNull();
    expect(annotation).not.toBeNull();
    wrapper!.setAttribute('data-math-source', '$z$');
    annotation!.textContent = 'z';

    expect(processHTMLToMarkdown(container.innerHTML)).not.toBe('$z$');
  });

  it.each([true, false])(
    'round-trips genuine inline, display, and parse-error math with preserveAnchors=%s',
    async (preserveAnchors) => {
      const markdown = String.raw`Inline $2x$.

$$\frac{1}{2}$$

Invalid $\frac{$ here`;
      const html = await processMarkdownToHTML(markdown, { renderMath: true });

      expect(processHTMLToMarkdown(html, { preserveAnchors })).toBe(markdown);
    },
  );

  it.each(['source', 'annotation', 'both', 'visible', 'error'])(
    'rejects math with tampered %s output',
    async (tampering) => {
      const markdown = tampering === 'error' ? String.raw`$\frac{$` : '$2x$';
      const container = containerFor(await processMarkdownToHTML(markdown, { renderMath: true }));
      const wrapper = container.querySelector('.math-inline');
      const annotation = wrapper?.querySelector('annotation[encoding="application/x-tex"]');
      const error = wrapper?.querySelector('.katex-error');
      expect(wrapper).not.toBeNull();

      if (tampering === 'source' || tampering === 'both') {
        wrapper!.setAttribute('data-math-source', '$z$');
      }
      if (tampering === 'annotation' || tampering === 'both') {
        expect(annotation).not.toBeNull();
        annotation!.textContent = 'z';
      }
      if (tampering === 'visible') wrapper!.append('extra');
      if (tampering === 'error') {
        expect(error).not.toBeNull();
        error!.textContent = 'z';
      }

      expect(processHTMLToMarkdown(container.innerHTML)).not.toBe(
        wrapper!.getAttribute('data-math-source'),
      );
    },
  );

  it('rejects oversized forged math source before canonical rendering', () => {
    const source = `$${'x'.repeat(MAX_MATH_SOURCE_LENGTH + 1)}$`;
    const html = `<span class="math-inline" data-math-source="${source}"><span class="katex">x</span></span>`;

    expect(processHTMLToMarkdown(html)).not.toBe(source);
  });

  it('keeps trust-requiring TeX inert and sanitizes hostile neighboring HTML', async () => {
    const markdown = String.raw`$\href{javascript:alert(1)}{click}$ <img src=x onerror=alert(2)>`;
    const html = await processMarkdownToHTML(markdown, {
      renderMath: true,
      skipIfHTML: false,
    });
    const container = containerFor(html);

    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('.katex a')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>');
  });

  it('leaves over-limit formulas literal instead of expanding them', async () => {
    const markdown = `$${'x'.repeat(MAX_MATH_SOURCE_LENGTH + 1)}$`;
    const html = await processMarkdownToHTML(markdown, { renderMath: true });

    expect(containerFor(html).querySelector('.katex')).toBeNull();
    expect(containerFor(html).textContent).toContain('x'.repeat(100));
  });

  it('keeps editable note source unchanged unless read-only math rendering is requested', async () => {
    const markdown = String.raw`Equation $x^2$ and \(y^2\), unfinished \(z.

\[\frac{1}{2}\]`;
    const html = await processMarkdownToHTML(markdown);
    const editor = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: html,
        editable: true,
        onUpdate: () => {},
        useMarkdown: true,
        workspace: { id: 'math-source-test' },
        enableMentions: false,
      }),
    );

    expect(editor.getHTML()).not.toContain('class="katex"');
    expect(processHTMLToMarkdown(editor.getHTML())).toBe(markdown);
    editor.destroy();
  });

  it('caches literal and rendered modes independently', async () => {
    clearMarkdownCache();
    const markdown = '$x^2$';
    const literal = await processMarkdownToHTML(markdown);
    const rendered = await processMarkdownToHTML(markdown, { renderMath: true });

    expect(containerFor(literal).querySelector('.katex')).toBeNull();
    expect(containerFor(rendered).querySelector('.katex')).toBeTruthy();
  });

  it('produces consistent main-thread, worker, and large-content fallback math', async () => {
    const markdown = String.raw`Equation $x^2$

$$\frac{1}{2}$$`;
    const main = await processMarkdownToHTML(markdown, {
      renderMath: true,
      preserveAnchors: false,
    });
    const worker = await processMarkdownWorkerRequest({
      id: 7,
      markdown,
      pipeline: { preserveAnchors: false, renderMath: true },
    });
    const large = `${'safe filler '.repeat(500)}\n\n${markdown}`;
    const fallback = await processMarkdownToHTML(large, { renderMath: true });

    expect(worker.error).toBeNull();
    expect(
      sanitizeMarkdownHTML(worker.html ?? '', undefined, { preserveKatexLayoutStyles: true }),
    ).toBe(main);
    expect(containerFor(fallback).querySelectorAll('.katex')).toHaveLength(2);
  });
});
