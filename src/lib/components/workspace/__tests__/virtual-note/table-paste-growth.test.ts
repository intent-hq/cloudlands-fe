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
for (const direction of ['right', 'bottom', 'both'] as const) {
  it(`matches native rich paste growth from a text caret: ${direction}`, async () => {
    const source =
      '| A | B | C |\n| :--- | :---: | ---: |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n\nUntouched tail';
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
    try {
      const row = direction === 'right' ? 1 : 3,
        column = direction === 'bottom' ? 0 : 2;
      const table = scanTables(source)[0],
        target = table.rows[row].cells[column];
      const map = TableMap.get(native.state.doc.firstChild!);
      native.commands.setTextSelection(1 + map.map[row * 3 + column] + 2);
      const nativeBefore = native.getJSON(),
        selectionBefore = native.state.selection.toJSON();
      session.selection = {
        anchor: target.body,
        head: target.body,
        affinity: 1,
        revision: service.revision,
        table: {
          kind: 'text',
          anchor: { cell: target.from, block: 0, offset: 0 },
          head: { cell: target.from, block: 0, offset: 0 },
        },
      };
      const before = structuredClone(session.selection);
      await session.seek(target.body);
      const html =
        '<table><tr><td colspan="2" rowspan="2"><p><strong>PASTE</strong></p><p></p><p><code>a|b\\c</code></p></td></tr><tr></tr></table>';
      expect(
        native.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent),
      ).toBe(true);
      const nativeAfter = native.getJSON(),
        selectionAfter = native.state.selection.toJSON();
      expect(native.commands.undo()).toBe(true);
      expect(native.getJSON()).toEqual(nativeBefore);
      expect(native.state.selection.toJSON()).toEqual(selectionBefore);
      expect(native.commands.redo()).toBe(true);
      expect(native.getJSON()).toEqual(nativeAfter);
      expect(native.state.selection.toJSON()).toEqual(selectionAfter);
      const old = session.editor!;
      session.clipboardInput = service.openClipboardInput({ 'text/html': html, 'text/plain': '' });
      // The backing input path receives only a revisioned manifest. The renderer
      // must not receive the full HTML or a target-table DOM to achieve growth.
      expect(() => session.pasteTableSelection()).not.toThrow();
      const saved = service.region(0);
      expect(await processMarkdownToHTML(saved)).toBe(
        await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
      );
      expect(saved.endsWith('Untouched tail')).toBe(true);
      await expect.poll(() => old.isDestroyed).toBe(true);
      const states = Reflect.get(service, 'tableStates') as Map<string, string>;
      const updated = scanTables(saved, (from) => {
        const value = states.get(`cell:${from}`);
        return value ? JSON.parse(value) : undefined;
      })[0];
      const post = native.state.selection as CellSelection;
      const positions = new Map<number, number>();
      native.state.doc.firstChild!.forEach((r, ro, ri) =>
        r.forEach((_c, co, ci) => positions.set(2 + ro + co, updated.rows[ri].cells[ci].from)),
      );
      expect(session.selection.table).toEqual({
        kind: 'cell',
        anchor: { cell: positions.get(post.$anchorCell.pos), block: 0, offset: 0 },
        head: { cell: positions.get(post.$headCell.pos), block: 0, offset: 0 },
      });
      const owner = updated.rows[row].cells.find((cell) => cell.column === column)!;
      expect(JSON.parse(states.get(`cell:${owner.from}`)!)).toEqual(
        native.state.doc.nodeAt(post.$anchorCell.pos)!.toJSON(),
      );
      session.save();
      await session.seek(0);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection.table).toEqual(before.table);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      expect(service.depth).toBe(1);
      expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
