import { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from './editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const create = (content: string) =>
  new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content,
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
const flattened = (cell: PMNode) => {
  let inline = Fragment.empty;
  cell.forEach((paragraph) => {
    inline = inline.append(paragraph.content);
  });
  return cell.type
    .create(cell.attrs, cell.type.schema.nodes.paragraph.create(null, inline))
    .toJSON();
};
const cases = [
  ['plain', '<p>one</p><p>two</p>'],
  ['empty', '<p></p><p></p><p></p>'],
  ['adjacent marks', '<p><strong>one</strong></p><p><strong>two</strong><em>three</em></p>'],
  [
    'nested marks',
    '<p><strong><em>one</em> </strong></p><p><strong><a href="https://example.com">two</a><code>three</code></strong></p>',
  ],
  ['code seam', '<p><code>a\\</code></p><p><code>|b`c</code></p>'],
  ['escapes', '<p>*star* | slash \\ </p><p>[bracket] `tick` &lt;b&gt; &amp;copy;</p>'],
  ['empty between marks', '<p><strong>one</strong></p><p></p><p><em>two</em><br>three</p><p></p>'],
] as const;
for (const preserveAnchors of [true, false]) {
  for (const [name, paragraphs] of cases) {
    it(`flattens native table paragraphs without losing ${name} (${preserveAnchors})`, async () => {
      const editor = create(
        `<table><tr><th align="right">${paragraphs}</th><th>Other</th></tr><tr><td align="right">${paragraphs}</td><td>untouched</td></tr></table>`,
      );
      try {
        const before = editor.state.doc.firstChild!;
        const expected = before.toJSON();
        expected.content![0].content![0] = flattened(before.child(0).child(0));
        expected.content![1].content![0] = flattened(before.child(1).child(0));
        const saved = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors }).trim();
        expect(saved.split('\n')).toHaveLength(3);
        expect(saved.split('\n')[1]).toBe('| ---: | --- |');
        if (name === 'plain') expect(saved).toContain('| onetwo | untouched |');
        editor.commands.setContent(await processMarkdownToHTML(saved));
        expect(editor.state.doc.firstChild!.toJSON()).toEqual(expected);
      } finally {
        editor.destroy();
      }
    });
  }
  for (const command of ['Enter', 'merge'] as const) {
    it(`saves actual native ${command} paragraphs with exact inline content (${preserveAnchors})`, async () => {
      const editor = create(
        '<table><tr><th>H</th><th>R</th></tr><tr><td><p><strong>bold</strong> | \\ TARGET <em>italic</em> <code>a\\|b</code></p></td><td><p><a href="https://example.com">link</a></p></td></tr></table>',
      );
      try {
        const cells: number[] = [];
        let target = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'tableCell') cells.push(pos);
          if (node.isText && node.text!.includes('TARGET'))
            target = pos + node.text!.indexOf('TARGET');
        });
        if (command === 'Enter') {
          editor.commands.setTextSelection(target);
          expect(editor.commands.splitBlock()).toBe(true);
        } else {
          editor.view.dispatch(
            editor.state.tr.setSelection(
              CellSelection.create(editor.state.doc, cells[0], cells[1]),
            ),
          );
          expect(editor.commands.mergeCells()).toBe(true);
        }
        const live = editor.state.doc.firstChild!.child(1).child(0);
        expect(live.childCount).toBe(2);
        const expectedInline = flattened(live).content;
        const saved = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors });
        editor.destroy();
        const fresh = create(await processMarkdownToHTML(saved));
        try {
          expect(fresh.state.doc.firstChild!.child(1).child(0).toJSON().content).toEqual(
            expectedInline,
          );
          // Existing pipe Markdown does not persist merged spans.
          expect(fresh.state.doc.firstChild!.child(1).child(0).attrs.colspan).toBe(1);
        } finally {
          fresh.destroy();
        }
      } finally {
        if (!editor.isDestroyed) editor.destroy();
      }
    });
  }
  it(`keeps validated math and rejects forged or hostile paragraph content (${preserveAnchors})`, async () => {
    const host = document.createElement('div');
    host.innerHTML = await processMarkdownToHTML('| H |\n| --- |\n| $x_1 + y$ |', {
      renderMath: true,
    });
    const cell = host.querySelector('td')!;
    const rendered = cell.innerHTML;
    cell.innerHTML = `<p>${rendered}</p><p></p>`;
    expect(processHTMLToMarkdown(host.innerHTML, { preserveAnchors }).trim()).toBe(
      '| H |\n| --- |\n| $x_1 + y$ |',
    );
    cell.querySelector('[data-math-source]')!.setAttribute('data-math-source', '$forged$');
    expect(processHTMLToMarkdown(host.innerHTML, { preserveAnchors })).not.toContain('$forged$');
    cell.innerHTML =
      '<p onclick="alert(1)" style="background:url(javascript:alert(1))"><strong>safe</strong></p><p><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)">&lt;script&gt;literal&lt;/script&gt;</p>';
    const saved = processHTMLToMarkdown(host.innerHTML, { preserveAnchors });
    host.innerHTML = await processMarkdownToHTML(saved);
    expect(host.querySelector('script,[onclick],[onerror],[style]')).toBeNull();
    for (const a of host.querySelectorAll('a')) expect(a.getAttribute('href')).toBeNull();
    expect(host.textContent).toContain('safe');
    expect(host.textContent).toContain('<script>literal</script>');
  });
}
