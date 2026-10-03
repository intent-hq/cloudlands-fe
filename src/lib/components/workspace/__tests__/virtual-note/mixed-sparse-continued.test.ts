import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
async function native(source: string) {
  return new Editor(
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
}
for (const edge of ['before', 'after'] as const) {
  for (const shape of ['giant-cell', 'wide'] as const) {
    it(`bounds ${shape} admission and editing beside ${edge} prose`, async () => {
      const row = (r: number) =>
        '| ' +
        Array.from({ length: shape === 'wide' ? 300 : 2 }, (_, c) =>
          shape === 'giant-cell' ? `cell${r}${c} ` + 'café 🌍 '.repeat(4000) : `cell${r}-${c}`,
        ).join(' | ') +
        ' |';
      const table =
        row(0) +
        '\n| ' +
        Array(shape === 'wide' ? 300 : 2)
          .fill('---')
          .join(' | ') +
        ' |\n' +
        row(1);
      const source = 'before prose\n\n' + table + '\n\nafter prose';
      const backing = new SourceJournal(() => source, 1),
        session = new DocumentSession(backing, document.createElement('div'));
      try {
        const at =
          edge === 'before' ? source.indexOf('before') + 3 : source.indexOf('after prose') + 3;
        await session.seek(at);
        expect(session.error).toBe('');
        expect(session.projection!.mixed).toBeDefined();
        session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
        session.editor!.view.dispatch(session.editor!.state.tr.insertText('X'));
        expect(session.error).toBe('');
        expect(backing.region(0)).toBe(source.slice(0, at) + 'X' + source.slice(at));
        const old = session.editor!;
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        expect(session.error).toBe('');
        expect(session.snapshot().maxSourceRead).toBeLessThanOrEqual(4096);
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
        await session.history();
        expect(backing.region(0)).toBe(source);
      } finally {
        session.destroy();
      }
    });
  }
  for (const command of ['deleteTable', 'Delete', 'Backspace'] as const) {
    it(`applies ${command} to the whole table selected from ${edge} prose`, async () => {
      const table =
        '| H | R |\n| --- | --- |\n' +
        Array.from({ length: 800 }, (_, i) => `| row${i} | value${i} |\n`).join('');
      const source = 'before prose\n\n' + table + '\nafter prose';
      const oracle = await native(source),
        backing = new SourceJournal(() => source, 1),
        session = new DocumentSession(backing, document.createElement('div'));
      try {
        await session.seek(edge === 'before' ? 0 : source.length - 1);
        for (const editor of [oracle, session.editor!]) {
          let tablePos = -1;
          editor.state.doc.forEach((node, pos) => {
            if (node.type.name === 'table') tablePos = pos;
          });
          editor.view.dispatch(
            editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos)),
          );
          expect(editor.state.selection.toJSON().type).toBe('cell');
          if (command === 'deleteTable') expect(editor.commands.deleteTable()).toBe(true);
          else {
            let handled = false;
            editor.view.someProp('handleKeyDown', (handler) => {
              if (handler(editor.view, new KeyboardEvent('keydown', { key: command }))) {
                handled = true;
                return true;
              }
            });
            expect(handled).toBe(true);
          }
        }
        expect(session.error).toBe('');
        await session.seek(session.selection.head);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        const expectedSource = 'before prose\n\n\nafter prose';
        expect(backing.region(0)).toBe(expectedSource);
        const fresh = await native(backing.region(0)),
          canonical = await native(expectedSource);
        try {
          expect(fresh.getJSON()).toEqual(canonical.getJSON());
        } finally {
          fresh.destroy();
          canonical.destroy();
        }
        await session.history();
        expect(backing.region(0)).toBe(source);
      } finally {
        oracle.destroy();
        session.destroy();
      }
    });
  }
}

it('accounts for the table child resources in a sparse mixed projection', async () => {
  const source =
    'before\n\n| H | R |\n| --- | --- |\n' +
    Array.from({ length: 800 }, (_, i) => `| row${i} | value${i} |\n`).join('') +
    '\nafter';
  const session = new DocumentSession(
    new SourceJournal(() => source, 1),
    document.createElement('div'),
  );
  try {
    await session.seek(0);
    expect(session.projection!.mixed).toBeDefined();
    const snapshot = session.snapshot();
    expect(snapshot.tableCells).toBeGreaterThan(0);
    expect(snapshot.tableResourceBound).toBeDefined();
    expect(snapshot.tableDomElements).toBeGreaterThan(0);
    expect(snapshot.tableResourceBound!.nodes).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
  }
});
