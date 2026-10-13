import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const native = async (source: string) =>
  new Editor(
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
for (const body of ['café 🌍 repeated', 'first\n- literal item\n<!--anchor:literal:start-->last']) {
  it(`keeps nested code live through edit, destruction and history: ${body}`, async () => {
    const source = `- sibling\n\n\`\`\`text\n${body}\n\`\`\`\n\nfollowing`;
    const oracle = await native(source);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    let fresh: Editor | undefined;
    try {
      await session.show(0);
      const edge = oracle.state.doc.firstChild!.nodeSize + 1;
      for (const editor of [oracle, session.editor!]) {
        editor.commands.setTextSelection(edge);
        editor.commands.keyboardShortcut('Backspace');
      }
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(oracle.state.selection.toJSON());
      const joined = service.region(0);
      expect(joined.trim()).toBe(processHTMLToMarkdown(oracle.getHTML()).trim());
      session.save();
      const destroyed = session.editor!;
      await session.seek(session.selection.head);
      expect(destroyed.isDestroyed).toBe(true);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      let code = -1;
      oracle.state.doc.descendants((node, pos) => {
        if (node.type.name === 'codeBlock') code = pos;
      });
      for (const editor of [oracle, session.editor!]) {
        const tr = editor.state.tr.insertText('EDIT', code + 2);
        tr.setTime(Date.now() + 2000);
        editor.view.dispatch(tr);
      }
      expect(session.error).toBe('');
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      session.save();
      fresh = await native(processHTMLToMarkdown(oracle.getHTML()));
      const reopened = await native(service.region(0));
      expect(reopened.getJSON()).toEqual(fresh.getJSON());
      expect(reopened.getJSON()).not.toEqual(oracle.getJSON());
      reopened.destroy();
      await session.seek(session.selection.head);
      expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      for (let i = 0; i < 2; i++) {
        oracle.commands.undo();
        await session.history();
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      }
      expect(service.region(0)).toBe(source);
      for (let i = 0; i < 2; i++) {
        oracle.commands.redo();
        await session.history(true);
        expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
      }
      expect(session.snapshot().inlineContextBytes).toBeLessThanOrEqual(4096);
    } finally {
      session.destroy();
      oracle.destroy();
      fresh?.destroy();
    }
  });
}

it('crops a large live nested code body without copying its text into metadata', async () => {
  const body = 'café 🌍 literal repeated '.repeat(8000);
  const input = `- sibling\n\n\`\`\`text\n${body}\n\`\`\`\n\nfollowing`;
  const oracle = await native(input);
  oracle.commands.setTextSelection(oracle.state.doc.firstChild!.nodeSize + 1);
  oracle.commands.keyboardShortcut('Backspace');
  const source = processHTMLToMarkdown(oracle.getHTML()).trimEnd();
  const from = source.indexOf('`'),
    bodyFrom = from + 1,
    bodyTo = bodyFrom + body.length;
  const service = new SourceJournal(() => source, 1);
  service.setListCodes(
    0,
    source.length,
    [{ item: 0, from, bodyFrom, bodyTo, to: bodyTo + 1, language: 'text' }],
    service.revision,
    false,
  );
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    const at = bodyFrom + 30000;
    await session.seek(at);
    expect(session.editor).not.toBeNull();
    session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
    const point = session.editor!.state.selection.$from;
    expect(Array.from({ length: point.depth + 1 }, (_, d) => point.node(d).type.name)).toEqual([
      'doc',
      'bulletList',
      'listItem',
      'codeBlock',
    ]);
    expect(session.editor!.state.doc.textContent.length).toBeLessThan(4096);
    expect(session.projection!.context!.listCodes).toEqual([
      { item: 0, from, bodyFrom, bodyTo, to: bodyTo + 1, language: 'text' },
    ]);
    session.editor!.view.dispatch(session.editor!.state.tr.insertText('Z'));
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(source.slice(0, at) + 'Z' + source.slice(at));
    session.save();
    const old = session.editor!;
    await session.seek(at + 50000);
    expect(old.isDestroyed).toBe(true);
    await session.history();
    expect(service.region(0)).toBe(source);
    await session.history(true);
    expect(service.region(0)).toBe(source.slice(0, at) + 'Z' + source.slice(at));
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(4096);
    expect(session.snapshot().inlineContextBytes).toBeLessThanOrEqual(4096);
    expect(service.stats.maxJournalRead).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
    oracle.destroy();
  }
});

it('maps nested live code history through an unrelated remote edit and rejects conflicting rebases atomically', async () => {
  const source = 'before\n\n- sibling\n\n```text\ncode café\n```\n\nafter';
  const oracle = await native(source);
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.show(0);
    let code = -1;
    oracle.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') code = pos;
    });
    for (const editor of [oracle, session.editor!]) {
      editor.commands.setTextSelection(code + 1);
      editor.commands.keyboardShortcut('Backspace');
    }
    expect(session.error).toBe('');
    oracle.view.dispatch(oracle.state.tr.insertText('R', 1).setMeta('addToHistory', false));
    session.remote({ from: 0, to: 0, insert: 'R' });
    await session.seek(session.selection.head);
    expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    const context = service.inlineContext(0, service.length),
      revision = service.revision;
    const encoded = service.region(0);
    const current = context.listCodes![0];
    expect(() =>
      session.remote({ from: current.bodyFrom, to: current.bodyFrom + 1, insert: 'X' }),
    ).toThrow('Conflict');
    expect(service.region(0)).toBe(encoded);
    expect(service.revision).toBe(revision);
    expect(service.inlineContext(0, service.length)).toEqual(context);
    expect(() => service.setListCodes(0, service.length, [], revision - 1)).toThrow('Stale');
    oracle.commands.undo();
    await session.history();
    expect(service.region(0)).toBe('R' + source);
    expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    oracle.commands.redo();
    await session.history(true);
    expect(session.editor!.getJSON()).toEqual(oracle.getJSON());
    expect(service.region(0)).toBe(encoded);
  } finally {
    session.destroy();
    oracle.destroy();
  }
});

it('does not activate nested code markers or let literal fence syntax hide a following comment', () => {
  const body = '<!--anchor:literal:start-->text<!--anchor:literal:end-->\n```';
  const source = '- sibling`' + body + '`\n\n<!--anchor:real:start-->real<!--anchor:real:end-->';
  const from = source.indexOf('`'),
    bodyFrom = from + 1,
    bodyTo = bodyFrom + body.length;
  const service = new SourceJournal(() => source, 1);
  service.setListCodes(
    0,
    source.length,
    [{ item: 0, from, bodyFrom, bodyTo, to: bodyTo + 1, language: 'text' }],
    service.revision,
    false,
  );
  service.registerComment('literal');
  service.registerComment('real');
  expect(service.anchors.find((a) => a.id === 'literal')?.alive).toBe(false);
  expect(service.anchors.find((a) => a.id === 'real')?.alive).toBe(true);
  const context = service.inlineContext(0, source.length),
    revision = service.revision;
  expect(() =>
    service.atomic(() => {
      service.stage({ from: bodyFrom, to: bodyFrom + 1, insert: 'X' });
      service.setListCodes(
        0,
        service.length,
        [{ ...context.listCodes![0], bodyTo: bodyTo + 4 }],
        service.revision,
      );
    }),
  ).toThrow('Invalid');
  expect(service.region(0)).toBe(source);
  expect(service.revision).toBe(revision);
  expect(service.inlineContext(0, source.length)).toEqual(context);
});
