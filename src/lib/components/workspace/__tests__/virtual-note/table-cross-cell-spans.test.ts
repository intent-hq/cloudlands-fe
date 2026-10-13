import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const plain of [false, true])
  for (const mode of ['rowspan', 'colspan', 'combined', 'header'] as const)
    for (const backward of [false, true]) {
      it(`preserves native text paste across cells: plain=${plain}, mode=${mode}, backward=${backward}`, async () => {
        let source =
          '| H | K | J |\n| :--- | :---: | ---: |\n| alpha LEFT | middle | beta RIGHT |\n| gamma LEFT | second | delta RIGHT |\n\nTail';
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
        if (mode !== 'header') {
          const map = TableMap.get(native.state.doc.firstChild!);
          const end = mode === 'rowspan' ? 2 * 3 : mode === 'colspan' ? 1 * 3 + 1 : 2 * 3 + 1;
          native.view.dispatch(
            native.state.tr.setSelection(
              CellSelection.create(native.state.doc, 1 + map.map[3], 1 + map.map[end]),
            ),
          );
          expect(native.commands.mergeCells()).toBe(true);
          source = processHTMLToMarkdown(native.getHTML());
        }
        const service = new SourceJournal(() => source, 1),
          session = new DocumentSession(service, document.createElement('div'));
        try {
          const table = scanTables(source)[0];
          const states = new Map<string, string>();
          native.state.doc.firstChild!.forEach((row, _ro, r) =>
            row.forEach((cell, _co, c) =>
              states.set(`cell:${table.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON())),
            ),
          );
          Object.assign(service, { tableStates: states });
          let a = -1,
            h = -1;
          let firstPoint: { cell: number; block: number; offset: number } | undefined,
            lastPoint: { cell: number; block: number; offset: number } | undefined;
          native.state.doc.firstChild!.forEach((row, ro, r) =>
            row.forEach((cell, co, c) => {
              cell.forEach((paragraph, po, block) => {
                if (paragraph.textContent === (mode === 'header' ? 'H' : 'alpha LEFT')) {
                  a = 4 + ro + co + po + (mode === 'header' ? 1 : 6);
                  firstPoint = {
                    cell: table.rows[r].cells[c].from,
                    block,
                    offset: mode === 'header' ? 1 : 6,
                  };
                }
                if (paragraph.textContent === 'beta RIGHT') {
                  h = 4 + ro + co + po + 4;
                  lastPoint = { cell: table.rows[r].cells[c].from, block, offset: 4 };
                }
              });
            }),
          );
          expect(firstPoint).toBeDefined();
          expect(lastPoint).toBeDefined();
          expect(a).toBeGreaterThan(0);
          expect(h).toBeGreaterThan(a);
          native.view.dispatch(
            closeHistory(
              native.state.tr.setSelection(
                TextSelection.create(native.state.doc, backward ? h : a, backward ? a : h),
              ),
            ),
          );
          expect(native.state.selection).toBeInstanceOf(TextSelection);
          const initial = native.getJSON(),
            initialSelection = native.state.selection.toJSON();
          const first = table.rows
              .flatMap((row) => row.cells)
              .find((cell) => cell.from === firstPoint!.cell)!,
            last = table.rows
              .flatMap((row) => row.cells)
              .find((cell) => cell.from === lastPoint!.cell)!;
          session.selection = {
            anchor: backward ? last.body + lastPoint!.offset : first.body + firstPoint!.offset,
            head: backward ? first.body + firstPoint!.offset : last.body + lastPoint!.offset,
            revision: service.revision,
            affinity: 1,
            table: {
              kind: 'text',
              anchor: backward ? lastPoint! : firstPoint!,
              head: backward ? firstPoint! : lastPoint!,
            },
          };
          const before = structuredClone(session.selection);
          await session.seek(first.body);
          const input = {
            'text/plain': plain ? 'NEW **bold** | slash\\\nlast' : '',
            'text/html': plain
              ? ''
              : '<p><strong>NEW</strong></p><p></p><p><code>a|b\\c</code></p>',
          };
          const paste = (editor: Editor, external = false) => {
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
              value: {
                files: [],
                getData: (mime: string) => {
                  if (external) throw new Error('Renderer read whole input');
                  return input[mime as keyof typeof input] ?? '';
                },
              },
            });
            editor.view.dom.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
          };
          paste(native);
          const expected = native.getJSON(),
            expectedSelection = native.state.selection.toJSON();
          expect(native.commands.undo()).toBe(true);
          expect(native.getJSON()).toEqual(initial);
          expect(native.state.selection.toJSON()).toEqual(initialSelection);
          expect(native.commands.redo()).toBe(true);
          expect(native.getJSON()).toEqual(expected);
          expect(native.state.selection.toJSON()).toEqual(expectedSelection);
          const old = session.editor!;
          session.clipboardInput = service.openClipboardInput(input);
          paste(old, true);
          expect(session.error).toBe('');
          const saved = service.region(0);
          const savedTable = scanTables(saved)[0];
          expect(saved.slice(savedTable.delimiter.from, savedTable.delimiter.to)).toBe(
            mode === 'header'
              ? '| --- | --- | :--- |\n'
              : source.slice(table.delimiter.from, table.delimiter.to),
          );
          expect(await processMarkdownToHTML(saved)).toBe(
            await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
          );
          await expect.poll(() => old.isDestroyed).toBe(true);
          const inspect = () => {
            const metadata = Reflect.get(service, 'tableStates') as Map<string, string>;
            const index = scanTables(service.region(0), (from) => {
              const value = metadata.get(`cell:${from}`);
              return value ? JSON.parse(value) : undefined;
            })[0];
            expect(
              index.rows.map((row) =>
                row.cells.map((cell) => JSON.parse(metadata.get(`cell:${cell.from}`)!)),
              ),
            ).toEqual(
              native.state.doc.firstChild!.toJSON().content!.map((row) => row.content ?? []),
            );
          };
          inspect();
          const logicalPoint = ($pos: typeof native.state.selection.$head) => {
            const index = scanTables(saved)[0];
            let found: { cell: number; block: number; offset: number } | undefined;
            native.state.doc.firstChild!.forEach((row, ro, r) =>
              row.forEach((cell, co, c) => {
                const pos = 2 + ro + co;
                if ($pos.pos > pos && $pos.pos < pos + cell.nodeSize)
                  found = {
                    cell: index.rows[r].cells[c].from,
                    block: $pos.index(3),
                    offset: $pos.parentOffset,
                  };
              }),
            );
            expect(found).toBeDefined();
            return found;
          };
          expect(session.selection.table).toEqual({
            kind: 'text',
            anchor: logicalPoint(native.state.selection.$anchor),
            head: logicalPoint(native.state.selection.$head),
          });
          expect(saved.slice(saved.indexOf('\n\nTail'))).toBe('\n\nTail');
          const after = structuredClone(session.selection.table);
          session.save();
          await session.seek(0);
          await session.history();
          expect(service.region(0)).toBe(source);
          expect(session.selection.table).toEqual(before.table);
          await session.history(true);
          expect(service.region(0)).toBe(saved);
          expect(session.selection.table).toEqual(after);
          inspect();
          expect(service.depth).toBe(1);
          expect(service.maxTableWriteBytes).toBeLessThanOrEqual(4096);
          expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
        } finally {
          native.destroy();
          session.destroy();
        }
      });
    }
