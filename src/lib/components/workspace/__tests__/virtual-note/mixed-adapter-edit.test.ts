import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const source = [
  'plain café 🌍 repeated repeated',
  'marked **café 🌍 repeated** and [repeated](https://example.test)',
  '- parent café repeated\n  - child 🌍 repeated\n- sibling repeated',
  '```text\nfenced café 🌍 repeated\n```',
  '| H | R |\n| --- | --- |\n| cell café 🌍 | repeated |',
  'following café 🌍 repeated repeated',
].join('\n\n');
async function native(text: string) {
  return new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: await processMarkdownToHTML(text),
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
}
for (const needle of [
  'plain café',
  'marked ',
  'parent café',
  'fenced café',
  'cell café',
  'following café',
]) {
  it(`routes a native ${needle} edit through the mixed window and retains evicted history`, async () => {
    const oracle = await native(source);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      expect(await session.show(0)).toBe(true);
      let at = -1;
      oracle.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle) + 2;
      });
      expect(at).toBeGreaterThan(0);
      oracle.commands.setTextSelection(at);
      session.editor!.commands.setTextSelection(
        session.projection!.pmAt(source.indexOf(needle) + 2),
      );
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      oracle.commands.insertContent('X');
      session.editor!.commands.insertContent('X');
      expect(session.error).toBe('');
      const edited = source.replace(needle, needle.slice(0, 2) + 'X' + needle.slice(2));
      expect(service.region(0)).toBe(edited);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
      const fresh = await native(edited);
      try {
        expect(fresh.getJSON()).toEqual(oracle.getJSON());
      } finally {
        fresh.destroy();
      }
      const old = session.editor!;
      session.save();
      await session.seek(0);
      expect(old.isDestroyed).toBe(true);
      oracle.commands.undo();
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
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

it('replays one chronological history across all mixed construct adapters', async () => {
  const oracle = await native(source);
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  const needles = [
    'plain café',
    'marked ',
    'parent café',
    'fenced café',
    'cell café',
    'following café',
  ];
  const versions = [source];
  try {
    await session.show(0);
    for (const [index, needle] of needles.entries()) {
      const before = versions.at(-1)!;
      let at = -1;
      oracle.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle) + 2;
      });
      const sourceAt = before.indexOf(needle) + 2;
      oracle.commands.setTextSelection(at);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(sourceAt));
      oracle.view.dispatch(oracle.state.tr.insertText('X').setTime(10000 + index * 1000));
      session.editor!.view.dispatch(
        session.editor!.state.tr.insertText('X').setTime(10000 + index * 1000),
      );
      versions.push(before.slice(0, sourceAt) + 'X' + before.slice(sourceAt));
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(versions.at(-1));
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      const old = session.editor!;
      session.save();
      await session.seek(0);
      expect(old.isDestroyed).toBe(true);
    }
    for (let index = versions.length - 2; index >= 0; index--) {
      oracle.commands.undo();
      await session.history();
      expect(service.region(0)).toBe(versions[index]);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
    }
    for (let index = 1; index < versions.length; index++) {
      oracle.commands.redo();
      await session.history(true);
      expect(service.region(0)).toBe(versions[index]);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    }
  } finally {
    session.destroy();
    oracle.destroy();
  }
});

it('keeps the mounted view when mixed prose exceeds its original node allowance', async () => {
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.show(0);
    const old = session.editor!,
      before = old.getJSON();
    const oversized = 'paragraph\n\n'.repeat(130) + '| H |\n| --- |\n| body |';
    session.remote({ from: 0, to: service.length, insert: oversized });
    expect(await session.seek(0)).toBe(false);
    expect(session.error).toContain('construct node budget');
    expect(old.isDestroyed).toBe(false);
    expect(session.editor).toBe(old);
    expect(old.getJSON()).toEqual(before);
  } finally {
    session.destroy();
  }
});
