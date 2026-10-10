import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const parts = [
  'plain café 🌍 repeated repeated',
  'marked **café 🌍 repeated** and [repeated](https://example.test)',
  '- parent café repeated\n  - child 🌍 repeated\n- sibling repeated',
  '```text\nfenced café 🌍 repeated\n```',
  '| H | R |\n| --- | --- |\n| cell café 🌍 | repeated |',
  'following café 🌍 repeated repeated',
];
const source = parts.join('\n\n');
for (let boundary = 0; boundary < parts.length - 1; boundary++) {
  for (const operation of ['Backspace', 'Delete', 'paste'] as const) {
    it(`preserves native ${operation} across mixed boundary ${boundary}`, async () => {
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
      const service = new SourceJournal(() => source, 1);
      const session = new DocumentSession(service, document.createElement('div'));
      try {
        await session.show(0);
        let edge = 0;
        for (let i = 0; i <= boundary; i++) edge += oracle.state.doc.child(i).nodeSize;
        const left = TextSelection.near(oracle.state.doc.resolve(edge - 1), -1).head;
        const right = TextSelection.near(oracle.state.doc.resolve(edge + 1), 1).head;
        const range =
          operation === 'paste'
            ? { from: left - 1, to: right + 1 }
            : operation === 'Backspace'
              ? right
              : left;
        oracle.commands.setTextSelection(range);
        session.editor!.commands.setTextSelection(range);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        if (operation === 'paste') {
          oracle.commands.insertContent('PASTED café');
          session.editor!.commands.insertContent('PASTED café');
        } else {
          oracle.commands.keyboardShortcut(operation);
          session.editor!.commands.keyboardShortcut(operation);
        }
        if (session.error) {
          const saved = processHTMLToMarkdown(oracle.getHTML());
          const fresh = new Editor(
            createEditorConfig({
              element: document.createElement('div'),
              content: await processMarkdownToHTML(saved),
              editable: true,
              useMarkdown: true,
              enableComments: false,
              enableMentions: false,
              onUpdate: () => {},
            }),
          );
          console.info(
            'Mixed boundary native grammar',
            JSON.stringify({
              boundary,
              operation,
              error: session.error,
              live: oracle.getJSON(),
              saved,
              fresh: fresh.getJSON(),
              selection: oracle.state.selection.toJSON(),
            }),
          );
          fresh.destroy();
        }
        expect(session.error).toBe('');
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
        const edited = service.region(0);
        if (boundary > 0) expect(edited.startsWith(parts[0])).toBe(true);
        if (boundary < parts.length - 2) expect(edited.endsWith(parts.at(-1)!)).toBe(true);
        const old = session.editor!;
        session.save();
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        oracle.commands.undo();
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        oracle.commands.redo();
        await session.history(true);
        expect(service.region(0)).toBe(edited);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });
  }
}
