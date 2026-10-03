import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { scanTables } from './table-source';
beforeAll(() => store.init());
afterAll(() => store.dispose());
async function native(source: string) {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: await processMarkdownToHTML(source),
    editable: true,
    useMarkdown: true,
    enableComments: false,
    enableMentions: false,
    onUpdate: () => {},
  });
  return new Editor({ ...config, extensions: [...config.extensions!, CommentAnchor] });
}
it('normalizes and replaces a clipped spanned header against native live and fresh oracles', async () => {
  const input =
    'before café\n\n| ' +
    '**wide 🌍** '.repeat(800).trim() +
    ' | second block | <!--anchor:keep:point-->KEEP |\n| --- | --- | --- |\n' +
    Array.from({ length: 800 }, (_, i) => `| row${i} | middle${i} | right${i} |\n`).join('') +
    '\nafter';
  const oracle = await native(input);
  let session: DocumentSession | undefined,
    freshSession: DocumentSession | undefined,
    freshOracle: Editor | undefined;
  try {
    const tablePos = oracle.state.doc.firstChild!.nodeSize,
      map = TableMap.get(oracle.state.doc.nodeAt(tablePos)!);
    oracle.commands.setCellSelection({
      anchorCell: tablePos + 1 + map.map[0],
      headCell: tablePos + 1 + map.map[1],
    });
    expect(oracle.commands.mergeCells()).toBe(true);
    const source = processHTMLToMarkdown(oracle.getHTML()),
      index = scanTables(source)[0];
    const backing = new SourceJournal(() => source, 1);
    // Unbounded mock initial live metadata; never transferred as a renderer map.
    const states = Reflect.get(backing, 'tableStates') as Map<string, string>;
    const fullTable = oracle.state.doc.nodeAt(tablePos)!;
    fullTable.firstChild!.forEach((cell, _q, c) =>
      states.set(`cell:${index.rows[0].cells[c].from}`, JSON.stringify(cell.toJSON())),
    );
    // Header colspan determines logical width before scanning later physical rows.
    const indexed = scanTables(source, (from) => {
      const value = states.get(`cell:${from}`);
      return value ? JSON.parse(value) : undefined;
    })[0];
    fullTable.forEach((row, _p, r) =>
      row.forEach((cell, _q, c) =>
        states.set(`cell:${indexed.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON())),
      ),
    );
    session = new DocumentSession(backing, document.createElement('div'));
    await session.seek(source.length - 1);
    const editor = session.editor!,
      original = session.projection!,
      part = original.mixed!.parts.find((p) => p.projection.table)!;
    const afterStart = oracle.state.doc.content.size - oracle.state.doc.lastChild!.nodeSize + 1;
    oracle.view.dispatch(
      oracle.state.tr.setSelection(
        TextSelection.between(
          oracle.state.doc.resolve(afterStart),
          oracle.state.doc.resolve(tablePos + 1),
        ),
      ),
    );
    editor.view.props.createSelectionBetween!(
      editor.view,
      editor.state.doc.resolve(
        editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1,
      ),
      editor.state.doc.resolve(part.pm + 1),
    );
    await expect.poll(() => Reflect.get(session!, 'domBoundaryPending')).toBe(false);
    expect(session.error).toBe('');
    expect(session.editor).toBe(editor);
    expect({
      anchor: session.selection.table!.anchor.offset,
      head: session.selection.table!.head.offset,
      block: session.selection.table!.head.block,
    }).toEqual({
      anchor: oracle.state.selection.$anchor.parentOffset,
      head: oracle.state.selection.$head.parentOffset,
      block: 0,
    });
    const active =
      session.projection!.table ??
      session.projection!.mixed!.parts.find((p) => p.projection.table)!.projection.table!;
    const entry = active.entries.find((e) => e.cell.from === session!.selection.table!.head.cell)!;
    expect(entry.cell.owner?.colspan).toBe(2);
    const block = active.paragraphs.find((p) => p.cell.from === entry.cell.from && p.block === 0)!;
    expect(editor.state.selection.$head.parent.toJSON()).toEqual(
      oracle.state.selection.$head.parent
        .cut(block.offset, block.offset + editor.state.selection.$head.parent.content.size)
        .toJSON(),
    );
    expect(backing.region(0)).toBe(source);
    oracle.commands.insertContent('EDIT');
    editor.commands.insertContent('EDIT');
    expect(session.error).toBe('');
    await expect.poll(() => session!.editor !== editor).toBe(true);
    const firstCell = (doc: JSONContent) =>
      doc.content!.find((n) => n.type === 'table')!.content![0].content![0];
    expect(firstCell(session.editor!.getJSON())).toEqual(firstCell(oracle.getJSON()));
    const edited = backing.region(0),
      afterCell = source.indexOf('<!--anchor:keep:point-->');
    expect(edited.slice(edited.indexOf('<!--anchor:keep:point-->'))).toBe(source.slice(afterCell));
    expect(edited.startsWith(source.slice(0, index.rows[0].cells[0].from))).toBe(true);
    session.save();
    const prior = session.editor!;
    await session.seek(backing.length - 1);
    expect(prior.isDestroyed).toBe(true);
    await session.history();
    expect(backing.region(0)).toBe(source);
    await session.history(true);
    expect(backing.region(0)).toBe(edited);
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(backing.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    session.destroy();
    freshOracle = await native(edited);
    freshSession = new DocumentSession(
      new SourceJournal(() => edited, 1),
      document.createElement('div'),
    );
    await freshSession.seek(edited.indexOf('EDIT'));
    expect(firstCell(freshSession.editor!.getJSON())).toEqual(firstCell(freshOracle.getJSON()));
    // Live spans/paragraphs use existing session metadata. Fresh canonical source
    // is independently parsed and is not asserted to preserve that live topology.
    expect(firstCell(freshOracle.getJSON())).not.toEqual(firstCell(oracle.getJSON()));
  } finally {
    freshSession?.destroy();
    session?.destroy();
    freshOracle?.destroy();
    oracle.destroy();
  }
});
