import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { clipboardCellSource } from './table-clipboard';
import { scanTables, admitTableWindow } from './table-source';
import { TableProjection } from './table-projection';
import { patchTableInline } from './table-state';
import { planTableTextPaste } from './table-text-paste-plan';
import { bytes } from './bounded-note-service';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
function nested(values: string[]): JSONContent {
  return {
    type: 'table',
    content: values.map((value) => ({
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [paragraph(value)] }],
    })),
  };
}
for (const large of [false, true])
  it(`admits ${large ? 'clipped' : 'complete'} native nested table ancestry and inline writes`, () => {
    const editor = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: '',
        editable: true,
        useMarkdown: true,
        enableComments: true,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    try {
      const text = large
        ? Array.from({ length: 900 }, (_, i) => `word${i} café 🌍 `).join('')
        : 'target café 🌍';
      const cell = editor.schema.nodeFromJSON({
        type: 'tableHeader',
        content: [paragraph('prefix'), nested(['first', text, 'last']), paragraph('suffix')],
      });
      const raw = clipboardCellSource(cell),
        source = `| ${raw} |\n| --- |`;
      const table = scanTables(source)[0],
        target = source.indexOf(large ? 'word450' : 'target') + 4;
      expect(target).toBeGreaterThan(0);
      const window = admitTableWindow(source, table, target, 1, () => cell.toJSON());
      const projection = new TableProjection(window),
        mounted = editor.schema.nodeFromJSON(projection.content);
      expect(projection.sourceAt(projection.pmAt(target))).toBe(target);
      expect(bytes(JSON.stringify(window))).toBeLessThanOrEqual(4096);
      let count = 0;
      mounted.descendants(() => {
        count++;
      });
      expect(count).toBeLessThanOrEqual(4096);
      if (!large)
        expect(mounted.firstChild!.firstChild!.firstChild!.toJSON()).toEqual(cell.toJSON());
      const point = projection.pointAt(projection.pmAt(target))!;
      expect(point).toBeDefined();
      expect(projection.pointPM(point)).toBe(projection.pmAt(target));
      editor.commands.setContent(projection.content);
      const pm = projection.pmAt(target);
      const change = editor.state.tr.insertText('EDIT', pm);
      projection.translateTransaction(change, (at, bias) => projection.sourceAt(at, bias));
      const write = projection.changedCells[0].inline!;
      expect(write).toBeDefined();
      const next = patchTableInline(raw, cell.toJSON(), write);
      const expected = cell.toJSON();
      expected.content![1].content![1].content![0].content![0].content![0].text =
        text.slice(0, text.indexOf(large ? 'word450' : 'target') + 4) +
        'EDIT' +
        text.slice(text.indexOf(large ? 'word450' : 'target') + 4);
      expect(next).toEqual(expected);
      const planned = planTableTextPaste(
        source,
        0,
        table,
        point,
        point,
        { 'text/plain': '', 'text/html': '' },
        editor,
        () => cell.toJSON(),
        undefined,
        {
          name: 'replaceSelection',
          kind: 'text',
          slice: { content: [{ type: 'text', text: 'EDIT' }] },
        },
      );
      expect(planned.states[0].node).toEqual(expected);
      expect(planned.point).toEqual({ ...point, offset: point.offset + 4 });
    } finally {
      editor.destroy();
    }
  });

it('pages nested row ancestry through continued editing, destruction and global history', async () => {
  const editor = new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: true,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
  const cell = editor.schema.nodeFromJSON({
    type: 'tableHeader',
    content: [
      paragraph('prefix'),
      nested(Array.from({ length: 900 }, (_, i) => `row${i} café 🌍 tail`)),
      paragraph('suffix'),
    ],
  });
  const source = 'before KEEP\n\n| ' + clipboardCellSource(cell) + ' |\n| --- |\n\nafter KEEP';
  const owner = scanTables(source)[0].rows[0].cells[0].from;
  const backing = new SourceJournal(() => source, 1);
  Object.assign(backing, {
    tableStates: new Map([[`cell:${owner}`, JSON.stringify(cell.toJSON())]]),
  });
  const session = new DocumentSession(backing, document.createElement('div'));
  try {
    const target = source.indexOf('row450') + 4;
    await session.seek(target);
    const p = session.projection!;
    expect(p.sourceAt(p.pmAt(target))).toBe(target);
    expect(session.editor!.getJSON().content).toBeDefined();
    const before = session.editor!;
    before.commands.setTextSelection(p.pmAt(target));
    before.commands.insertContent('EDIT');
    expect(session.error).toBe('');
    const edited = source.slice(0, target) + 'EDIT' + source.slice(target);
    expect(backing.region(0)).toBe(edited);
    session.save();
    await session.seek(edited.indexOf('row899'));
    expect(before.isDestroyed).toBe(true);
    const distant = session.editor!;
    await session.seek(target + 4);
    expect(distant.isDestroyed).toBe(true);
    expect(session.projection!.sourceAt(session.editor!.state.selection.head)).toBe(target + 4);
    await session.history();
    expect(backing.region(0)).toBe(source);
    await session.history(true);
    expect(backing.region(0)).toBe(edited);
    expect(session.selection.table?.head.path).toBeDefined();
    const snap = session.snapshot();
    expect(snap.mounted).toBe(1);
    expect(snap.cachePages).toBeLessThanOrEqual(4);
    expect(snap.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    const fresh = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(edited),
        editable: true,
        useMarkdown: true,
        enableComments: true,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    try {
      let tables = 0;
      fresh.state.doc.descendants((node) => {
        if (node.type.name === 'table') tables++;
      });
      expect(tables).toBe(1);
      expect(fresh.getText()).toContain('row4EDIT50');
    } finally {
      fresh.destroy();
    }
  } finally {
    session.destroy();
    editor.destroy();
  }
});
