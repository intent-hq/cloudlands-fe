import { Editor } from '@tiptap/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from './editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());

for (const preserveAnchors of [true, false]) {
  it(`keeps table anchor spelling unchanged (preserveAnchors=${preserveAnchors})`, async () => {
    const html =
      '<table><tr><th><p>H</p></th></tr><tr><td><p><span data-anchor-id="review:start"></span><strong>bold</strong><span data-anchor-id="review:end"></span></p></td></tr></table>';
    const inline = preserveAnchors
      ? '<!--anchor:review:start-->**bold**<!--anchor:review:end-->'
      : '**bold**';
    const saved = processHTMLToMarkdown(html, { preserveAnchors }).trim();
    expect(saved).toBe(`| H |\n| --- |\n| ${inline} |`);
    const canonical = await processMarkdownToHTML(saved);
    expect(canonical.includes('data-anchor-id="review:start"')).toBe(preserveAnchors);
  });
  for (const [name, inline] of [
    [
      'combined marks',
      '<strong><em>bold italic</em> <a href="https://example.com">bold link</a> <code>a\\|b</code></strong>',
    ],
    ['adjacent marks', '<strong>bold</strong><em>italic</em><strong>next</strong>'],
    ['marked whitespace', '<strong> leading </strong><em> </em>plain'],
    ['marked punctuation', '<strong>!</strong>word<em>?</em>tail'],
  ]) {
    it(`roundtrips table ${name} with exact native marks (preserveAnchors=${preserveAnchors})`, async () => {
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
          `<table><tr><th align="center"><p>${inline}</p></th><th>right</th></tr><tr><td align="center"><p>${inline}</p></td><td>body</td></tr></table>`,
        );
        const before = editor.state.doc.firstChild!.toJSON();
        const saved = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors }).trim();
        expect(saved.split('\n')).toHaveLength(3);
        expect(saved.split('\n')[1]).toBe('| :---: | --- |');
        const canonical = await processMarkdownToHTML(saved);
        editor.commands.setContent(canonical);
        expect(editor.state.doc.firstChild!.toJSON()).toEqual(before);
        expect(processHTMLToMarkdown(canonical, { preserveAnchors }).trim()).toBe(saved);
      } finally {
        editor.destroy();
      }
    });
  }
}
