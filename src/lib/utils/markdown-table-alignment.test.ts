import { Editor } from '@tiptap/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from './editor-config';
import { sanitizeMarkdownHTML } from './html-sanitizer';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());

const source =
  '| Left | Center | Right | Default |\n| :--- | :---: | ---: | --- |\n| a | b | c | d |';
const alignments = ['left', 'center', 'right', null];
const element = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

it('preserves explicit column alignment on Markdown headers and body cells', async () => {
  const host = element(await processMarkdownToHTML(source));
  for (const row of host.querySelectorAll('tr'))
    expect(Array.from(row.children, (cell) => cell.getAttribute('align'))).toEqual(alignments);
  expect(processHTMLToMarkdown(host.innerHTML).trim()).toBe(source);
});

for (const preserveAnchors of [true, false]) {
  it(`roundtrips native cell styles without width metadata (preserveAnchors=${preserveAnchors})`, async () => {
    const editor = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: '',
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    try {
      // Bypass the Markdown sanitizer on input to isolate the serializer regression.
      editor.commands.setContent(
        '<table><tr><th align="left">Left</th><th align="center">Center</th><th align="right">Right</th><th>Default</th></tr><tr><td align="left">a</td><td align="center">b</td><td align="right">c</td><td>d</td></tr></table>',
      );
      const before = editor.state.doc.firstChild!.toJSON();
      const nativeHTML = editor.getHTML();
      expect(nativeHTML).toContain('text-align: right');
      const markdown = processHTMLToMarkdown(nativeHTML, { preserveAnchors }).trim();
      expect(markdown).toBe(source);
      editor.commands.setContent(await processMarkdownToHTML(markdown));
      expect(editor.state.doc.firstChild!.toJSON()).toEqual(before);
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableHeader' || node.type.name === 'tableCell')
          expect(node.attrs).toMatchObject({ colwidth: null, colspan: 1, rowspan: 1 });
      });
    } finally {
      editor.destroy();
    }
  });
}

for (const alignment of ['left', 'center', 'right']) {
  for (const tag of ['th', 'td']) {
    it(`retains only safe ${alignment} alignment from native ${tag} style`, () => {
      const host = element(
        sanitizeMarkdownHTML(
          `<table><tr><${tag} align="left" style="text-align: ${alignment}; width: 99999px; position:fixed; background-image:url(javascript:alert(1))" onclick="alert(1)"><a href="javascript:alert(1)">text</a><script>alert(1)</script></${tag}></tr></table><p align="right" style="text-align:right">paragraph</p>`,
        ),
      );
      expect(host.querySelector(tag)?.getAttribute('align')).toBe(alignment);
      expect(host.querySelector('[style], [onclick], [href], script')).toBeNull();
      expect(host.querySelector('p')?.hasAttribute('align')).toBe(false);
      expect(host.querySelector(tag)?.hasAttribute('width')).toBe(false);
    });
  }
}

for (const value of ['justify', 'inherit', 'url(javascript:alert(1))']) {
  it(`drops unsupported table alignment ${value}`, () => {
    const host = element(
      sanitizeMarkdownHTML(
        `<table><tr><th align="${value}">H</th><td style="text-align:${value}">V</td></tr></table>`,
      ),
    );
    expect(host.querySelector('[align], [style]')).toBeNull();
  });
}

it('rejects compound alignment attributes rather than interpreting them as CSS', () => {
  const host = element(
    sanitizeMarkdownHTML('<table><tr><td align="right;position:fixed">V</td></tr></table>'),
  );
  expect(host.querySelector('[align], [style]')).toBeNull();
});

it('does not admit alignment attributes on unrelated tags or width/style metadata', () => {
  const host = element(
    sanitizeMarkdownHTML(
      '<div align="center" style="width:100vw"><p align="right">p</p><table align="right"><tr align="right"><td align="RIGHT">v</td></tr></table></div>',
    ),
  );
  expect(host.querySelectorAll('[align]')).toHaveLength(1);
  expect(host.querySelector('td')?.getAttribute('align')).toBe('right');
  expect(host.querySelector('[style]')).toBeNull();
});
