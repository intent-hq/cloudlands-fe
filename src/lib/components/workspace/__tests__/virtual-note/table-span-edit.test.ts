import { beforeAll, afterAll, it, expect } from 'vitest';
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
for (const operation of ['typing', 'header'] as const)
  it(`preserves full logical span during ${operation} in an interior native continuation`, async () => {
    const original =
      '| H | R |\n| :--- | ---: |\n' +
      Array.from({ length: 120 }, (_, r) => `| left${r} | right${r} |`).join('\n');
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
        native.state.tr.setSelection(
          CellSelection.create(native.state.doc, cells[0], cells.at(-1)!),
        ),
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
      await session.seek(source.indexOf('right94'));
      const entry = session.projection!.table!.entries.find(
        (e) => e.cell.from === raw.rows[1].cells[0].from,
      )!;
      expect(entry.cell.owner?.rowspan).toBe(120);
      expect(entry.cell.mounted!.rowspan).toBe(5);
      native.commands.setTextSelection(cells[0] + 4);
      session.editor!.commands.setTextSelection(entry.paragraph + 3);
      for (const editor of [native, session.editor!]) {
        if (operation === 'typing') expect(editor.commands.insertContent('Z')).toBe(true);
        else expect(editor.commands.toggleHeaderCell()).toBe(true);
      }
      expect(session.error).toBe('');
      const expected = native.state.doc.firstChild!.child(1).child(0).toJSON();
      const inspect = () => {
        const cell = session!.projection!.table!.entries.find(
          (e) => e.cell.from === raw.rows[1].cells[0].from,
        )!.cell;
        return { type: cell.nodeType, attrs: cell.attrs };
      };
      expect(inspect()).toEqual({ type: expected.type, attrs: expected.attrs });
      const saved = service.region(0);
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
      expect(inspect()).toEqual({ type: expected.type, attrs: expected.attrs });
      await session.history();
      expect(service.region(0)).toBe(source);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      const current = session.projection!.table!.entries.find(
        (e) => e.cell.from === raw.rows[1].cells[0].from,
      )!.cell;
      expect(current.attrs!.rowspan).toBe(120);
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
