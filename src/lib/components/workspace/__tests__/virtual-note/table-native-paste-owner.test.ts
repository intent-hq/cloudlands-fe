import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const [span, width, height] of [
  ['ordinary', 1, 1],
  ['rowspan', 1, 2],
  ['colspan', 2, 1],
  ['combined', 2, 2],
] as const)
  for (const [edge, left, right] of [
    ['leading', 0, 2],
    ['trailing', 2, 4],
    ['interior', 1, 3],
    ['whole', 0, 4],
  ] as const)
    for (const backward of [false, true]) {
      it(`native paste selects owners and preserves exact content/history: ${span}/${edge}/${backward ? 'backward' : 'forward'}`, async () => {
        const source =
          '| A | B | C | D |\n| --- | --- | --- | --- |\n' +
          Array.from({ length: 6 }, (_, r) => `| a${r} | b${r} | c${r} | d${r} |`).join('\n');
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
          const before = editor.state.doc,
            map = TableMap.get(before.firstChild!);
          const top = 1,
            bottom = 5;
          const a = 1 + map.map[top * 4 + left],
            h = 1 + map.map[(bottom - 1) * 4 + right - 1];
          editor.view.dispatch(
            closeHistory(
              editor.state.tr.setSelection(
                CellSelection.create(before, backward ? h : a, backward ? a : h),
              ),
            ),
          );
          const beforeSelection = editor.state.selection.toJSON();
          const html = `<table><tr><td colspan="${width}" rowspan="${height}"><p><strong>P</strong><code>a|b\\c</code></p><p></p></td></tr>${height === 2 ? '<tr></tr>' : ''}</table>`;
          expect(
            editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent),
          ).toBe(true);
          const { schema } = editor;
          const replacement = schema.nodes.tableCell.create({ colspan: width, rowspan: height }, [
            schema.nodes.paragraph.create(null, [
              schema.text('P', [schema.marks.bold.create()]),
              schema.text('a|b\\c', [schema.marks.code.create()]),
            ]),
            schema.nodes.paragraph.create(),
          ]);
          const expectedRows = [];
          before.firstChild!.forEach((row, _offset, r) => {
            if (r < top || r >= bottom) {
              expectedRows.push(row);
              return;
            }
            const cells = [];
            row.forEach((cell, _offset, c) => {
              if (c < left || c >= right) cells.push(cell);
              else if ((r - top) % height === 0 && (c - left) % width === 0)
                cells.push(replacement);
            });
            expectedRows.push(row.copy(Fragment.from(cells)));
          });
          const children = [before.firstChild!.copy(Fragment.from(expectedRows))];
          before.forEach((node, _offset, index) => {
            if (index) children.push(node);
          });
          const expected = before.copy(Fragment.from(children));
          expect(editor.getJSON()).toEqual(expected.toJSON());
          const after = editor.state.doc,
            afterMap = TableMap.get(after.firstChild!);
          expect(afterMap.problems).toBeNull();
          expect(editor.state.selection.toJSON()).toEqual({
            type: 'cell',
            anchor: 1 + afterMap.map[top * 4 + left],
            head: 1 + afterMap.map[(bottom - 1) * 4 + right - 1],
          });
          const afterSelection = editor.state.selection.toJSON();
          expect(editor.commands.undo()).toBe(true);
          expect(editor.getJSON()).toEqual(before.toJSON());
          expect(editor.state.selection.toJSON()).toEqual(beforeSelection);
          expect(editor.commands.redo()).toBe(true);
          expect(editor.getJSON()).toEqual(expected.toJSON());
          expect(editor.state.selection.toJSON()).toEqual(afterSelection);
        } finally {
          editor.destroy();
        }
      });
    }
