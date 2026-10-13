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
it('matches native rich clipboard for headers, reversed rectangles and intersecting combined spans', async () => {
  const source =
    '| A | B | C | D |\n| :--- | :---: | ---: | --- |\n' +
    Array.from(
      { length: 8 },
      (_, r) =>
        '| ' +
        Array.from(
          { length: 4 },
          (_, c) => `r${r}c${c} **bold** _italic_ [link](https://example.test) \`a\\|b\``,
        ).join(' | ') +
        ' |',
    ).join('\n');
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
  let session: DocumentSession | undefined;
  try {
    let map = TableMap.get(native.state.doc.firstChild!);
    native.view.dispatch(
      native.state.tr.setSelection(
        CellSelection.create(native.state.doc, 1 + map.map[1 * 4 + 1], 1 + map.map[6 * 4 + 2]),
      ),
    );
    expect(native.commands.mergeCells()).toBe(true);
    const saved = processHTMLToMarkdown(native.getHTML()),
      raw = scanTables(saved)[0],
      metadata = new Map<string, string>();
    const identities = new Map<number, number>();
    native.state.doc.firstChild!.forEach((row, rowOffset, r) =>
      row.forEach((cell, cellOffset, c) => {
        const from = raw.rows[r].cells[c].from;
        metadata.set(`cell:${from}`, JSON.stringify(cell.toJSON()));
        identities.set(2 + rowOffset + cellOffset, from);
      }),
    );
    // Full initial session records and native oracle are explicit backing fixtures, not bounded writes.
    const service = new SourceJournal(() => saved, 1);
    Object.assign(service, { tableStates: metadata });
    session = new DocumentSession(service, document.createElement('div'));
    map = TableMap.get(native.state.doc.firstChild!);
    for (const [ar, ac, hr, hc] of [
      [1, 1, 1, 1],
      [3, 0, 4, 3],
      [4, 3, 3, 0],
      [1, 0, 6, 3],
      [0, 0, 8, 3],
      [8, 3, 0, 0],
    ]) {
      const a = 1 + map.map[ar * 4 + ac],
        h = 1 + map.map[hr * 4 + hc];
      native.view.dispatch(
        native.state.tr.setSelection(CellSelection.create(native.state.doc, a, h)),
      );
      const expected = native.view.serializeForClipboard(native.state.selection.content());
      const anchor = identities.get(a)!,
        head = identities.get(h)!;
      expect(anchor).toBeDefined();
      expect(head).toBeDefined();
      session.selection = {
        anchor,
        head,
        affinity: 1,
        revision: service.revision,
        table: {
          kind: 'cell',
          anchor: { cell: anchor, block: 0, offset: 0 },
          head: { cell: head, block: 0, offset: 0 },
        },
      };
      await session.seek(raw.rows[4].cells.at(-1)!.body);
      const event = new Event('copy', { bubbles: true, cancelable: true });
      const emitted: Record<string, string> = {};
      Object.defineProperty(event, 'clipboardData', {
        value: {
          clearData: () => {},
          setData: (mime: string, value: string) => {
            emitted[mime] = value;
          },
        },
      });
      session.editor!.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(emitted).toEqual({});
      expect(session.error).toBe('');
      expect(service.clipboardSink.published).toEqual({
        'text/plain': expected.text,
        'text/html': expected.dom.innerHTML,
      });
      expect(service.region(0)).toBe(saved);
      expect(service.depth).toBe(0);
      expect(session.clipboardRelay.maxPageBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    }
  } finally {
    native.destroy();
    session?.destroy();
  }
});
