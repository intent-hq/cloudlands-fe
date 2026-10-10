import { Editor } from '@tiptap/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from './editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());

const cases = [
  ['bold', '<strong>bold</strong>', '**bold**'],
  ['italic', '<em>italic</em>', '*italic*'],
  ['link', '<a href="https://example.com/path">link</a>', '[link](https://example.com/path)'],
  ['code', '<code>code \\ path | value</code>', '`code \\ path \\| value`'],
  ['code delimiter', '<code>a`b</code>', '``a`b``'],
  ['code backslash pipe', '<code>a\\|b</code>', '`a\\`<!-- -->`\\|b`'],
  [
    'code HTML literal',
    '<code>\\|&lt;/code&gt;&lt;img src=x onerror=alert(1)&gt;</code>',
    '`\\`<!-- -->`\\|</code><img src=x onerror=alert(1)>`',
  ],
  [
    'literal punctuation',
    'literal *stars* _under_ [brackets] `ticks`',
    'literal \\*stars\\* \\_under\\_ &#91;brackets&#93; \\`ticks\\`',
  ],
  ['pipe and backslash', 'pipe | slash \\ adjacent \\|', 'pipe \\| slash \\\\ adjacent \\\\\\|'],
  ['literal HTML', '&lt;img src=x&gt; &amp;copy;', '&lt;img src=x&gt; &amp;copy;'],
  [
    'mixed',
    '<strong>bold</strong> plain <em>italic</em> <code>code</code>',
    '**bold** plain *italic* `code`',
  ],
  ['empty', '', ''],
] as const;

for (const [name, html, markdown] of cases) {
  it(`preserves native header/body paragraph ${name} through save and canonical reload`, async () => {
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
      editor.commands.setContent(
        `<table><tr><th align="center"><p>${html}</p></th><th><p>plain header</p></th></tr><tr><td align="center"><p>${html}</p></td><td><p>plain body</p></td></tr></table>`,
      );
      const before = editor.state.doc.firstChild!.toJSON();
      const expected = `| ${markdown} | plain header |\n| :---: | --- |\n| ${markdown} | plain body |`;
      const saved = processHTMLToMarkdown(editor.getHTML()).trim();
      expect(saved).toBe(expected);
      const canonical = await processMarkdownToHTML(saved);
      editor.commands.setContent(canonical);
      expect(editor.state.doc.firstChild!.toJSON()).toEqual(before);
      // The canonical parser emits direct inline cell contents, not native P wrappers.
      expect(processHTMLToMarkdown(canonical).trim()).toBe(expected);
    } finally {
      editor.destroy();
    }
  });
}

it('leaves unknown wrappers outside table cells on their existing serialization path', () => {
  expect(
    processHTMLToMarkdown('<blockquote><div><strong>text</strong></div></blockquote>').trim(),
  ).toBe('> text');
});
