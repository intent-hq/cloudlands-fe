import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

it('retains dense native cell paragraphs and untouched marks through eviction and history', async () => {
  const source =
    '| H |\n| --- |\n| ' +
    '**bold** _italic_ `code` \\| \\\\ '.repeat(500) +
    'TARGET ' +
    '**bold** _italic_ `code` \\| \\\\ '.repeat(500) +
    ' |';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
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
    let position = -1;
    native.state.doc.descendants((node, pos) => {
      if (node.isText && node.text!.includes('TARGET'))
        position = pos + node.text!.indexOf('TARGET');
    });
    expect(position).toBeGreaterThan(0);
    native.commands.setTextSelection(position);
    expect(native.commands.splitBlock()).toBe(true);
    expect(native.state.selection.$head.index(3)).toBe(1);
    expect(native.state.selection.$head.parent.textContent.startsWith('TARGET')).toBe(true);
    const saved = processHTMLToMarkdown(native.getHTML());
    console.info(
      'Dense native Enter control',
      JSON.stringify({
        sourceBytes: new TextEncoder().encode(source).length,
        nativeParagraphs: native.state.selection.$head.node(3).childCount,
        savedPrefix: saved.slice(0, 100),
        savedHasBold: saved.includes('**bold**'),
      }),
    );
    await session.seek(source.indexOf('TARGET'));
    session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('TARGET')));
    expect(session.editor!.commands.splitBlock()).toBe(true);
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(source);
    const old = session.editor!;
    session.save();
    await session.seek(source.indexOf('TARGET'));
    expect(old.isDestroyed).toBe(true);
    expect(session.editor!.state.selection.$head.index(3)).toBe(1);
    expect(session.editor!.state.selection.$head.parentOffset).toBe(0);
    expect(session.editor!.state.selection.$head.parent.textContent.startsWith('TARGET')).toBe(
      true,
    );
    await session.history();
    expect(session.editor!.state.selection.$head.index(3)).toBe(0);
    await session.history(true);
    expect(session.editor!.state.selection.$head.index(3)).toBe(1);
    expect(service.region(0)).toBe(source);
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(service.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
  } finally {
    native.destroy();
    session.destroy();
  }
});

it('preserves native marked cell identity through the existing multi-paragraph save path', async () => {
  const source = '| H |\n| --- |\n| **bold** _italic_ `code` \\| \\\\ TARGET tail |';
  const create = async (markdown: string) =>
    new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(markdown),
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
  const native = await create(source);
  let fresh: Editor | undefined;
  try {
    let position = -1;
    native.state.doc.descendants((node, pos) => {
      if (node.isText && node.text!.includes('TARGET'))
        position = pos + node.text!.indexOf('TARGET');
    });
    expect(position).toBeGreaterThan(0);
    native.commands.setTextSelection(position);
    expect(native.commands.splitBlock()).toBe(true);
    const live = native.state.doc.firstChild!.child(1).child(0);
    const saved = processHTMLToMarkdown(native.getHTML());
    fresh = await create(saved);
    const reloaded = fresh.state.doc.firstChild!.child(1).child(0);
    console.info(
      'Independent native multi-paragraph save',
      JSON.stringify({
        source,
        saved,
        live: live.toJSON(),
        reloaded: reloaded.toJSON(),
      }),
    );
    expect(reloaded.textContent).toBe(live.textContent);
    expect(reloaded.firstChild!.content.toJSON()).toEqual(
      live.firstChild!.content.append(live.lastChild!.content).toJSON(),
    );
  } finally {
    fresh?.destroy();
    native.destroy();
  }
});
