import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { undoDepth } from '@tiptap/pm/history';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const kind of ['list', 'table'])
  for (const delay of [10, 600])
    it(`matches native ${kind} boundary typing history across remounts at ${delay}ms`, async () => {
      const code =
        '```text\n' +
        Array.from({ length: 900 }, (_, i) => `line${i} café 🌍`).join('\n') +
        '\n```';
      const table =
        '| H | R |\n| --- | --- |\n' +
        Array.from({ length: 800 }, (_, i) => `| cell${i} | value |`).join('\n');
      const paragraph =
        'following START ' + Array.from({ length: 900 }, (_, i) => `segment${i} café 🌍`).join(' ');
      const source =
        'before KEEP\n\n' +
        (kind === 'list' ? '- sibling END\n\n' + code : table + '\n\n' + paragraph) +
        '\n\nafter KEEP';
      const oracle = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content: await processMarkdownToHTML(source),
          editable: true,
          useMarkdown: true,
          enableComments: true,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      const initial = oracle.getJSON(),
        backing = new SourceJournal(() => source, 1),
        session = new DocumentSession(backing, document.createElement('div'));
      try {
        await session.seek(source.indexOf(kind === 'list' ? '```text' : 'following START'));
        for (const e of [oracle, session.editor!]) {
          let boundary = 0;
          e.state.doc.forEach((n, at) => {
            if (n.type.name === (kind === 'list' ? 'codeBlock' : 'table'))
              boundary = at + (kind === 'list' ? 0 : n.nodeSize);
          });
          const left = TextSelection.near(e.state.doc.resolve(boundary - 1), -1).head - 1;
          const right = TextSelection.near(e.state.doc.resolve(boundary + 1), 1).head + 1;
          e.commands.setTextSelection({ from: left, to: right });
        }
        const depths = [],
          nativeDepths = [],
          sources = [source];
        for (const [i, char] of [...'MOVE'].entries()) {
          oracle.view.dispatch(oracle.state.tr.insertText(char).setTime(1000 + i * delay));
          const e = session.editor!;
          e.view.dispatch(e.state.tr.insertText(char).setTime(1000 + i * delay));
          expect(session.error).toBe('');
          await session.seek(session.selection.head);
          depths.push(backing.depth);
          nativeDepths.push(undoDepth(oracle.state));
          sources.push(backing.region(0));
        }
        expect(depths).toEqual(nativeDepths);
        const count = undoDepth(oracle.state);
        for (let i = 0; i < count; i++) {
          expect(oracle.commands.undo()).toBe(true);
          expect(await session.history()).toBe(true);
          expect(backing.region(0)).toBe(sources[count === 1 ? 0 : count - i - 1]);
        }
        expect(oracle.getJSON()).toEqual(initial);
        expect(backing.region(0)).toBe(source);
        for (let i = 0; i < count; i++) {
          expect(oracle.commands.redo()).toBe(true);
          expect(await session.history(true)).toBe(true);
          expect(backing.region(0)).toBe(sources[count === 1 ? 4 : i + 1]);
        }
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });
