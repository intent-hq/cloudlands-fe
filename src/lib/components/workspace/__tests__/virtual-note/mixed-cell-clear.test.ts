import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { scanTables, type TableIndex } from './table-source';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const native = async (source: string) => {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: await processMarkdownToHTML(source),
    editable: true,
    useMarkdown: true,
    enableComments: false,
    enableMentions: false,
    onUpdate: () => {},
  });
  return new Editor({ ...config, extensions: [...config.extensions!, CommentAnchor] });
};
for (const backward of [false, true])
  for (const merged of [false, true])
    it(`clears a partial mixed logical rectangle ${backward ? 'backward' : 'forward'}${merged ? ' with a span' : ''}`, async () => {
      const prefix = 'before\n\n',
        suffix = '\nafter';
      let source =
        prefix +
        '| A | B | <!--anchor:keep:start-->KEEP<!--anchor:keep:end--> |\n| --- | --- | --- |\n' +
        Array.from({ length: 800 }, (_, i) => `| row${i} | value${i} | untouched${i} |\n`).join(
          '',
        ) +
        suffix;
      const oracle = await native(source);
      const tablePos = oracle.state.doc.firstChild!.nodeSize;
      if (merged) {
        const map = TableMap.get(oracle.state.doc.nodeAt(tablePos)!);
        oracle.commands.setCellSelection({
          anchorCell: tablePos + 1 + map.map[100 * 3],
          headCell: tablePos + 1 + map.map[101 * 3 + 1],
        });
        expect(oracle.commands.mergeCells()).toBe(true);
        source = processHTMLToMarkdown(oracle.getHTML());
      }
      const backing = new SourceJournal(() => source, 1);
      if (merged) {
        const physical = scanTables(source)[0];
        const states = (backing as unknown as { tableStates: Map<string, string> }).tableStates;
        oracle.state.doc
          .nodeAt(tablePos)!
          .forEach((row, _p, r) =>
            row.forEach((cell, _q, c) =>
              states.set(`cell:${physical.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON())),
            ),
          );
      }
      const session = new DocumentSession(backing, document.createElement('div'));
      const index = (
        backing as unknown as { tableIndex(s: string, start: number): TableIndex[] }
      ).tableIndex(source, 0)[0];
      const first = index.rows[0].cells[0],
        last = index.rows.at(-1)!.cells[1];
      const anchor = backward ? last : first,
        head = backward ? first : last;
      const map = TableMap.get(oracle.state.doc.nodeAt(tablePos)!);
      oracle.view.dispatch(
        oracle.state.tr.setSelection(
          CellSelection.create(
            oracle.state.doc,
            tablePos + 1 + map.map[backward ? 800 * 3 + 1 : 0],
            tablePos + 1 + map.map[backward ? 0 : 800 * 3 + 1],
          ),
        ),
      );
      session.selection = {
        anchor: anchor.body,
        head: head.body,
        affinity: backward ? -1 : 1,
        revision: backing.revision,
        table: {
          kind: 'cell',
          anchor: { cell: anchor.from, block: 0, offset: 0 },
          head: { cell: head.from, block: 0, offset: 0 },
        },
      };
      const backingJSON = async () => {
        const saved = backing.region(0),
          fresh = await native(saved);
        try {
          const table = (
            backing as unknown as { tableIndex(s: string, start: number): TableIndex[] }
          ).tableIndex(saved, 0)[0];
          const states = (backing as unknown as { tableStates: Map<string, string> }).tableStates;
          const doc = fresh.getJSON();
          doc.content![1] = {
            type: 'table',
            content: table.rows.map((r, ri) => ({
              type: 'tableRow',
              content: r.cells.map((c, ci) => {
                const stored = states.get(`cell:${c.from}`);
                return stored
                  ? (JSON.parse(stored) as JSONContent)
                  : doc.content![1].content![ri].content![ci];
              }),
            })),
          };
          return doc;
        } finally {
          fresh.destroy();
        }
      };
      try {
        await session.seek(backward ? 0 : source.length - 1);
        expect(session.projection!.mixed).toBeDefined();
        const intent = {
          revision: backing.revision,
          table: index.from,
          command: 'deleteCellSelection' as const,
          selection: structuredClone(session.selection),
        };
        const beforeCan = backing.revision;
        expect(backing.stageLogicalTableCommand(intent, session.editor!, false, false)).not.toBe(
          false,
        );
        expect(backing.revision).toBe(beforeCan);
        expect(backing.region(0)).toBe(source);
        for (const editor of [oracle, session.editor!]) {
          let handled = false;
          editor.view.someProp('handleKeyDown', (handler) => {
            if (
              handler(
                editor.view,
                new KeyboardEvent('keydown', { key: backward ? 'Backspace' : 'Delete' }),
              )
            ) {
              handled = true;
              return true;
            }
          });
          expect(handled).toBe(true);
        }
        expect(session.error).toBe('');
        await session.seek(session.selection.head);
        expect(await backingJSON()).toEqual(oracle.getJSON());
        expect(backing.region(0)).toContain('<!--anchor:keep:start-->KEEP<!--anchor:keep:end-->');
        expect(backing.region(0)).toContain('untouched400');
        const saved = backing.region(0),
          old = session.editor!;
        const revision = backing.revision,
          selection = structuredClone(session.selection);
        expect(() => backing.stageLogicalTableCommand(intent, session.editor!)).toThrow('Stale');
        expect(() =>
          session.remote({
            from: saved.indexOf('untouched400'),
            to: saved.indexOf('untouched400') + 1,
            insert: 'X',
          }),
        ).toThrow('Conflict');
        expect(backing.revision).toBe(revision);
        expect(backing.region(0)).toBe(saved);
        expect(session.selection).toEqual(selection);
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        expect(await backingJSON()).toEqual(oracle.getJSON());
        const afterIndex = (
          backing as unknown as { tableIndex(s: string, start: number): TableIndex[] }
        ).tableIndex(saved, 0)[0];
        const afterAnchor = backward
          ? afterIndex.rows.at(-1)!.cells[1]
          : afterIndex.rows[0].cells[0];
        const afterHead = backward ? afterIndex.rows[0].cells[0] : afterIndex.rows.at(-1)!.cells[1];
        expect(session.selection.table).toEqual({
          kind: 'cell',
          anchor: { cell: afterAnchor.from, block: 0, offset: 0 },
          head: { cell: afterHead.from, block: 0, offset: 0 },
        });
        const nativeSelection = oracle.state.selection as CellSelection;
        oracle.commands.setTextSelection(nativeSelection.$headCell.pos + 2);
        session.editor!.commands.setTextSelection(session.projection!.pmAt(session.selection.head));
        for (const editor of [oracle, session.editor!]) {
          const tr = editor.state.tr.insertText('EDIT');
          tr.setTime(Date.now() + 2000);
          editor.view.dispatch(tr);
        }
        expect(session.error).toBe('');
        expect(await backingJSON()).toEqual(oracle.getJSON());
        const edited = backing.region(0);
        await session.seek(session.selection.head);
        expect(await backingJSON()).toEqual(oracle.getJSON());
        await session.history();
        expect(backing.region(0)).toBe(saved);
        await session.history();
        expect(backing.region(0)).toBe(source);
        await session.history(true);
        expect(backing.region(0)).toBe(saved);
        await session.history(true);
        expect(backing.region(0)).toBe(edited);
        expect(await backingJSON()).toEqual(oracle.getJSON());
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(session.snapshot().maxSourceRead).toBeLessThanOrEqual(4096);
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });
