import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { scanTables } from './table-source';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const operation of [
  'typing',
  'header',
  'splitInterior',
  'splitEnd',
  'splitSelection',
  'rollback',
  'stale',
] as const)
  it(`preserves full logical span during ${operation} in an interior native continuation`, async () => {
    const original =
      '| H | R |\n| :--- | ---: |\n' +
      Array.from({ length: 125 }, (_, r) => `| left${r} | right${r} |`).join('\n');
    const native = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(original),
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    let session: DocumentSession | undefined;
    try {
      const cells: number[] = [];
      native.state.doc.descendants((n, p) => {
        if (n.type.name === 'tableCell' && n.textContent.startsWith('left')) cells.push(p);
      });
      native.view.dispatch(
        native.state.tr.setSelection(CellSelection.create(native.state.doc, cells[0], cells[119])),
      );
      expect(native.commands.mergeCells()).toBe(true);
      const source = processHTMLToMarkdown(native.getHTML()),
        raw = scanTables(source)[0];
      const full = native.state.doc.firstChild!,
        metadata = new Map<string, string>();
      full.forEach((row, _p, r) =>
        row.forEach((cell, _q, c) =>
          metadata.set(`cell:${raw.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON())),
        ),
      );
      const service = new SourceJournal(() => source, 1);
      // Explicit unbounded mock initial session records. This fixture bypass is NOT
      // a renderer write path or evidence of bounded merge admission.
      Object.assign(service, { tableStates: metadata });
      session = new DocumentSession(service, document.createElement('div'));
      await session.seek(source.indexOf(operation === 'splitEnd' ? 'right121' : 'right94'));
      const entry = session.projection!.table!.entries.find(
        (e) => e.cell.from === raw.rows[1].cells[0].from,
      )!;
      expect(entry.cell.owner?.rowspan).toBe(120);
      expect(entry.cell.mounted!.rowspan).toBe(operation === 'splitEnd' ? 1 : 5);
      native.commands.setTextSelection(cells[0] + 4);
      session.editor!.commands.setTextSelection(entry.paragraph + 3);
      if (operation === 'splitSelection') {
        native.view.dispatch(
          native.state.tr.setSelection(CellSelection.create(native.state.doc, cells[0])),
        );
        session.editor!.view.dispatch(
          session.editor!.state.tr.setSelection(
            CellSelection.create(session.editor!.state.doc, entry.pm),
          ),
        );
      }
      const created = session.created;
      if (operation === 'rollback' || operation === 'stale') {
        const before = {
          source: service.region(0),
          revision: service.revision,
          depth: service.depth,
          doc: session.editor!.getJSON(),
          selection: structuredClone(session.selection),
          nativeSelection: session.editor!.state.selection.toJSON(),
          owner: JSON.parse(JSON.stringify(service.tableWindow(raw.rows[1].cells[0].body))),
        };
        const split = service.stageLogicalTableSplit.bind(service);
        const injection =
          operation === 'rollback'
            ? vi.spyOn(service, 'record').mockImplementationOnce(() => {
                throw new Error('injected logical split journal failure');
              })
            : vi
                .spyOn(service, 'stageLogicalTableSplit')
                .mockImplementationOnce((intent) =>
                  split({ ...intent, revision: intent.revision - 1 }),
                );
        expect(session.editor!.commands.splitCell()).toBe(true);
        injection.mockRestore();
        await Promise.resolve();
        expect(session.error).toMatch(
          operation === 'rollback' ? /injected logical split/ : /Stale logical table/,
        );
        expect(service.region(0)).toBe(before.source);
        expect(service.revision).toBe(before.revision);
        expect(service.depth).toBe(before.depth);
        expect(session.editor!.getJSON()).toEqual(before.doc);
        expect(session.editor!.state.selection.toJSON()).toEqual(before.nativeSelection);
        expect(session.selection).toEqual(before.selection);
        expect(JSON.parse(JSON.stringify(service.tableWindow(raw.rows[1].cells[0].body)))).toEqual(
          before.owner,
        );
        expect(session.created).toBe(created);
        return;
      }
      for (const editor of [native, session.editor!]) {
        if (operation === 'typing') expect(editor.commands.insertContent('Z')).toBe(true);
        else if (operation === 'header') expect(editor.commands.toggleHeaderCell()).toBe(true);
        else {
          expect(editor.can().splitCell()).toBe(true);
          expect(editor.commands.splitCell()).toBe(true);
        }
      }
      expect(session.error).toBe('');
      if (operation === 'header') {
        // Logical commands commit source/session state synchronously; mounted
        // metadata arrives through the same paged view replacement as split.
        const committed = service
          .tableWindow(raw.rows[1].cells[0].body)!
          .cells.find((cell) => cell.from === raw.rows[1].cells[0].from)!;
        expect(committed.nodeType).toBe('tableHeader');
        expect(committed.attrs.rowspan).toBe(120);
      }
      if (operation.startsWith('split') || operation === 'header')
        await expect.poll(() => session!.created).toBeGreaterThan(created);
      if (operation === 'splitSelection') {
        expect(native.state.selection).toBeInstanceOf(CellSelection);
        expect(session.selection.table?.kind).toBe('cell');
        expect(session.editor!.state.selection).toBeInstanceOf(CellSelection);
        const fullCells: number[] = [];
        native.state.selection.forEachCell((_node, pos) => fullCells.push(pos));
        expect(fullCells).toHaveLength(120);
        expect(session.selection.table!.anchor.cell).toBe(raw.rows[1].cells[0].from);
        expect(session.selection.table!.head.cell).toBe(
          scanTables(service.region(0))[0].rows[120].cells[0].from,
        );
      }
      const durableSelection = structuredClone(session.selection);
      const assertMountedSelection = () => {
        if (operation !== 'splitSelection') return;
        expect(session.selection.table).toEqual(durableSelection.table);
        expect(session.editor!.state.selection).toBeInstanceOf(CellSelection);
        const selected: number[] = [];
        (session.editor!.state.selection as CellSelection).forEachCell((_node, pos) =>
          selected.push(pos),
        );
        const visible = session.projection!.table!.entries.filter(
          (e) => e.cell.row >= 1 && e.cell.row <= 120 && e.cell.column === 0,
        );
        expect(selected.sort((a, b) => a - b)).toEqual(
          visible.map((e) => e.pm).sort((a, b) => a - b),
        );
      };
      assertMountedSelection();
      const expected = native.state.doc.firstChild!.child(1).child(0).toJSON();
      const inspect = () => {
        const cell = operation.startsWith('split')
          ? service
              .tableWindow(raw.rows[1].cells[0].body)!
              .cells.find((c) => c.from === raw.rows[1].cells[0].from)!
          : session!.projection!.table!.entries.find(
              (e) => e.cell.from === raw.rows[1].cells[0].from,
            )!.cell;
        return { type: cell.nodeType, attrs: cell.attrs };
      };
      expect(inspect()).toEqual({ type: expected.type, attrs: expected.attrs });
      const saved = service.region(0);
      if (operation.startsWith('split'))
        expect(await processMarkdownToHTML(saved)).toBe(
          await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
        );
      else
        expect(saved).toBe(
          operation === 'typing'
            ? source.slice(0, raw.rows[1].cells[0].body + 2) +
                'Z' +
                source.slice(raw.rows[1].cells[0].body + 2)
            : source,
        );
      const old = session.editor!;
      session.save();
      await session.seek(saved.indexOf('right94'));
      expect(old.isDestroyed).toBe(true);
      assertMountedSelection();
      expect(inspect()).toEqual({ type: expected.type, attrs: expected.attrs });
      await session.history();
      expect(service.region(0)).toBe(source);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      assertMountedSelection();
      // Redo restores the full cell selection's head at row120. The owner is then
      // genuinely unloaded; inspect it through a bounded page, not a full table.
      const current =
        operation === 'splitSelection'
          ? service
              .tableWindow(raw.rows[1].cells[0].body)!
              .cells.find((c) => c.from === raw.rows[1].cells[0].from)!
          : session.projection!.table!.entries.find(
              (e) => e.cell.from === raw.rows[1].cells[0].from,
            )!.cell;
      expect(current.attrs!.rowspan).toBe(operation.startsWith('split') ? 1 : 120);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
      console.info('Clipped span edit', {
        operation,
        logical: inspect(),
        stats: session.snapshot(),
        backingMetadataBytes: [...metadata.values()].reduce(
          (n, s) => n + new TextEncoder().encode(s).length,
          0,
        ),
      });
    } finally {
      native.destroy();
      session?.destroy();
    }
  });
