import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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
for (const mode of ['forward', 'backward', 'sink-failure', 'stale', 'journal-failure'] as const) {
  it(`cuts the entire logical rectangle only after publication: ${mode}`, async () => {
    const source =
      '| H | R | Keep |\n| :--- | ---: | --- |\n' +
      Array.from(
        { length: 12 },
        (_, r) => `| **a${r}** | [b${r}](https://example.test) | KEEP${r} |`,
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
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    const restores: Array<() => void> = [];
    try {
      const ar = mode === 'backward' ? 12 : 1,
        ac = mode === 'backward' ? 1 : 0,
        hr = mode === 'backward' ? 1 : 12,
        hc = mode === 'backward' ? 0 : 1;
      const map = TableMap.get(native.state.doc.firstChild!);
      native.view.dispatch(
        native.state.tr.setSelection(
          CellSelection.create(
            native.state.doc,
            1 + map.map[ar * 3 + ac],
            1 + map.map[hr * 3 + hc],
          ),
        ),
      );
      session.selection = {
        anchor: raw.rows[ar].cells[ac].body,
        head: raw.rows[hr].cells[hc].body,
        affinity: 1,
        revision: service.revision,
        table: {
          kind: 'cell',
          anchor: { cell: raw.rows[ar].cells[ac].from, block: 0, offset: 0 },
          head: { cell: raw.rows[hr].cells[hc].from, block: 0, offset: 0 },
        },
      };
      await session.seek(raw.rows[6].cells[0].body);
      const old = session.editor!,
        beforeDoc = old.getJSON(),
        beforeSelection = structuredClone(session.selection),
        beforeRevision = service.revision;
      const prior = { 'text/plain': 'old clipboard', 'text/html': '<p>old clipboard</p>' };
      service.clipboardSink.published = prior;
      if (mode === 'sink-failure') {
        const spy = vi.spyOn(service.clipboardSink, 'publish').mockImplementationOnce(() => {
          throw new Error('injected publication failure');
        });
        restores.push(() => spy.mockRestore());
      }
      if (mode === 'journal-failure') {
        const spy = vi.spyOn(service, 'record').mockImplementationOnce(() => {
          throw new Error('injected cut journal failure');
        });
        restores.push(() => spy.mockRestore());
      }
      if (mode === 'stale') {
        const read = service.clipboardBacking.page.bind(service.clipboardBacking);
        const spy = vi
          .spyOn(service.clipboardBacking, 'page')
          .mockImplementationOnce((id, index) => {
            const page = read(id, index);
            service.apply({ from: service.length, to: service.length, insert: '\n\nREMOTE' });
            return page;
          });
        restores.push(() => spy.mockRestore());
      }
      const dispatch = (editor: Editor) => {
        const values: Record<string, string> = {};
        const event = new Event('cut', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: {
            clearData: () => {},
            setData: (mime: string, value: string) => {
              values[mime] = value;
            },
          },
        });
        editor.view.dom.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        return values;
      };
      const nativeClipboard = dispatch(native);
      const emitted = dispatch(session.editor!);
      expect(emitted).toEqual({}); // Entire output belongs to the external mock sink.
      restores.splice(0).forEach((restore) => restore());
      if (mode.includes('failure') || mode === 'stale') {
        expect(session.error).toMatch(/publication failure|cut journal failure|stale/i);
        expect(service.region(0)).toBe(source + (mode === 'stale' ? '\n\nREMOTE' : ''));
        expect(service.revision).toBe(beforeRevision + (mode === 'stale' ? 1 : 0));
        expect(service.depth).toBe(0);
        expect(session.selection).toEqual(beforeSelection);
        expect(session.editor!.getJSON()).toEqual(beforeDoc);
        expect(service.clipboardSink.published).toEqual(
          mode === 'journal-failure' ? nativeClipboard : prior,
        );
      } else {
        expect(session.error).toBe('');
        await expect.poll(() => old.isDestroyed).toBe(true);
        expect(service.clipboardSink.published).toEqual(nativeClipboard);
        const saved = service.region(0);
        expect(await processMarkdownToHTML(saved)).toBe(
          await processMarkdownToHTML(processHTMLToMarkdown(native.getHTML())),
        );
        expect(saved).toBe(
          source.replace(/\*\*a\d+\*\*/g, '').replace(/\[b\d+\]\(https:\/\/example.test\)/g, ''),
        );
        expect(session.selection.table?.kind).toBe('text');
        const current = scanTables(saved)[0].rows[hr].cells[hc];
        expect(session.selection.table?.head).toEqual({ cell: current.from, block: 0, offset: 0 });
        expect(session.editor!.state.selection.$head.node(3).toJSON()).toEqual(
          native.state.selection.$head.node(3).toJSON(),
        );
        session.save();
        await session.seek(0);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.table).toEqual(beforeSelection.table);
        await session.history(true);
        expect(service.region(0)).toBe(saved);
        expect(session.selection.table?.head.cell).toBe(current.from);
        expect(service.depth).toBe(1);
      }
      expect(service.clipboardBacking.retainedBytes).toBe(0);
      expect(service.clipboardSink.stagingBytes).toBe(0);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    } finally {
      restores.forEach((restore) => restore());
      native.destroy();
      session.destroy();
    }
  });
}
