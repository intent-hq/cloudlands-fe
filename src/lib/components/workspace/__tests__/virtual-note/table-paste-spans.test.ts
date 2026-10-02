import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
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
  it(`preserves native merged-cell paste structure and history: ${mode}`, async () => {
    const initial =
      '| A | B | C | D |\n| :--- | :---: | ---: | --- |\n' +
      Array.from(
        { length: 12 },
        (_, r) => `| KEEP${r} | **left${r}** | right${r} | LAST${r} |`,
      ).join('\n');
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
    try {
      let map = TableMap.get(native.state.doc.firstChild!);
      if (mode !== 'merged-input') {
        native.view.dispatch(
          native.state.tr.setSelection(
            CellSelection.create(native.state.doc, 1 + map.map[1 * 4 + 1], 1 + map.map[10 * 4 + 2]),
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
        native.state.tr.setSelection(CellSelection.create(native.state.doc, a, h)),
      );
      const anchor = identities.get(a)!,
        head = identities.get(h)!;
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
          ? '<table><tr><td><p><strong>P</strong></p></td><td><p>Q</p></td></tr></table>'
          : '<table><tr><td colspan="2" rowspan="2"><p><strong>P</strong></p><p></p><p><code>a|b\\c</code></p></td></tr><tr></tr></table>';
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
      paste(native);
      session.clipboardInput = service.openClipboardInput({ 'text/plain': '', 'text/html': html });
      const old = session.editor!;
      paste(old, true);
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
      await expect.poll(() => old.isDestroyed).toBe(true);
      session.save();
      await session.seek(0);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection.table).toEqual(before.table);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      inspect();
      expect(service.depth).toBe(1);
      expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      native.destroy();
      session?.destroy();
    }
  });
}
