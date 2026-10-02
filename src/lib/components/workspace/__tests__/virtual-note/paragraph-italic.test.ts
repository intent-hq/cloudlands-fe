import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const source of [
  'before\n\n\nafter',
  '\n\n\n_italic_',
  '*italic*\n\n\n',
  'before\n\n\n\n\n**after**',
  '_italic_ and *other*',
  'before _italic_**bold** after',
  '**bold _italic_ bold**',
  '_italic **bold** italic_',
  'plain_word_inside and a*b*c',
  String.raw`literal \_plain\_ and _escaped \_ word_`,
  String.raw`literal \*plain\* and *escaped \* word*`,
  'unmatched _word and word_ and _ space _',
]) {
  it(`matches canonical paragraph marks and exact edit provenance: ${JSON.stringify(source)}`, async () => {
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
      await session.show(0);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(service.region(0)).toBe(source);
      const token = session.projection!.tokens.find((t) => /[A-Za-z]/.test(t.text))!;
      expect(session.projection!.sourceAt(token.pm)).toBe(token.from);
      const initial = session.editor!.getJSON();
      session.editor!.commands.setTextSelection(token.pm + 1);
      native.commands.setTextSelection(token.pm + 1);
      native.commands.insertContent('Z');
      session.editor!.commands.insertContent('Z');
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(service.region(0)).toBe(source.slice(0, token.to) + 'Z' + source.slice(token.to));
      const saved = service.region(0),
        selection = structuredClone(session.selection),
        old = session.editor!;
      session.save();
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.selection).toEqual(selection);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.editor!.getJSON()).toEqual(initial);
      await session.history(true);
      expect(service.region(0)).toBe(saved);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
    } finally {
      native.destroy();
      session.destroy();
    }
  });
}
for (const delimiter of ['_', '*']) {
  it(`keeps inherited ${delimiter} italic bounded across distant crop edits`, async () => {
    const source = delimiter + 'café word 🌍 '.repeat(9000).trimEnd() + delimiter;
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      for (const at of [10000, 50000, source.length - 6000]) {
        await session.seek(at);
        const node = session.editor!.state.doc.firstChild!.firstChild!;
        expect(node.marks.map((m) => m.type.name)).toEqual(['italic']);
        session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
        session.editor!.commands.insertContent('NEW');
        expect(session.error).toBe('');
        expect(service.region(0)).toBe(source.slice(0, at) + 'NEW' + source.slice(at));
        session.save();
        const old = session.editor!;
        await session.seek(0);
        expect(old.isDestroyed).toBe(true);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.head).toBe(at);
        await session.history(true);
        expect(service.region(0)).toBe(source.slice(0, at) + 'NEW' + source.slice(at));
        await session.history();
      }
      const s = session.snapshot();
      expect(s.maxSourceRead).toBeLessThanOrEqual(4096);
      expect(s.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(s.pmNodes).toBeLessThanOrEqual(256);
      expect(s.cachePages).toBeLessThanOrEqual(4);
      expect(s.cacheBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
    }
  });
}
