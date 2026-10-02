import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap, goToNextCell } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const [height, width] of [
  [12, 1],
  [1, 3],
  [12, 3],
]) {
  it(`resolves native owners and physical Tab order for ${height}x${width} spans in both directions`, async () => {
    const source =
      '| H0 | H1 | H2 | H3 |\n| --- | --- | --- | --- |\n' +
      Array.from({ length: 14 }, (_, r) => `| r${r}c0 | r${r}c1 | r${r}c2 | r${r}c3 |`).join('\n');
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
    try {
      let map = TableMap.get(native.state.doc.firstChild!);
      native.view.dispatch(
        native.state.tr.setSelection(
          CellSelection.create(
            native.state.doc,
            1 + map.map[4],
            1 + map.map[height * 4 + width - 1],
          ),
        ),
      );
      expect(native.commands.mergeCells()).toBe(true);
      const saved = processHTMLToMarkdown(native.getHTML());
      const raw = scanTables(saved)[0];
      const service = new SourceJournal(() => saved, 1);
      // Full native tree/source/index are external fixture and oracle allocations.
      const metadata = (service as unknown as { tableStates: Map<string, string> }).tableStates;
      const positions = new Map<number, number>();
      native.state.doc.firstChild!.forEach((row, ro, r) =>
        row.forEach((cell, co, c) => {
          const from = raw.rows[r].cells[c].from;
          metadata.set(`cell:${from}`, JSON.stringify(cell.toJSON() as JSONContent));
          positions.set(ro + co + 2, from);
        }),
      );
      map = TableMap.get(native.state.doc.firstChild!);
      for (let r = 0; r < map.height; r++)
        for (let c = 0; c < map.width; c++) {
          expect(service.tableAddress(0, r, c).point.cell).toBe(
            positions.get(1 + map.map[r * map.width + c]),
          );
        }
      for (const [pos, from] of positions)
        for (const direction of [-1, 1]) {
          native.commands.setTextSelection(pos + 2);
          const moved = goToNextCell(direction)(native.state, native.view.dispatch);
          const next = service.tableNeighbor(from, direction);
          if (!moved) expect(next).toBeUndefined();
          else {
            const selection = native.state.selection;
            expect(next?.point.cell).toBe(positions.get(selection.$head.before(3)));
            expect(next?.revision).toBe(1);
            expect(next?.point.block).toBe(0);
          }
        }
      expect(service.region(0)).toBe(saved);
    } finally {
      native.destroy();
    }
  });
}
