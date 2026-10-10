import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = [
  'plain café 🌍 repeated repeated',
  'marked **café 🌍 repeated** and [repeated](https://example.test)',
  '- parent café repeated\n  - child 🌍 repeated\n- sibling repeated',
  '```text\nfenced café 🌍 repeated\n```',
  '| H | R |\n| --- | --- |\n| cell café 🌍 | repeated |',
  'following café 🌍 repeated repeated',
].join('\n\n');
async function pair() {
  const oracle = new Editor(
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
  await session.show(0);
  return { oracle, service, session };
}
for (const kind of ['list node', 'whole table cells'] as const)
  it(`restores native mixed ${kind} selection after actual eviction`, async () => {
    const { oracle, session } = await pair();
    try {
      let list = -1;
      const cells: number[] = [];
      oracle.state.doc.descendants((node, pos) => {
        if (node.type.name === 'bulletList' && list < 0) list = pos;
        if (['tableCell', 'tableHeader'].includes(node.type.name)) cells.push(pos);
      });
      for (const e of [oracle, session.editor!])
        e.view.dispatch(
          e.state.tr.setSelection(
            kind === 'list node'
              ? NodeSelection.create(e.state.doc, list)
              : CellSelection.create(e.state.doc, cells[0], cells.at(-1)!),
          ),
        );
      expect(session.error).toBe('');
      const old = session.editor!;
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });
for (let boundary = 0; boundary < 5; boundary++)
  it(`groups continuous typing after mixed boundary ${boundary} replacement like native history`, async () => {
    const { oracle, session, service } = await pair();
    try {
      let edge = 0;
      for (let i = 0; i <= boundary; i++) edge += oracle.state.doc.child(i).nodeSize;
      const from = TextSelection.near(oracle.state.doc.resolve(edge - 1), -1).head - 1;
      const to = TextSelection.near(oracle.state.doc.resolve(edge + 1), 1).head + 1;
      for (const e of [oracle, session.editor!]) {
        e.commands.setTextSelection({ from, to });
        let time = Date.now();
        for (const char of 'INSERTED') {
          const tr = e.state.tr.insertText(char).setTime(time++);
          e.view.dispatch(tr);
        }
      }
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      session.save();
      await session.seek(session.selection.head);
      oracle.commands.undo();
      await session.history();
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      expect(service.region(0)).toBe(source);
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
      oracle.commands.redo();
      await session.history(true);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });
