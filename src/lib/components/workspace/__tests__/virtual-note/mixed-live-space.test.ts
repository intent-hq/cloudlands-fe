import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
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
      enableComments: true,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
}
for (const clipped of [false, true]) {
  it(`retains native live whitespace after deleting marker atoms clipped=${clipped}`, async () => {
    const padding = clipped ? 'padding café 🌍 '.repeat(600) : '';
    const opening = '<!--anchor:space:start-->',
      closing = '<!--anchor:space:end-->';
    const input = padding + 'before ' + opening + 'selected' + closing + ' after' + padding;
    const backing = new SourceJournal(() => input, 1);
    const session = new DocumentSession(backing, document.createElement('div'));
    const oracle = await native(input);
    try {
      const from = input.indexOf(opening),
        to = input.indexOf(closing) + closing.length;
      await session.seek(from);
      let nativeFrom = -1,
        nativeTo = -1;
      oracle.state.doc.descendants((node, at) => {
        if (node.type.name === 'commentAnchor') {
          if (node.attrs.type === 'start') nativeFrom = at;
          else nativeTo = at + 1;
        }
      });
      oracle.commands.setTextSelection({ from: nativeFrom, to: nativeTo });
      session.editor!.commands.setTextSelection({
        from: session.projection!.pmAt(from),
        to: session.projection!.pmAt(to),
      });
      oracle.commands.deleteSelection();
      session.editor!.commands.deleteSelection();
      expect(session.error).toBe('');
      const edited = input.slice(0, from) + input.slice(to);
      expect(backing.region(0)).toBe(edited);
      expect(session.editor!.state.doc.textContent).toContain('before  after');
      if (!clipped) expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      session.save();
      const old = session.editor!;
      await session.seek(from);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.state.doc.textContent).toContain('before  after');
      expect(session.projection!.sourceAt(session.projection!.pmAt(from))).toBe(from);
      const fresh = await native(edited);
      try {
        expect(fresh.state.doc.textContent).toContain('before after');
      } finally {
        fresh.destroy();
      }
      await session.history();
      expect(backing.region(0)).toBe(input);
      await session.history(true);
      expect(backing.region(0)).toBe(edited);
      expect(session.editor!.state.doc.textContent).toContain('before  after');
      session.remote({ from: 0, to: 0, insert: 'REMOTE ' });
      await session.seek(from + 7);
      expect(session.editor!.state.doc.textContent).toContain('before  after');
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });
}
