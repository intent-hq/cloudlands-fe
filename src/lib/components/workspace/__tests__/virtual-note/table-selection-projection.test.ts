import { beforeAll, afterAll, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal, type Selection } from './source-journal';
import { scanTables } from './table-source';
import { TableProjection } from './table-projection';
import { decodeTablePages } from './table-transfer';
import { bytes } from './bounded-note-service';

beforeAll(() => store.init());
afterAll(() => store.dispose());
it('clips native rectangular selection in both axes without replacing its logical endpoints', async () => {
  const row = (r: number) =>
    '| ' + Array.from({ length: 12 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |';
  const source =
    row(0) +
    '\n| ' +
    Array(12).fill('---').join(' | ') +
    ' |\n' +
    Array.from({ length: 39 }, (_, r) => row(r + 1)).join('\n');
  // Full source/index/native editor are the independent oracle and mock backing, not renderer admission.
  const index = scanTables(source)[0];
  const native = new Editor(
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
  const service = new SourceJournal(() => source, 1);
  try {
    for (const reverseRows of [false, true])
      for (const reverseColumns of [false, true]) {
        const ar = reverseRows ? 35 : 1,
          hr = reverseRows ? 1 : 35;
        const ac = reverseColumns ? 10 : 1,
          hc = reverseColumns ? 1 : 10;
        const map = TableMap.get(native.state.doc.firstChild!);
        const selection: Selection = {
          anchor: index.rows[ar].cells[ac].body,
          head: index.rows[hr].cells[hc].body,
          affinity: 1,
          revision: service.revision,
          table: {
            kind: 'cell',
            anchor: { cell: index.rows[ar].cells[ac].from, block: 0, offset: 0 },
            head: { cell: index.rows[hr].cells[hc].from, block: 0, offset: 0 },
          },
        };
        native.view.dispatch(
          native.state.tr.setSelection(
            CellSelection.create(
              native.state.doc,
              1 + map.map[ar * 12 + ac],
              1 + map.map[hr * 12 + hc],
            ),
          ),
        );
        const selected = new Set<string>();
        (native.state.selection as CellSelection).forEachCell((cell) =>
          selected.add(cell.textContent),
        );
        expect(selected.size).toBe(350);
        const exact = structuredClone(selection);
        for (const [r, c] of [
          [0, 0],
          [17, 5],
          [34, 9],
        ]) {
          const pages = service.tableWindowPages(
            index.rows[r].cells[c].body,
            undefined,
            undefined,
            { row: r, column: c, rowCount: 5, columnCount: 3 },
            selection.table,
          )!;
          expect(pages.length).toBeLessThanOrEqual(4);
          for (const page of pages) expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(4096);
          const window = decodeTablePages(pages, service.revision);
          const projection = new TableProjection(window);
          const doc = native.schema.nodeFromJSON(projection.content);
          const mounted = projection.restoreSelection(doc, selection);
          expect(mounted).toBeInstanceOf(CellSelection);
          const names: string[] = [];
          (mounted as CellSelection).forEachCell((cell) => names.push(cell.textContent));
          const visible = projection.entries.map((entry) => doc.nodeAt(entry.pm)!.textContent);
          expect(names.sort()).toEqual(visible.filter((name) => selected.has(name)).sort());
          const anchor = projection.entries.find(
            (entry) => entry.pm === (mounted as CellSelection).$anchorCell.pos,
          )!;
          const head = projection.entries.find(
            (entry) => entry.pm === (mounted as CellSelection).$headCell.pos,
          )!;
          expect(
            reverseRows ? anchor.cell.row >= head.cell.row : anchor.cell.row <= head.cell.row,
          ).toBe(true);
          expect(
            reverseColumns
              ? anchor.cell.column >= head.cell.column
              : anchor.cell.column <= head.cell.column,
          ).toBe(true);
          expect(selection).toEqual(exact);
          expect(
            bytes(JSON.stringify(window)) +
              window.cells.reduce((sum, cell) => sum + bytes(cell.raw), 0),
          ).toBeLessThanOrEqual(16384);
        }
      }
  } finally {
    native.destroy();
  }
});
