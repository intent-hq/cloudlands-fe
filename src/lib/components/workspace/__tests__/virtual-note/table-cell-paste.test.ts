import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';
import { bytes } from './bounded-note-service';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const [rows, inputRows, length] of [
  [12, 2, 4],
  [40, 40, 256],
]) {
  it(`pastes exact native rich cells across ${rows} logical rows from ${inputRows} input rows`, async () => {
    const source =
      '| H | R | Keep |\n| :--- | ---: | --- |\n' +
      Array.from({ length: rows }, (_, r) => `| old${r} | value${r} | KEEP${r} |`).join('\n');
    const html =
      '<table><tbody>' +
      Array.from(
        { length: inputRows },
        (_, r) =>
          `<tr><td><p><strong>A${r}${'x'.repeat(length)}</strong></p><p></p><p><em>end</em></p></td>` +
          `<td><p><a href="https://example.test">B${r}</a><code>a|b\\c</code></p></td></tr>`,
      ).join('') +
      '</tbody></table>';
    const raw = scanTables(source)[0];
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
      const map = TableMap.get(native.state.doc.firstChild!);
      native.view.dispatch(
        native.state.tr.setSelection(
          CellSelection.create(native.state.doc, 1 + map.map[3], 1 + map.map[rows * 3 + 1]),
        ),
      );
      session.selection = {
        revision: service.revision,
        affinity: 1,
        anchor: raw.rows[1].cells[0].body,
        head: raw.rows[rows].cells[1].body,
        table: {
          kind: 'cell',
          anchor: { cell: raw.rows[1].cells[0].from, block: 0, offset: 0 },
          head: { cell: raw.rows[rows].cells[1].from, block: 0, offset: 0 },
        },
      };
      const before = structuredClone(session.selection);
      await session.seek(raw.rows[Math.floor(rows / 2)].cells[0].body);
      const paste = (editor: Editor) => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: {
            getData: (mime: string) => (mime === 'text/html' ? html : ''),
            files: [],
          },
        });
        editor.view.dom.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      };
      // Full input/native document and output comparisons are external test-oracle costs.
      paste(native);
      const old = session.editor!;
      paste(old);
      console.info('Native table paste baseline', {
        rows,
        inputRows,
        inputBytes: bytes(html),
        error: session.error,
        rejection: session.lastRejection,
        stats: session.snapshot(),
      });
      expect(await processMarkdownToHTML(service.region(0))).toBe(
        await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
      );
      expect(session.error).toBe('');
      const saved = service.region(0);
      expect(saved.match(/KEEP\d+/g)).toEqual(source.match(/KEEP\d+/g));
      expect(service.depth).toBe(1);
      session.save();
      await session.seek(0);
      expect(old.isDestroyed).toBe(true);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection.table).toEqual(before.table);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      expect(session.selection.table?.kind).toBe('cell');
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
