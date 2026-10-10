import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());
it('isolates native vertical span ownership and the existing fresh-session canonical loss', async () => {
  const source =
    '| H | R |\n| :--- | ---: |\n' +
    Array.from({ length: 120 }, (_, r) => `| left${r} | right${r} |`).join('\n');
  const config = () =>
    createEditorConfig({
      element: document.createElement('div'),
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    });
  const native = new Editor({ ...config(), content: await processMarkdownToHTML(source) });
  let cropped: Editor | undefined, fresh: Editor | undefined;
  try {
    const cells: number[] = [];
    native.state.doc.descendants((n, p) => {
      if (n.type.name === 'tableCell' && n.textContent.startsWith('left')) cells.push(p);
    });
    native.view.dispatch(
      native.state.tr.setSelection(CellSelection.create(native.state.doc, cells[0], cells.at(-1)!)),
    );
    expect(native.commands.mergeCells()).toBe(true);
    const table = native.state.doc.firstChild!,
      map = TableMap.get(table);
    expect(map.width).toBe(2);
    expect(map.height).toBe(121);
    expect(table.child(1).child(0).attrs.rowspan).toBe(120);
    // A native cell at logical row95/column0 belongs to the origin at row1.
    expect(map.map[95 * 2]).toBe(map.map[2]);
    expect(table.nodeAt(map.map[95 * 2])!.textContent).toContain('left119');
    const rows = Array.from({ length: 5 }, (_, n) => table.child(95 + n).toJSON());
    cropped = new Editor({
      ...config(),
      content: { type: 'doc', content: [{ type: 'table', content: rows }] },
    });
    const cropMap = TableMap.get(cropped.state.doc.firstChild!);
    expect(cropMap.width).toBe(1);
    expect(cropped.state.doc.firstChild!.child(0).child(0).textContent).toBe('right94');
    const saved = processHTMLToMarkdown(native.getHTML());
    fresh = new Editor({ ...config(), content: await processMarkdownToHTML(saved) });
    const reloaded = fresh.state.doc.firstChild!;
    expect(reloaded.child(1).child(0).attrs.rowspan).toBe(1);
    expect(reloaded.child(95).child(0).textContent).toBe('right94');
    expect(reloaded.child(95).child(0).attrs.align).toBe('left');
    console.info(
      'Independent native rowspan diagnostic',
      JSON.stringify({
        full: {
          width: map.width,
          height: map.height,
          originRow: 1,
          originSpan: 120,
          visibleRow: 95,
          originCell: table.child(1).child(0).toJSON(),
          visibleOwnedCell: table.child(95).child(0).toJSON(),
        },
        crop: { width: cropMap.width, height: cropMap.height, doc: cropped.getJSON() },
        fresh: {
          originCell: reloaded.child(1).child(0).toJSON(),
          visibleRow: reloaded.child(95).toJSON(),
        },
        source,
        saved,
        accounting:
          'All full-source/native/cropped/reload allocations are diagnostic oracles, not bounded-renderer claims.',
      }),
    );
  } finally {
    native.destroy();
    cropped?.destroy();
    fresh?.destroy();
  }
});
