import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const plain of [false, true])
  for (const nextRow of [false, true])
    it(`records native cross-cell replacement and repair: plain=${plain}, nextRow=${nextRow}`, async () => {
      const source =
        '| H | K | J |\n| :--- | :---: | ---: |\n| alpha LEFT | middle | beta RIGHT |\n| gamma LEFT | second | delta RIGHT |\n\nTail';
      const editor = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content: await processMarkdownToHTML(source),
          editable: true,
          useMarkdown: true,
          enableComments: false,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      try {
        let a = -1,
          h = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === 'alpha LEFT') a = pos + 7;
          if (
            node.type.name === 'paragraph' &&
            node.textContent === (nextRow ? 'delta RIGHT' : 'beta RIGHT')
          )
            h = pos + 1 + (nextRow ? 5 : 4);
        });
        expect(a).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(a);
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, a, h)),
        );
        const before = editor.getJSON(),
          selection = editor.state.selection.toJSON();
        const input = {
          'text/plain': plain ? 'NEW **bold** | slash\\\nlast' : '',
          'text/html': plain ? '' : '<p><strong>NEW</strong></p><p></p><p><code>a|b\\c</code></p>',
        };
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: { files: [], getData: (mime: string) => input[mime as keyof typeof input] ?? '' },
        });
        editor.view.dom.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        const after = editor.getJSON(),
          afterSelection = editor.state.selection.toJSON();
        console.log(
          'NATIVE_CROSS_CELL',
          JSON.stringify({
            plain,
            nextRow,
            before,
            after,
            selection,
            afterSelection,
            source: processHTMLToMarkdown(editor.getHTML()),
          }),
        );
        expect(editor.commands.undo()).toBe(true);
        expect(editor.getJSON()).toEqual(before);
        expect(editor.state.selection.toJSON()).toEqual(selection);
        expect(editor.commands.redo()).toBe(true);
        expect(editor.getJSON()).toEqual(after);
        expect(editor.state.selection.toJSON()).toEqual(afterSelection);
      } finally {
        editor.destroy();
      }
    });
