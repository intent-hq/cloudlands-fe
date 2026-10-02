import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';
import { scanTables } from './table-source';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source =
  'untouched **prefix**\n\n| H | R |\n| --- | --- |\n' +
  Array.from({ length: 80 }, (_, r) => `| left${r} | right${r} |`).join('\n') +
  '\n\nuntouched _suffix_';
for (const fault of ['none', 'stage', 'record'] as const) {
  it(`deletes the logical table with exact neighboring source and native history (${fault})`, async () => {
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
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(source.indexOf('right30'));
      for (const editor of [native, session.editor!]) {
        let at = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === 'right30') at = pos + 1;
        });
        editor.commands.setTextSelection(at);
      }
      const selection = structuredClone(session.selection),
        doc = session.editor!.getJSON(),
        depth = service.depth;
      let spy: ReturnType<typeof vi.spyOn> | undefined;
      if (fault !== 'none') {
        const original = service[fault].bind(service);
        spy = vi.spyOn(service, fault).mockImplementationOnce((...args: never[]) => {
          Reflect.apply(original, service, args);
          throw new Error(`injected delete ${fault}`);
        });
      }
      const nativeBefore = native.getJSON();
      expect(native.commands.deleteTable()).toBe(true);
      expect(session.editor!.commands.deleteTable()).toBe(true);
      spy?.mockRestore();
      if (fault !== 'none') {
        expect(session.error).toContain(`injected delete ${fault}`);
        expect(service.region(0)).toBe(source);
        expect(service.depth).toBe(depth);
        expect(session.selection).toEqual(selection);
        expect(session.editor!.getJSON()).toEqual(doc);
        return;
      }
      const table = scanTables(source)[0];
      const saved = source.slice(0, table.from) + source.slice(table.to);
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(saved);
      const old = session.editor!;
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
      const after = structuredClone(session.selection);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection).toEqual({ ...selection, revision: service.revision });
      expect(native.commands.undo()).toBe(true);
      expect(native.getJSON()).toEqual(nativeBefore);
      await session.history(true);
      expect(native.commands.redo()).toBe(true);
      expect(service.region(0)).toBe(saved);
      expect(session.selection).toEqual({ ...after, revision: service.revision });
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
      expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
