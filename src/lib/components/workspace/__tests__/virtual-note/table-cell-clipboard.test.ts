import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';
import { bytes } from './bounded-note-service';

beforeAll(() => store.init());
afterAll(() => store.dispose());
function copy(editor: Editor) {
  const values: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => {
        for (const key of Object.keys(values)) delete values[key];
      },
      setData: (type: string, value: string) => {
        values[type] = value;
      },
    },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(values['text/html']).toContain('<table');
  return values;
}
for (const [rows, length] of [
  [8, 6],
  [160, 256],
]) {
  it(`copies the full logical native cell rectangle across ${rows} rows`, async () => {
    const source =
      '| H | R | untouched |\n| --- | --- | --- |\n' +
      Array.from(
        { length: rows },
        (_, r) => `| **a${r}${'x'.repeat(length)}** | b${r}${'y'.repeat(length)} | KEEP${r} |`,
      ).join('\n');
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
      const full = copy(native);
      expect((full['text/html'].match(/<td/g) ?? []).length).toBe(rows * 2);
      expect(full['text/plain']).not.toContain('KEEP');
      // Initial logical selection is fixture setup. Native dispatch and serialization below
      // are real; full source/native tree and full clipboard oracle are not renderer bounds.
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
      await session.seek(raw.rows[Math.floor(rows / 2)].cells[0].body);
      expect(session.editor!.state.selection).toBeInstanceOf(CellSelection);
      const projected = copy(session.editor!);
      console.info('Native rectangle clipboard evidence', {
        rows,
        length,
        sourceBytes: bytes(source),
        nativeTextBytes: bytes(full['text/plain']),
        nativeHTMLBytes: bytes(full['text/html']),
        mountedTextBytes: bytes(projected['text/plain']),
        mountedHTMLBytes: bytes(projected['text/html']),
        stats: session.snapshot(),
      });
      expect(projected['text/plain']).toBe(full['text/plain']);
      expect(projected['text/html']).toBe(full['text/html']);
      expect(service.region(0)).toBe(source);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
