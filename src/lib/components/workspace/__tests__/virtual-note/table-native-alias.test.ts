import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { findCommentAnchors, getAllAnchoredCommentIds } from '$lib/components/tiptap/CommentAnchor';
import { clipboardCellSource } from './table-clipboard';
import { scanTables } from './table-source';
import { planTableTextPaste } from './table-text-paste-plan';
import { tablePointPosition } from './table-nested';
beforeAll(() => store.init());
afterAll(() => store.dispose());
function editor(content: string | JSONContent) {
  return new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content,
      editable: true,
      useMarkdown: true,
      enableComments: true,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
}
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function fixture(marked: boolean, rows: number): JSONContent {
  const content: JSONContent[] = [p('outer-prefix')];
  content.push({
    type: 'table',
    content: Array.from({ length: rows }, (_, i) => ({
      type: 'tableRow',
      content: [
        {
          type: 'tableCell',
          content: [
            {
              type: 'paragraph',
              content: [
                ...(marked
                  ? [
                      {
                        type: 'commentAnchor',
                        attrs: { id: `note-${i}:start`, type: 'start', commentId: `note-${i}` },
                      },
                    ]
                  : []),
                { type: 'text', text: `target-${i}` },
                ...(marked
                  ? [
                      {
                        type: 'commentAnchor',
                        attrs: { id: `note-${i}:end`, type: 'end', commentId: `note-${i}` },
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      ],
    })),
  });
  content.push(p('outer-suffix'));
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Heading')] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content }] },
        ],
      },
    ],
  };
}
for (const marked of [false, true])
  for (const rows of [1, 3]) {
    it(`preserves every native canonical occurrence after nested edit marked=${marked} rows=${rows}`, () => {
      const native = editor(fixture(marked, rows));
      try {
        const table = native.state.doc.firstChild!,
          cell = table.lastChild!.firstChild!;
        const source = `| Heading |\n| --- |\n| ${clipboardCellSource(cell)} |\n`;
        const index = scanTables(source)[0],
          entry = index.rows[1].cells[0];
        const point = { cell: entry.from, block: 1, offset: marked ? 4 : 3, path: [1, 0, 0, 0] };
        let pos = 0;
        native.state.doc.descendants((node, at) => {
          if (node === cell) pos = at + 1 + tablePointPosition(cell, point);
        });
        native.view.dispatch(native.state.tr.insertText('EDIT', pos));
        const plan = planTableTextPaste(
          source,
          0,
          index,
          point,
          point,
          { 'text/plain': '', 'text/html': '' },
          native,
          (from) => (from === entry.from ? cell.toJSON() : undefined),
          undefined,
          {
            name: 'replaceSelection',
            kind: 'text',
            slice: { content: [{ type: 'text', text: 'EDIT' }] },
          },
        );
        expect(plan.text.trim()).toBe(processHTMLToMarkdown(native.getHTML()).trim());
      } finally {
        native.destroy();
      }
    });
  }
it('records actual duplicate-marker lookup on an independent native canonical reload', async () => {
  const live = editor(fixture(true, 3));
  let fresh: Editor | undefined;
  try {
    const source = processHTMLToMarkdown(live.getHTML());
    fresh = editor(await processMarkdownToHTML(source));
    const occurrences: { start: number[]; end: number[] } = { start: [], end: [] };
    fresh.state.doc.descendants((node, at) => {
      if (node.type.name === 'commentAnchor' && node.attrs.commentId === 'note-0')
        occurrences[node.attrs.type as 'start' | 'end'].push(at);
    });
    console.log(
      'native-alias-canonical',
      JSON.stringify({ source, live: live.getJSON(), fresh: fresh.getJSON(), occurrences }),
    );
    expect(source.split('<!--anchor:note-0:start-->').length - 1).toBeGreaterThan(1);
    expect(occurrences.start).toHaveLength(1);
    expect(findCommentAnchors(fresh.state.doc, 'note-0')).toEqual({
      start: occurrences.start.at(-1),
      end: occurrences.end.at(-1),
    });
    expect([...getAllAnchoredCommentIds(fresh.state.doc)]).toEqual([
      ...getAllAnchoredCommentIds(live.state.doc),
    ]);
    console.log(
      'native-alias-markers',
      JSON.stringify({
        occurrences,
        selected: findCommentAnchors(fresh.state.doc, 'note-0'),
        ids: [...getAllAnchoredCommentIds(fresh.state.doc)],
      }),
    );
  } finally {
    live.destroy();
    fresh?.destroy();
  }
});
