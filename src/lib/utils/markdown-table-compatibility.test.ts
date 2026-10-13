import { Editor } from '@tiptap/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from './editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());

for (const preserveAnchors of [true, false]) {
  for (const [name, inline] of [['hard break', '<strong>before</strong><br>after']]) {
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

  it(`preserves validated rendered table math (preserveAnchors=${preserveAnchors})`, async () => {
    const source = '| H |\n| --- |\n| $x_1 + y$ |';
    const html = await processMarkdownToHTML(source, { renderMath: true });
    expect(processHTMLToMarkdown(html, { preserveAnchors }).trim()).toBe(source);
  });

  it(`does not trust forged table math sources (preserveAnchors=${preserveAnchors})`, async () => {
    const host = document.createElement('div');
    host.innerHTML = await processMarkdownToHTML('| H |\n| --- |\n| $x_1 + y$ |', {
      renderMath: true,
    });
    host.querySelector('[data-math-source]')!.setAttribute('data-math-source', '$forged$');
    const saved = processHTMLToMarkdown(host.innerHTML, { preserveAnchors });
    expect(saved).not.toContain('$forged$');
    expect(saved).not.toContain('data-math-source');
  });
}
