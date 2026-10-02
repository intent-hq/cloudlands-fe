import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { store } from '$store/renderer/configured-store';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = '| H | R |\n| --- | --- |\n| left | right |';
async function oracle(source: string) {
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
for (const action of ['selection', 'Tab'] as const)
  it(`preserves complete native fresh/live ${action} table documents through eviction and history`, async () => {
    const native = await oracle(source),
      service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.show(0);
      expect(native.getJSON().content).toHaveLength(1);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      let at = -1;
      native.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === 'right') at = pos + 1;
      });
      for (const editor of [native, session.editor!]) editor.commands.setTextSelection(at);
      expect(native.getJSON().content).toHaveLength(2);
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      if (action === 'Tab') {
        for (const editor of [native, session.editor!]) {
          const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
          expect(
            editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)),
          ).toBe(true);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(native.state.selection.$head.index(1)).toBe(2);
        expect(native.state.selection.$head.index(2)).toBe(0);
        expect(session.error).toBe('');
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
      }
      const saved = service.region(0),
        live = native.getJSON(),
        selected = native.state.selection.toJSON();
      session.save();
      const old = session.editor!;
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(live);
      expect(session.editor!.state.selection.toJSON()).toEqual(selected);
      {
        native.commands.undo();
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
        native.commands.redo();
        await session.history(true);
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
        expect(service.region(0)).toBe(saved);
      }
      const freshNative = await oracle(saved),
        fresh = new DocumentSession(
          new SourceJournal(() => saved, 1),
          document.createElement('div'),
        );
      try {
        await fresh.show(0);
        expect(freshNative.getJSON().content).toHaveLength(1);
        expect(fresh.editor!.getJSON()).toEqual(freshNative.getJSON());
        expect(service.region(0)).toBe(saved);
      } finally {
        fresh.destroy();
        freshNative.destroy();
      }
    } finally {
      session.destroy();
      native.destroy();
    }
  });
