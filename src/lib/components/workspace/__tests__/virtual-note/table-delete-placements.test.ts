import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
import { scanTables } from './table-source';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const table =
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 60 }, (_, r) => `| left${r} | right${r} |`).join('\n');
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
for (const [name, prefix, suffix] of [
  ['prefix-only', 'untouched **prefix**\n\n', ''],
  ['suffix-only', '', '\n\nuntouched _suffix_'],
  ['standalone', '', ''],
  ['crlf-neighbors', 'untouched **prefix**\r\n\r\n', '\r\n\r\nuntouched _suffix_'],
  ['crlf-prefix-only', 'untouched **prefix**\r\n\r\n', ''],
  ['crlf-suffix-only', '', '\r\n\r\nuntouched _suffix_'],
  ['asymmetric-neighbors', 'untouched **prefix**\n\n', '\n\n\n\nuntouched _suffix_'],
])
  it(`preserves native deletion live and fresh phases with ${name}`, async () => {
    const source = prefix + table + suffix,
      native = await oracle(source);
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(source.indexOf('right20'));
      for (const editor of [native, session.editor!]) {
        let at = -1;
        editor.state.doc.descendants((n, p) => {
          if (n.type.name === 'paragraph' && n.textContent === 'right20') at = p + 1;
        });
        expect(at).toBeGreaterThan(0);
        editor.commands.setTextSelection(at);
      }
      const before = native.getJSON(),
        selected = structuredClone(session.selection);
      expect(native.commands.deleteTable()).toBe(true);
      expect(session.editor!.commands.deleteTable()).toBe(true);
      const region = scanTables(source)[0],
        saved = source.slice(0, region.from) + source.slice(region.to);
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(saved);
      session.save();
      const old = session.editor!;
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
      await session.history();
      native.commands.undo();
      expect(service.region(0)).toBe(source);
      expect(native.getJSON()).toEqual(before);
      expect(session.selection).toEqual({ ...selected, revision: service.revision });
      await session.history(true);
      native.commands.redo();
      expect(service.region(0)).toBe(saved);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
      const freshNative = await oracle(saved),
        fresh = new DocumentSession(
          new SourceJournal(() => saved, 1),
          document.createElement('div'),
        );
      try {
        await fresh.show(0);
        expect(fresh.editor!.getJSON()).toEqual(freshNative.getJSON());
      } finally {
        fresh.destroy();
        freshNative.destroy();
      }
      native.commands.insertContent('TYPED');
      session.editor!.commands.insertContent('TYPED');
      expect(session.error).toBe('');
      expect(service.region(0).replace('TYPED', '')).toBe(saved);
      const edited = session.editor!;
      await session.seek(session.selection.head);
      expect(edited.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      native.commands.insertContent(' AGAIN');
      session.editor!.commands.insertContent(' AGAIN');
      expect(session.error).toBe('');
      expect(service.region(0).replace('TYPED AGAIN', '')).toBe(saved);
      await session.seek(session.selection.head);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
      native.destroy();
    }
  });
