import { beforeAll, afterAll, it, expect } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { scanTables, admitTableWindow } from './table-source';
import { TableProjection } from './table-projection';
import { encodeTablePages, decodeTablePages } from './table-transfer';
import { bytes } from './bounded-note-service';
import { packTableWindow } from './table-payload';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());
it('admits one bounded logical owner continuation at vertical span origin, interior and end', async () => {
  const source =
    '| H | R |\n| :--- | ---: |\n' +
    Array.from({ length: 120 }, (_, r) => `| left${r} | right${r} |`).join('\n');
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
    const cells: number[] = [];
    native.state.doc.descendants((n, p) => {
      if (n.type.name === 'tableCell' && n.textContent.startsWith('left')) cells.push(p);
    });
    native.view.dispatch(
      native.state.tr.setSelection(CellSelection.create(native.state.doc, cells[0], cells.at(-1)!)),
    );
    expect(native.commands.mergeCells()).toBe(true);
    const full = native.state.doc.firstChild!,
      saved = processHTMLToMarkdown(native.getHTML());
    // Full source/native tree/index are mock backing and independent oracle costs only.
    const raw = scanTables(saved)[0],
      metadata = new Map<number, JSONContent>();
    full.forEach((row, _p, r) =>
      row.forEach((cell, _q, c) => metadata.set(raw.rows[r].cells[c].from, cell.toJSON())),
    );
    const index = scanTables(saved, (from) => metadata.get(from))[0];
    const owner = raw.rows[1].cells[0];
    const records = [];
    for (const row of [1, 95, 118]) {
      const count = Math.min(5, 121 - row);
      const window = admitTableWindow(
        saved,
        index,
        index.rows[row].cells.at(-1)!.body,
        7,
        (c) => metadata.get(c.from),
        undefined,
        undefined,
        { row, column: 0, rowCount: count, columnCount: 2 },
      );
      const wire = encodeTablePages(packTableWindow(window));
      expect(wire.length).toBeLessThanOrEqual(4);
      for (const page of wire) expect(bytes(JSON.stringify(page))).toBeLessThanOrEqual(4096);
      const received = decodeTablePages(JSON.parse(JSON.stringify(wire)), 7);
      const projection = new TableProjection(received);
      const doc = native.schema.nodeFromJSON(projection.content),
        table = doc.firstChild!,
        map = TableMap.get(table);
      expect(map.problems).toBeNull();
      expect(map.width).toBe(2);
      expect(map.height).toBe(count);
      const continuation = received.cells.filter((c) => c.from === owner.from);
      expect(continuation).toHaveLength(1);
      expect(continuation[0].attrs!.rowspan).toBe(120);
      // A continuation at the logical row must expose that owner's corresponding
      // native paragraph, not replay the first seven blocks at every position.
      expect(continuation[0].blocks!.some((block) => block.index === row - 1)).toBe(true);
      for (const block of continuation[0].blocks!) {
        expect(
          continuation[0].runs
            .filter((run) => run.block === block.index)
            .map((run) => run.text)
            .join(''),
        ).toBe(full.child(1).firstChild!.child(block.index).textContent);
      }
      expect(table.firstChild!.firstChild!.attrs.rowspan).toBe(count);
      expect(projection.entries.filter((e) => e.cell.from === owner.from)).toHaveLength(1);
      for (let r = 0; r < count; r++) {
        const nativeRight = full.child(row + r).lastChild!;
        const localRight = table.nodeAt(map.map[r * 2 + 1])!;
        expect(localRight.toJSON()).toEqual(nativeRight.toJSON());
      }
      expect(
        bytes(JSON.stringify(received)) + received.cells.reduce((n, c) => n + bytes(c.raw), 0),
      ).toBeLessThanOrEqual(16384);
      records.push({
        row,
        count,
        bytes: bytes(JSON.stringify(received)),
        cells: received.cells.length,
        continuation: continuation[0],
        map: { width: map.width, height: map.height },
      });
    }
    console.info('Bounded vertical span projection', JSON.stringify(records));
    const service = new SourceJournal(() => saved, 1);
    for (const [from, node] of metadata)
      (service as unknown as { tableStates: Map<string, string> }).tableStates.set(`cell:${from}`, JSON.stringify(node));
    const measuredVisits = [];
    for (const row of [1, 50, 95, 118]) {
      const window = service.tableViewportWindow(index.rows[row].cells.at(-1)!.body, {
        top: row * 41, left: 0, width: 550, height: 520, font: 'sans-serif|16px|24px|normal',
      })!;
      const fragment = window.cells.find((c) => c.from === owner.from)!;
      measuredVisits.push({ row, geometry: window.geometry, blocks: fragment.blocks, text: fragment.runs.map((r) => r.text).join('') });
      // Unit measurement model; the independent browser probe measures actual
      // paragraphs. A full owner's estimate must not be assigned to one row.
      service.tableHeights.record(window.geometry!, window.geometry!.heights.map(() => 41));
      service.tableHeights.measureCells(window, [{ cell: owner.from, height: fragment.blocks!.length * 40 - 16, padding: 17 }]);
      expect(service.transferTable(window).length).toBeLessThanOrEqual(4);
    }
    console.info('Measured merged owner progression', JSON.stringify(measuredVisits));
    expect(new Set(measuredVisits.map((v) => v.text)).size).toBe(measuredVisits.length);
    expect(service.region(0)).toBe(saved);
  } finally {
    native.destroy();
  }
});
