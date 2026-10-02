import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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
for (const [rows, inputRows, length, mode] of [
  [12, 2, 4, 'rich'],
  [40, 40, 256, 'rich'],
  [12, 2, 4, 'backward'],
  [12, 2, 4, 'plain'],
  [12, 2, 4, 'inline'],
  [12, 2, 4, 'publish-failure'],
  [12, 2, 4, 'missing-page'],
  [12, 2, 4, 'stale'],
  [12, 2, 4, 'journal-failure'],
] as const) {
  it(`pastes exact native cells across ${rows} logical rows from ${inputRows} input rows: ${mode}`, async () => {
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
    const input = {
      'text/plain': mode === 'plain' ? 'literal **not bold** | pipe\\slash 漢🌍\n\nlast' : '',
      'text/html':
        mode === 'plain'
          ? ''
          : mode === 'inline'
            ? '<p><strong>bold</strong><em>italic</em></p><p></p><p><code>a|b\\c</code></p>'
            : html,
    };
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
    const restores: Array<() => void> = [];
    try {
      const map = TableMap.get(native.state.doc.firstChild!);
      native.view.dispatch(
        native.state.tr.setSelection(
          CellSelection.create(
            native.state.doc,
            1 + map.map[mode === 'backward' ? rows * 3 + 1 : 3],
            1 + map.map[mode === 'backward' ? 3 : rows * 3 + 1],
          ),
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
      if (mode === 'backward') {
        [session.selection.anchor, session.selection.head] = [
          session.selection.head,
          session.selection.anchor,
        ];
        [session.selection.table!.anchor, session.selection.table!.head] = [
          session.selection.table!.head,
          session.selection.table!.anchor,
        ];
      }
      const before = structuredClone(session.selection);
      await session.seek(raw.rows[Math.floor(rows / 2)].cells[0].body);
      const paste = (editor: Editor, external = false) => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: {
            getData: (mime: string) => {
              if (external) throw new Error('Renderer must not read whole clipboard input');
              return input[mime as keyof typeof input] ?? '';
            },
            files: [],
          },
        });
        editor.view.dom.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      };
      // Full input/native document and output comparisons are external test-oracle costs.
      paste(native);
      const old = session.editor!;
      const oldDoc = old.getJSON(),
        oldSelection = old.state.selection.toJSON(),
        revision = service.revision;
      session.clipboardInput = service.openClipboardInput(input);
      if (mode === 'publish-failure') {
        const spy = vi.spyOn(service.clipboardInputSink, 'publish').mockImplementationOnce(() => {
          throw new Error('injected input publication failure');
        });
        restores.push(() => spy.mockRestore());
      }
      if (mode === 'journal-failure') {
        const spy = vi.spyOn(service, 'record').mockImplementationOnce(() => {
          throw new Error('injected paste journal failure');
        });
        restores.push(() => spy.mockRestore());
      }
      if (mode === 'missing-page' || mode === 'stale') {
        const read = service.clipboardInput.page.bind(service.clipboardInput);
        const spy = vi.spyOn(service.clipboardInput, 'page').mockImplementation((id, index) => {
          if (index === 1 && mode === 'missing-page') throw new Error('Missing clipboard page');
          const page = read(id, index);
          if (index === 1 && mode === 'stale')
            service.apply({ from: service.length, to: service.length, insert: '\n\nREMOTE' });
          return page;
        });
        restores.push(() => spy.mockRestore());
      }
      paste(old, true);
      restores.splice(0).forEach((restore) => restore());
      if (['publish-failure', 'journal-failure', 'stale', 'missing-page'].includes(mode)) {
        expect(session.error).toMatch(/failure|stale|Missing clipboard/);
        expect(service.region(0)).toBe(source + (mode === 'stale' ? '\n\nREMOTE' : ''));
        expect(service.revision).toBe(revision + (mode === 'stale' ? 1 : 0));
        expect(service.depth).toBe(0);
        expect(session.selection).toEqual(before);
        expect(session.editor).toBe(old);
        expect(old.getJSON()).toEqual(oldDoc);
        expect(old.state.selection.toJSON()).toEqual(oldSelection);
        expect(service.clipboardInput.retainedBytes).toBe(0);
        expect(service.clipboardInputSink.stagingBytes).toBe(0);
        expect(service.clipboardInputSink.published).toEqual({ 'text/plain': '', 'text/html': '' });
        return;
      }
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
      await expect.poll(() => old.isDestroyed).toBe(true);
      const saved = service.region(0);
      expect(saved.match(/KEEP\d+/g)).toEqual(source.match(/KEEP\d+/g));
      const untouched = (text: string) => {
        const table = scanTables(text)[0];
        let result = text;
        for (const cell of table.rows
          .slice(1)
          .flatMap((row) => row.cells.slice(0, 2))
          .reverse())
          result = result.slice(0, cell.body) + '<edited-cell>' + result.slice(cell.end);
        return result;
      };
      expect(untouched(saved)).toBe(untouched(source));
      expect(service.depth).toBe(1);
      session.save();
      const updated = scanTables(saved)[0];
      for (const [r, c] of [
        [1, 0],
        [1, 1],
        [rows, 0],
        [rows, 1],
      ]) {
        await session.seek(updated.rows[r].cells[c].body);
        const entry = session.projection!.table!.entries.find(
          (e) => e.cell.row === r && e.cell.column === c,
        )!;
        expect(session.editor!.state.doc.nodeAt(entry.pm)!.toJSON()).toEqual(
          native.state.doc.firstChild!.child(r).child(c).toJSON(),
        );
      }
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
      expect(service.clipboardInput.retainedBytes).toBe(0);
      expect(service.clipboardInputSink.stagingBytes).toBe(0);
      expect(service.clipboardInputSink.published).toEqual({ 'text/plain': '', 'text/html': '' });
      expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
      expect(session.clipboardRelay.maxOutstandingPages).toBe(1);
    } finally {
      restores.forEach((restore) => restore());
      native.destroy();
      session.destroy();
    }
  });
}
