import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
const open = '<table><tbody><tr><td>';
const extra = 'PREVIOUS</td><td>';
const tail = '</td><td>TARGET</td></tr></tbody></table>';
async function fresh(source: string) {
  const html = await processMarkdownToHTML(source, { preserveAnchors: true, workspaceId: 'ws-a' });
  const editor = new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: html,
      editable: true,
      useMarkdown: true,
      enableComments: false,
      workspace: { id: 'ws-a' },
      enableMentions: true,
      enableNotePrimitives: true,
      onUpdate: () => {},
    }),
  );
  return { editor, html };
}
it('fresh canonical HTML requires absolute unit-cell addresses even though merged attributes are removed', async () => {
  const sources = [
    open + 'x'.repeat(200) + tail,
    open + extra + 'x'.repeat(200 - extra.length) + tail,
  ];
  expect(sources[0].indexOf('TARGET')).toBe(sources[1].indexOf('TARGET'));
  expect(sources[0].length).toBe(sources[1].length);
  const columns = [];
  for (const source of sources) {
    const { editor } = await fresh(source);
    try {
      const row = editor.state.doc.firstChild!.firstChild!;
      const cells: Array<{ column: number; text: string }> = [];
      row.forEach((cell, _offset, column) => cells.push({ column, text: cell.textContent }));
      columns.push(cells.find((c) => c.text === 'TARGET')!.column);
    } finally {
      editor.destroy();
    }
  }
  expect(columns).toEqual([1, 2]);
});
it('fresh canonical HTML strips merged attributes; live merging remains a separate session state', async () => {
  const source =
    '<table><tbody><tr><td colspan="2" rowspan="2">A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>';
  const { editor, html } = await fresh(source);
  try {
    expect(html).not.toContain('colspan');
    expect(html).not.toContain('rowspan');
    const cells: number[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableCell') {
        cells.push(pos);
        expect(n.attrs.colspan).toBe(1);
        expect(n.attrs.rowspan).toBe(1);
      }
    });
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    expect(editor.commands.mergeCells()).toBe(true);
    expect(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.colspan).toBe(2);
    const saved = processHTMLToMarkdown(editor.getHTML());
    expect(saved).not.toContain('colspan');
    const reloaded = await fresh(saved);
    try {
      reloaded.editor.state.doc.descendants((n) => {
        if (n.type.name === 'tableCell' || n.type.name === 'tableHeader')
          expect(n.attrs.colspan).toBe(1);
      });
    } finally {
      reloaded.editor.destroy();
    }
  } finally {
    editor.destroy();
  }
});

const canonicalSpecimens = {
  markdownInsideHtmlBlock: '## Before\n\n<div>**bold** `code` &amp; \\* </div>',
  markdownMultilineHtmlBlock: '## Before\n\n<div>one\ntwo</div>',
  markdownCrLfHtmlBlock: '## Before\r\n\r\n<div>one\r\ntwo</div>',
  htmlTableBeforeBacktickTail: '<table><tr><td>x</td></tr></table>\n\n`After`',
  markdownBeforeHtmlBacktickTail: '## Before\n\n<table><tr><td>x</td></tr></table>\n\n`After`',
  markdownBeforeAndAfterHtmlTable: '## Before\n\n<table><tr><td>x</td></tr></table>\n\n**After**',
  htmlTableBeforeMarkdown: '<table><tr><td>x</td></tr></table>\n\n**After**',
  commentAnchorBeforeHtmlTable:
    '<!--anchor:comment-a:point-->\n\n<table><tr><td>x</td></tr></table>\n\n**After**',
  cellRoles: '<table><tr><th>HEADER</th><td>DATA</td></tr></table>',
  implicitBodiesAndEnds: '<table><tr><td>ONE<td>TWO<tr><td>THREE</table>',
  entitiesAndWhitespace:
    '<table><tr><td> A &amp; B&#x1f680;\r\n  C\t D&nbsp;E<br>F </td></tr></table>',
  nestedTable:
    '<table><tr><td>OUTER<table><tr><th>INNER</th></tr></table>AFTER</td><td>LAST</td></tr></table>',
  malformedSpans:
    '<table><tr><td rowspan="0" colspan="-2">ZERO</td><td rowspan="wat" colspan="999999999999999999999">BAD</td></tr></table>',
  unsafeAttributes:
    '<table onclick="alert(1)" style="color:red"><tr><td data-unknown="raw" title="cell" onmouseover="alert(2)"><a href="javascript:alert(3)" title="link">LINK</a><script>evil()</script><style>body{display:none}</style>TEXT</td></tr></table>',
  retainedAttributes:
    '<table><tr><td><a href="https://example.test/long" title="' +
    't'.repeat(256) +
    '">LINK</a><img src="https://example.test/image.png" alt="ALT" title="IMAGE"></td></tr></table>',
};
it.each(Object.entries(canonicalSpecimens))(
  'records the production HTML normalization for %s',
  async (name, source) => {
    const { editor, html } = await fresh(source);
    try {
      const backtickControl =
        name === 'htmlTableBeforeBacktickTail' || name === 'markdownBeforeHtmlBacktickTail';
      const textPositions: Array<{ text: string; position: number; marks: string[] }> = [];
      if (backtickControl)
        editor.state.doc.descendants((node, position) => {
          if (node.isText)
            textPositions.push({
              text: node.text ?? '',
              position,
              marks: node.marks.map((mark) => mark.type.name),
            });
        });
      expect({
        ...(backtickControl
          ? {
              rawBacktickRange: {
                start: source.indexOf('`After`'),
                end: source.indexOf('`After`') + '`After`'.length,
              },
              textPositions,
            }
          : {}),
        source,
        html,
        native: editor.getJSON(),
        rendered: editor.getHTML(),
        saved: processHTMLToMarkdown(editor.getHTML()),
      }).toMatchSnapshot(name);
    } finally {
      editor.destroy();
    }
  },
);
