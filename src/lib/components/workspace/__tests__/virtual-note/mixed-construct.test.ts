import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
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

// Small complete windows expose dispatch errors before any continuation/gesture
// oracle is introduced. The independent native parser supplies the entire tree.
for (const index of [0, 1, 2, 3, 4, -1]) {
  it(`preserves the native initial tree for mixed boundary ${index}`, async () => {
    const source = (index < 0 ? parts : parts.slice(index, index + 2)).join('\n\n');
    const native = new Editor(
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
    const backing = new SourceJournal(() => source, 1);
    const session = new DocumentSession(backing, document.createElement('div'));
    try {
      await new Promise<void>((resolve) => native.on('create', () => resolve()));
      expect(await session.show(0)).toBe(true);
      expect(session.error).toBe('');
      expect(backing.region(0)).toBe(source);
      native.commands.setTextSelection(session.editor!.state.selection.head);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
    } finally {
      session.destroy();
      native.destroy();
    }
  });
}
