import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const literal of [false, true])
  it(`retains ${literal ? 'literal newline text' : 'native hard breaks'} through bounded list edits and eviction`, async () => {
    const source =
      '- item START\n' +
      Array.from({ length: 900 }, (_, i) => `line${i} café 🌍`).join('\n') +
      '\nlast END';
    const backing = new SourceJournal(() => source, 1);
    if (literal)
      backing.atomic(() =>
        backing.setLiteralNewlines(0, source.length, [{ item: 0, from: 2, to: source.length }]),
      );
    const session = new DocumentSession(backing, document.createElement('div'));
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
    try {
      const target = source.indexOf('line450');
      await session.seek(target);
      const editor = session.editor!,
        projection = session.projection!;
      let hardBreaks = 0,
        nodes = 0;
      editor.state.doc.descendants((n) => {
        nodes++;
        if (n.type.name === 'hardBreak') hardBreaks++;
      });
      expect(nodes).toBeLessThanOrEqual(256);
      expect(literal ? hardBreaks === 0 : hardBreaks > 0).toBe(true);
      expect(projection.sourceAt(projection.pmAt(target))).toBe(target);
      const nextLine = source.indexOf('\n', target);
      expect(projection.pmAt(nextLine + 1) - projection.pmAt(nextLine)).toBe(1);
      editor.commands.setTextSelection(projection.pmAt(target + 4));
      editor.commands.insertContent('EDIT');
      expect(session.error).toBe('');
      const edited = source.slice(0, target + 4) + 'EDIT' + source.slice(target + 4);
      expect(backing.region(0)).toBe(edited);
      session.save();
      await session.seek(target + 4);
      expect(editor.isDestroyed).toBe(true);
      expect(session.editor!.state.doc.textContent).toContain('lineEDIT450');
      const reloaded = session.editor!;
      await session.history();
      expect(backing.region(0)).toBe(source);
      await session.history(true);
      expect(backing.region(0)).toBe(edited);
      expect(reloaded.isDestroyed).toBe(true);
      const fresh = new DocumentSession(
        new SourceJournal(() => source, 1),
        document.createElement('div'),
      );
      try {
        await fresh.seek(target);
        let freshBreaks = 0;
        fresh.editor!.state.doc.descendants((n) => {
          if (n.type.name === 'hardBreak') freshBreaks++;
        });
        expect(freshBreaks).toBeGreaterThan(0);
        expect(native.state.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('paragraph');
      } finally {
        fresh.destroy();
      }
      expect(session.snapshot().mounted).toBe(1);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
      native.destroy();
    }
  });

it('matches native full list hard-break widths and every line caret', async () => {
  const source = '- first\nnext\nlast\n- second\nmore\nlast';
  const backing = new SourceJournal(() => source, 1),
    session = new DocumentSession(backing, document.createElement('div'));
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
  try {
    await session.seek(2);
    native.commands.setTextSelection(1);
    expect(session.editor!.getJSON()).toEqual(native.getJSON());
    for (const value of ['first', 'next', 'second', 'more']) {
      const sourceAt = source.indexOf(value),
        pm = session.projection!.pmAt(sourceAt);
      expect(session.editor!.state.doc.textBetween(pm, pm + value.length)).toBe(value);
      expect(session.projection!.sourceAt(pm)).toBe(sourceAt);
    }
  } finally {
    session.destroy();
    native.destroy();
  }
});
