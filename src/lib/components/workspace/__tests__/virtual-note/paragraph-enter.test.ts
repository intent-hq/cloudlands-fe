import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
async function native(source: string) {
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
for (const newlineCount of [2, 3, 4])
  for (const position of ['start', 'middle', 'end'] as const)
    it(`preserves native paragraph split at ${position} before ${newlineCount} newlines`, async () => {
      const source = '_before_' + '\n'.repeat(newlineCount) + '**after**';
      const oracle = await native(source),
        service = new SourceJournal(() => source, 1),
        session = new DocumentSession(service, document.createElement('div'));
      try {
        await session.show(0);
        const at =
          position === 'start'
            ? 1
            : position === 'middle'
              ? 4
              : oracle.state.doc.firstChild!.nodeSize - 1;
        for (const editor of [oracle, session.editor!]) {
          editor.commands.setTextSelection(at);
          expect(editor.commands.splitBlock()).toBe(true);
        }
        expect(session.error).toBe('');
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
        const saved = service.region(0),
          canonical = await native(saved);
        try {
          expect(canonical.getJSON()).toEqual(oracle.getJSON());
        } finally {
          canonical.destroy();
        }
        expect(saved.endsWith('**after**')).toBe(true);
        if (position === 'end')
          expect(saved).toBe('_before_' + '\n'.repeat(newlineCount + 1) + '**after**');
        const old = session.editor!;
        session.save();
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        await session.history();
        oracle.commands.undo();
        expect(service.region(0)).toBe(source);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
        await session.history(true);
        oracle.commands.redo();
        expect(service.region(0)).toBe(saved);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      } finally {
        oracle.destroy();
        session.destroy();
      }
    });

it('independently distinguishes native true-end Tab live trailing paragraph from fresh canonical reload', async () => {
  const source = '| H | R |\n| --- | --- |\n| left | right |';
  const editor = await native(source);
  try {
    expect(editor.getJSON().content!.map((n) => n.type)).toEqual(['table']);
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'right') at = pos + 1;
    });
    editor.commands.setTextSelection(at);
    expect(editor.commands.keyboardShortcut('Tab')).toBe(true);
    const live = editor.getJSON();
    expect(live.content!.map((n) => n.type)).toEqual(['table', 'paragraph']);
    expect(live.content![1]).toEqual({ type: 'paragraph' });
    const saved = source + '\n|  |  |';
    const fresh = await native(saved);
    try {
      expect(fresh.getJSON()).toEqual({ type: 'doc', content: [live.content![0]] });
      editor.commands.undo();
      expect(editor.state.doc.firstChild!.childCount).toBe(2);
      editor.commands.redo();
      expect(editor.getJSON()).toEqual(live);
    } finally {
      fresh.destroy();
    }
  } finally {
    editor.destroy();
  }
});

for (const ending of [' ', '  ', '\t'])
  it(`retains native live trailing whitespace after a split (${JSON.stringify(ending)})`, async () => {
    const source = 'before' + ending + 'rest';
    const oracle = await native(source),
      service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.show(0);
      // Native HTML parsing collapses this raw whitespace run into one PM space.
      for (const e of [oracle, session.editor!]) {
        e.commands.setTextSelection(8);
        expect(e.commands.splitBlock()).toBe(true);
      }
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      const saved = 'before' + ending + '\n\nrest';
      expect(service.region(0)).toBe(saved);
      session.save();
      const old = session.editor!;
      await session.seek(0);
      expect(old.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      const canonical = await native(saved),
        fresh = new DocumentSession(
          new SourceJournal(() => saved, 1),
          document.createElement('div'),
        );
      try {
        await fresh.show(0);
        expect(fresh.editor!.getJSON()).toEqual(canonical.getJSON());
      } finally {
        canonical.destroy();
        fresh.destroy();
      }
      await session.history();
      oracle.commands.undo();
      expect(service.region(0)).toBe(source);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      await session.history(true);
      oracle.commands.redo();
      expect(service.region(0)).toBe(saved);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    } finally {
      oracle.destroy();
      session.destroy();
    }
  });
