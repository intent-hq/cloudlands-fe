import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables, type TableIndex } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const cases = [
  { command: 'addRowBefore', row: 0, column: 1 },
  { command: 'deleteRow', row: 0, column: 1 },
  { command: 'mergeCells', row: 0, column: 0, endRow: 0, endColumn: 1 },
  { command: 'toggleHeaderRow', row: 21, column: 4 },
  { command: 'toggleHeaderColumn', row: 21, column: 4 },
  { command: 'addColumnBefore', row: 21, column: 4 },
  { command: 'deleteColumn', row: 21, column: 4 },
  { command: 'mergeCells', row: 2, column: 0, endRow: 35, endColumn: 1 },
  { command: 'mergeCells', row: 35, column: 1, endRow: 2, endColumn: 0 },
] as const;
for (const test of cases) {
  it(`matches native logical ${test.command} at ${test.row},${test.column} ${'endRow' in test ? `to ${test.endRow},${test.endColumn}` : ''}`, async () => {
    const row = (r: number) =>
      '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |';
    const source =
      row(0) +
      '\n| ' +
      Array(8).fill('---').join(' | ') +
      ' |\n' +
      Array.from({ length: 60 }, (_, r) => row(r + 1)).join('\n');
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
    const session = new DocumentSession(service, document.createElement('div'));
    const index = scanTables(source)[0];
    // Test oracle only: full backing JSON is never returned through a renderer request.
    const backingJSON = async () => {
      const saved = service.region(0);
      const backing = service as unknown as {
        tableIndex: (s: string, start: number) => TableIndex[];
        tableStates: Map<string, string>;
      };
      const table = backing.tableIndex(saved, 0)[0];
      const canonical = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content: await processMarkdownToHTML(saved),
          editable: true,
          useMarkdown: true,
          enableComments: false,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      try {
        return {
          type: 'table',
          content: table.rows.map((r, ri) => ({
            type: 'tableRow',
            content: r.cells.map((c, ci) => {
              const stored = backing.tableStates.get(`cell:${c.from}`);
              return stored
                ? (JSON.parse(stored) as JSONContent)
                : canonical.state.doc.firstChild!.child(ri).child(ci).toJSON();
            }),
          })),
        };
      } finally {
        canonical.destroy();
      }
    };
    try {
      const anchor = index.rows[test.row].cells[test.column];
      const head = 'endRow' in test ? index.rows[test.endRow].cells[test.endColumn] : anchor;
      const map = TableMap.get(native.state.doc.firstChild!);
      const ap = 1 + map.map[test.row * 8 + test.column];
      const hp = 'endRow' in test ? 1 + map.map[test.endRow * 8 + test.endColumn] : ap;
      if ('endRow' in test)
        native.view.dispatch(
          native.state.tr.setSelection(CellSelection.create(native.state.doc, ap, hp)),
        );
      else native.commands.setTextSelection(ap + 2);
      session.selection = {
        anchor: anchor.body,
        head: head.body,
        affinity: anchor.body <= head.body ? 1 : -1,
        revision: 1,
        table: {
          kind: 'endRow' in test ? 'cell' : 'text',
          anchor: { cell: anchor.from, block: 0, offset: 0 },
          head: { cell: head.from, block: 0, offset: 0 },
        },
      };
      await session.seek(head.body);
      const before = native.state.doc.firstChild!.toJSON();
      const revisionBeforeCan = service.revision;
      expect(session.editor!.can()[test.command]()).toBe(native.can()[test.command]());
      expect(service.revision).toBe(revisionBeforeCan);
      expect(service.region(0)).toBe(source);
      expect(native.commands[test.command]()).toBe(true);
      expect(session.editor!.commands[test.command]()).toBe(true);
      expect(session.error).toBe('');
      expect(await backingJSON()).toEqual(native.state.doc.firstChild!.toJSON());
      const backing = service as unknown as { tableIndex: (s: string, start: number) => TableIndex[] };
      const afterIndex = backing.tableIndex(service.region(0), 0)[0];
      const selection = native.state.selection;
      const cells = selection instanceof CellSelection;
      const point = (pos: typeof selection.$head) => ({
        cell: afterIndex.rows[pos.index(1)].cells[pos.index(2)].from,
        block: cells ? 0 : pos.index(3),
        offset: cells ? 0 : pos.parentOffset,
      });
      expect(session.selection.table).toEqual({
        kind: cells ? 'cell' : 'text',
        anchor: point(cells ? selection.$anchorCell : selection.$anchor),
        head: point(cells ? selection.$headCell : selection.$head),
      });
      const old = session.editor!;
      const saved = service.region(0);
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(service.region(0)).toBe(saved);
      expect(await backingJSON()).toEqual(native.state.doc.firstChild!.toJSON());
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(await backingJSON()).toEqual(before);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      expect(await backingJSON()).toEqual(native.state.doc.firstChild!.toJSON());
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
