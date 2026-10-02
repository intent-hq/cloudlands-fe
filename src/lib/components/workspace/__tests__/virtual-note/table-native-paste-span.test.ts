import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const mode of ['trailing-cell', 'whole-width', 'crossing-plain', 'crossing-merged'] as const) {
  it(`native-only merged paste keeps a valid exact target selection: ${mode}`, async () => {
    const source =
      '| A | B | C | D |\n| --- | --- | --- | --- |\n' +
      Array.from({ length: 12 }, (_, r) => `| a${r} | b${r} | c${r} | d${r} |`).join('\n');
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
      let map = TableMap.get(editor.state.doc.firstChild!);
      if (mode.startsWith('crossing')) {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            CellSelection.create(editor.state.doc, 1 + map.map[5], 1 + map.map[42]),
          ),
        );
        expect(editor.commands.mergeCells()).toBe(true);
      }
      map = TableMap.get(editor.state.doc.firstChild!);
      const rect =
        mode === 'trailing-cell'
          ? { top: 1, bottom: 11, left: 1, right: 3 }
          : mode === 'whole-width'
            ? { top: 1, bottom: 11, left: 0, right: 4 }
            : { top: 4, bottom: 6, left: 0, right: 4 };
      editor.view.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(
            editor.state.doc,
            1 + map.map[rect.top * 4 + rect.left],
            1 + map.map[(rect.bottom - 1) * 4 + rect.right - 1],
          ),
        ),
      );
      const before = editor.getJSON(),
        beforeSelection = editor.state.selection.toJSON();
      const html =
        mode === 'crossing-plain'
          ? '<table><tr><td><p>P</p></td><td><p>Q</p></td></tr></table>'
          : '<table><tr><td colspan="2" rowspan="2"><p>P</p></td></tr><tr></tr></table>';
      let error: string | undefined, result: boolean | undefined;
      try {
        result = editor.view.pasteHTML(html);
      } catch (caught) {
        error = String(caught);
      }
      const selection = editor.state.selection;
      const afterMap = TableMap.get(editor.state.doc.firstChild!);
      const afterRect =
        selection instanceof CellSelection
          ? afterMap.rectBetween(selection.$anchorCell.pos - 1, selection.$headCell.pos - 1)
          : null;
      console.info('Independent native paste span evidence', {
        mode,
        result,
        error,
        rect,
        afterRect,
        mapProblems: afterMap.problems,
        unchanged: JSON.stringify(editor.getJSON()) === JSON.stringify(before),
        beforeSelection,
        afterSelection: selection.toJSON(),
      });
      if (error) {
        expect(editor.getJSON()).toEqual(before);
        expect(selection.toJSON()).toEqual(beforeSelection);
      }
      expect(error).toBeUndefined();
      expect(result).toBe(true);
      expect(afterMap.problems).toBeNull();
      expect(afterRect).toEqual(rect);
    } finally {
      editor.destroy();
    }
  });
}
