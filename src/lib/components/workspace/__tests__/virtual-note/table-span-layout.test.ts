import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { admitTableWindow, scanTables } from './table-source';
import { TableProjection } from './table-projection';
import { layoutTable } from './table-layout';

beforeAll(() => store.init());
afterAll(() => store.dispose());
it('sizes mounted combined spans by admitted columns at origin, interior and end', async () => {
  const row = (r: number) => '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |';
  const source = row(0) + '\n| ' + Array(8).fill('---').join(' | ') + ' |\n' +
    Array.from({ length: 12 }, (_, r) => row(r + 1)).join('\n');
  const config = createEditorConfig({
    element: document.createElement('div'), content: await processMarkdownToHTML(source),
    editable: true, useMarkdown: true, enableComments: false, enableMentions: false, onUpdate: () => {},
  });
  const native = new Editor(config);
  try {
    const map = TableMap.get(native.state.doc.firstChild!);
    native.view.dispatch(native.state.tr.setSelection(CellSelection.create(native.state.doc, 1 + map.map[8], 1 + map.map[80 + 5])));
    expect(native.commands.mergeCells()).toBe(true);
    const saved = processHTMLToMarkdown(native.getHTML());
    const raw = scanTables(saved)[0];
    const metadata = new Map<number, JSONContent>();
    native.state.doc.firstChild!.forEach((r, _rp, ri) => r.forEach((c, _cp, ci) => metadata.set(raw.rows[ri].cells[ci].from, c.toJSON())));
    const index = scanTables(saved, (from) => metadata.get(from))[0];
    for (const [row, column] of [[1, 0], [5, 2], [9, 4]]) {
      const window = admitTableWindow(saved, index, index.rows[row].cells.at(-1)!.body, 1,
        (cell) => metadata.get(cell.from), undefined, undefined,
        { row, column, rowCount: 2, columnCount: 2 });
      const projection = new TableProjection(window);
      const mounted = new Editor({ ...config, element: document.createElement('div'), content: projection.content });
      try {
        const logical = window.cells.find((c) => c.owner)!;
        expect(logical.owner!.colspan).toBe(6);
        expect(logical.mounted!.colspan).toBe(2);
        expect(TableMap.get(mounted.state.doc.firstChild!).width).toBe(2);
        const layout = layoutTable(mounted, window, 550);
        expect(layout.columns).toBe(2);
        expect(layout.width).toBe(183);
        expect(mounted.view.dom.style.getPropertyValue('--proof-table-width')).toBe('366px');
        expect(mounted.view.dom.querySelector('table')!.style.width).toBe('366px');
        expect(mounted.view.dom.querySelector('table')!.style.marginLeft).toBe(`${column * 183}px`);
      } finally { mounted.destroy(); }
    }
  } finally { native.destroy(); }
});
