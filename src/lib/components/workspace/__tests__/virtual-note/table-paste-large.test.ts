import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const mode of ['merged-input', 'crossing-target', 'combined'] as const) {
  for (const variant of ['large'] as const) {
    it(`preserves native merged-cell paste structure and history: ${mode}/${variant}`, async () => {
      const initial =
        '| A | B | C | D |\n| :--- | :---: | ---: | --- |\n' +
        Array.from(
          { length: 12 },
          (_, r) => `| KEEP${r} | **left${r}** | right${r} | LAST${r} |`,
        ).join('\n') +
        '\n\nUntouched tail';
      const native = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content: await processMarkdownToHTML(initial),
          editable: true,
          useMarkdown: true,
          enableComments: false,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      let session: DocumentSession | undefined;
      const restores: Array<() => void> = [];
      try {
        let map = TableMap.get(native.state.doc.firstChild!);
        if (mode !== 'merged-input') {
          native.view.dispatch(
            native.state.tr.setSelection(
              CellSelection.create(
                native.state.doc,
                1 + map.map[1 * 4 + 1],
                1 + map.map[10 * 4 + 2],
              ),
            ),
          );
          expect(native.commands.mergeCells()).toBe(true);
        }
        const source = processHTMLToMarkdown(native.getHTML()),
          raw = scanTables(source)[0];
        const states = new Map<string, string>(),
          identities = new Map<number, number>();
        native.state.doc.firstChild!.forEach((row, ro, r) =>
          row.forEach((cell, co, c) => {
            const from = raw.rows[r].cells[c].from;
            states.set(`cell:${from}`, JSON.stringify(cell.toJSON()));
            identities.set(2 + ro + co, from);
          }),
        );
        // Full initial metadata and native tree are backing/oracle fixtures, not renderer residency.
        const service = new SourceJournal(() => source, 1);
        Object.assign(service, { tableStates: states });
        session = new DocumentSession(service, document.createElement('div'));
        map = TableMap.get(native.state.doc.firstChild!);
        const a = 1 + map.map[mode === 'merged-input' ? 1 * 4 + 1 : 4 * 4],
          h = 1 + map.map[mode === 'merged-input' ? 10 * 4 + 2 : 5 * 4 + 3];
        native.view.dispatch(
          closeHistory(
            native.state.tr.setSelection(
              CellSelection.create(native.state.doc, false ? h : a, false ? a : h),
            ),
          ),
        );
        const anchor = identities.get(false ? h : a)!,
          head = identities.get(false ? a : h)!;
        session.selection = {
          anchor,
          head,
          revision: service.revision,
          affinity: 1,
          table: {
            kind: 'cell',
            anchor: { cell: anchor, block: 0, offset: 0 },
            head: { cell: head, block: 0, offset: 0 },
          },
        };
        const before = structuredClone(session.selection);
        await session.seek(raw.rows[5].cells[0].body);
        const html =
          mode === 'crossing-target'
            ? `<table><tr><td><p><strong>${'文🌍 '.repeat(1500)}P</strong></p></td><td><p>Q</p></td></tr></table>`
            : `<table><tr><td colspan="2" rowspan="2"><p><strong>${'文🌍 '.repeat(1500)}P</strong></p><p></p><p><code>a|b\\c</code></p></td></tr><tr></tr></table>`;
        const paste = (editor: Editor, external = false) => {
          const event = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', {
            value: {
              files: [],
              getData: (mime: string) => {
                if (external) throw new Error('Renderer read full clipboard input');
                return mime === 'text/html' ? html : '';
              },
            },
          });
          editor.view.dom.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        };
        const nativeBefore = native.getJSON(),
          nativeSelectionBefore = native.state.selection.toJSON();
        paste(native);
        const nativeAfter = native.getJSON(),
          nativeSelectionAfter = native.state.selection.toJSON();
        expect(native.commands.undo()).toBe(true);
        expect(native.getJSON()).toEqual(nativeBefore);
        expect(native.state.selection.toJSON()).toEqual(nativeSelectionBefore);
        expect(native.commands.redo()).toBe(true);
        expect(native.getJSON()).toEqual(nativeAfter);
        expect(native.state.selection.toJSON()).toEqual(nativeSelectionAfter);
        session.clipboardInput = service.openClipboardInput({
          'text/plain': '',
          'text/html': html,
        });
        const old = session.editor!;
        paste(old, true);
        restores.splice(0).forEach((restore) => restore());
        expect(session.error).toBe('');
        const saved = service.region(0);
        expect(await processMarkdownToHTML(saved)).toBe(
          await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
        );
        const inspect = () => {
          const metadata = Reflect.get(service, 'tableStates') as Map<string, string>;
          const table = scanTables(service.region(0), (from) => {
            const record = metadata.get(`cell:${from}`);
            return record ? JSON.parse(record) : undefined;
          })[0];
          // Complete equality is an external assertion oracle; no full tree enters a renderer.
          expect(
            table.rows.map((row) =>
              row.cells.map((cell) => JSON.parse(metadata.get(`cell:${cell.from}`)!)),
            ),
          ).toEqual(native.state.doc.firstChild!.toJSON().content!.map((row) => row.content ?? []));
        };
        inspect();
        const logicalSelection = () => {
          const metadata = Reflect.get(service, 'tableStates') as Map<string, string>;
          const table = scanTables(service.region(0), (from) => {
            const json = metadata.get(`cell:${from}`);
            return json ? JSON.parse(json) : undefined;
          })[0];
          const positions = new Map<number, number>();
          native.state.doc.firstChild!.forEach((row, ro, r) =>
            row.forEach((_cell, co, c) => positions.set(2 + ro + co, table.rows[r].cells[c].from)),
          );
          const selection = native.state.selection as CellSelection;
          return {
            kind: 'cell',
            anchor: { cell: positions.get(selection.$anchorCell.pos), block: 0, offset: 0 },
            head: { cell: positions.get(selection.$headCell.pos), block: 0, offset: 0 },
          };
        };
        expect(session.selection.table).toEqual(logicalSelection());
        expect(saved.slice(saved.indexOf('Untouched tail'))).toBe(
          source.slice(source.indexOf('Untouched tail')),
        );
        const beforeTable = scanTables(source, (from) => {
          const json = states.get(`cell:${from}`);
          return json ? JSON.parse(json) : undefined;
        })[0];
        const currentStates = Reflect.get(service, 'tableStates') as Map<string, string>;
        const afterTable = scanTables(saved, (from) => {
          const json = currentStates.get(`cell:${from}`);
          return json ? JSON.parse(json) : undefined;
        })[0];
        expect(saved.slice(afterTable.delimiter.from, afterTable.delimiter.to)).toBe(
          source.slice(beforeTable.delimiter.from, beforeTable.delimiter.to),
        );
        for (const row of beforeTable.rows)
          for (const cell of row.cells) {
            const afterCell = afterTable.rows[cell.row].cells.find((c) => c.column === cell.column);
            if (
              !afterCell ||
              states.get(`cell:${cell.from}`) !== currentStates.get(`cell:${afterCell.from}`)
            )
              continue;
            expect(saved.slice(afterCell.from, afterCell.to)).toBe(
              source.slice(cell.from, cell.to),
            );
          }
        await expect.poll(() => old.isDestroyed).toBe(true);
        session.save();
        await session.seek(0);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.table).toEqual(before.table);
        await session.history(true);
        expect(service.region(0)).toBe(saved);
        inspect();
        expect(session.selection.table).toEqual(logicalSelection());
        expect(service.depth).toBe(1);
        expect(session.clipboardRelay.pages).toBeGreaterThan(1);
        expect(new TextEncoder().encode(html).length).toBeGreaterThan(4096);
        expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
        expect(session.snapshot().externalClipboardInput.maxBackingPastePlanBytes).toBeGreaterThan(
          0,
        );
        expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      } finally {
        restores.forEach((restore) => restore());
        native.destroy();
        session?.destroy();
      }
    });
  }
}
