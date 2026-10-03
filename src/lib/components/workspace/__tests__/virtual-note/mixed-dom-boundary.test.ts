import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
for (const rows of [0, 2, 800])
  for (const header of ['Header **café 🌍**', '**wide 🌍** '.repeat(800)])
    for (const before of ['preceding café 🌍', '```text\npreceding café 🌍\n```'])
      for (const collapsed of [true, false])
        it(`replays raw leading table boundary ${collapsed ? 'collapsed' : 'extended'} after ${before.startsWith('```') ? 'fence' : 'paragraph'} ${header.length > 100 ? 'clipped' : 'complete'} header ${rows} rows`, async () => {
          const source =
            before +
            `\n\n| ${header} | R |\n| --- | --- |\n` +
            Array.from({ length: rows }, (_, i) => `| row${i} | repeated |\n`).join('') +
            '\nfollowing café 🌍';
          const oracle = new Editor(
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
          const backing = new SourceJournal(() => source, 1),
            session = new DocumentSession(backing, document.createElement('div'));
          try {
            await session.seek(source.length - 1);
            const editor = session.editor!,
              part = session.projection!.mixed!.parts.find((p) => p.projection.table)!;
            const nativeTable = oracle.state.doc.firstChild!.nodeSize;
            const rawHead = part.pm + 1;
            const rawAnchor = collapsed
              ? rawHead
              : editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1;
            const nativeAnchor = collapsed
              ? nativeTable + 1
              : oracle.state.doc.content.size - oracle.state.doc.lastChild!.nodeSize + 1;
            oracle.view.dispatch(
              oracle.state.tr.setSelection(
                TextSelection.between(
                  oracle.state.doc.resolve(nativeAnchor),
                  oracle.state.doc.resolve(nativeTable + 1),
                  -1,
                ),
              ),
            );
            const handler = editor.view.props.createSelectionBetween;
            expect(handler).toBeTypeOf('function');
            const selected =
              handler!(
                editor.view,
                editor.state.doc.resolve(rawAnchor),
                editor.state.doc.resolve(rawHead),
              ) ??
              TextSelection.between(
                editor.state.doc.resolve(rawAnchor),
                editor.state.doc.resolve(rawHead),
                -1,
              );
            // Match ProseMirror's DOM reader: equal callback selection does not dispatch.
            if (!selected.eq(editor.state.selection))
              editor.view.dispatch(editor.state.tr.setSelection(selected));
            await expect.poll(() => Reflect.get(session, 'domBoundaryPending')).toBe(false);
            // A clipped paragraph intentionally omits offscreen text. Compare its
            // durable native endpoints, then independently compare admitted content.
            await expect
              .poll(() => session.editor!.state.selection.$head.parent.type.name)
              .toBe(oracle.state.selection.$head.parent.type.name);
            expect(session.editor).toBe(editor);
            expect(session.error).toBe('');
            const actual = session.editor!.state.selection,
              expected = oracle.state.selection;
            expect({
              type: actual.toJSON().type,
              anchor: session.selection.table?.anchor.offset ?? actual.$anchor.parentOffset,
              head: session.selection.table?.head.offset ?? actual.$head.parentOffset,
            }).toEqual({
              type: expected.toJSON().type,
              anchor: expected.$anchor.parentOffset,
              head: expected.$head.parentOffset,
            });
            if (header.length < 100 || collapsed)
              expect(actual.$head.parent.toJSON()).toEqual(expected.$head.parent.toJSON());
            else {
              const table =
                session.projection!.table ??
                session.projection!.mixed!.parts.find((p) => p.projection.table)!.projection.table!;
              const block = table.paragraphs.find(
                (p) => p.cell.from === session.selection.table!.head.cell,
              )!;
              expect(actual.$head.parent.toJSON()).toEqual(
                expected.$head.parent
                  .cut(block.offset, block.offset + actual.$head.parent.content.size)
                  .toJSON(),
              );
            }
            expect(backing.region(0)).toBe(source);
            for (const e of [oracle, session.editor!]) e.commands.insertContent('EDIT');
            expect(session.error).toBe('');
            const edited = backing.region(0);
            expect(edited).not.toBe(source);
            if (rows) expect(edited).toContain(`row${Math.floor(rows / 2)}`);
            const fresh = new Editor(
              createEditorConfig({
                element: document.createElement('div'),
                content: await processMarkdownToHTML(edited),
                editable: true,
                useMarkdown: true,
                enableComments: false,
                enableMentions: false,
                onUpdate: () => {},
              }),
            );
            try {
              expect(fresh.getJSON()).toEqual(oracle.getJSON());
            } finally {
              fresh.destroy();
            }
            const old = session.editor!;
            session.save();
            await session.seek(backing.length - 1);
            expect(old.isDestroyed).toBe(true);
            await session.history();
            expect(backing.region(0)).toBe(source);
            await session.history(true);
            expect(backing.region(0)).toBe(edited);

            expect(session.snapshot().mounted).toBe(1);
            expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
          } finally {
            session.destroy();
            oracle.destroy();
          }
        });

for (const invalidation of ['none', 'remote', 'selection'] as const)
  it(`fences delayed raw boundary replay after ${invalidation}`, async () => {
    const source =
      'before café\n\n| Header 🌍 | R |\n| --- | --- |\n' +
      Array.from({ length: 800 }, (_, i) => `| row${i} | value |\n`).join('') +
      '\nafter';
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div'));
    try {
      await session.seek(source.length - 1);
      const editor = session.editor!,
        part = session.projection!.mixed!.parts.find((p) => p.projection.table)!;
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      let release!: () => void;
      session.delayFetch = () =>
        new Promise<void>((r) => {
          release = r;
        });
      editor.view.props.createSelectionBetween!(
        editor.view,
        editor.state.doc.resolve(part.pm + 1),
        editor.state.doc.resolve(part.pm + 1),
      );
      await expect.poll(() => typeof release).toBe('function');
      if (invalidation === 'remote') session.remote({ from: 0, to: 0, insert: 'REMOTE ' });
      if (invalidation === 'selection')
        editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      const selection = structuredClone(session.selection),
        projected = session.projection;
      session.delayFetch = undefined;
      release();
      if (invalidation === 'none') {
        await expect
          .poll(() => session.editor!.state.selection.$head.parent.textContent)
          .toBe('before café');
        expect(session.error).toBe('');
      } else if (invalidation === 'remote') {
        await expect.poll(() => session.editor !== editor).toBe(true);
        expect(editor.isDestroyed).toBe(true);
        expect(session.selection.anchor).toBe(selection.anchor);
        expect(session.selection.head).toBe(selection.head);
        expect(session.editor!.state.selection.$head.parent.textContent).not.toBe(
          'REMOTE before café',
        );
        expect(session.error).toBe('');
      } else {
        await expect.poll(() => session.error).toContain('Stale');
        expect(session.projection).toBe(projected);
        expect(session.selection).toEqual(selection);
      }
      if (invalidation !== 'remote') expect(session.editor).toBe(editor);
      expect(backing.region(0)).toBe((invalidation === 'remote' ? 'REMOTE ' : '') + source);
      expect(session.snapshot().maxDOMBoundaryIntentBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
    }
  });

it('keeps transient pointer boundaries in place and resolves a released boundary', async () => {
  const source =
    'before\n\n| Header | R |\n| --- | --- |\n' +
    Array.from({ length: 800 }, (_, i) => `| row${i} | value |\n`).join('') +
    '\nafter';
  const host = document.createElement('div');
  document.body.append(host);
  const backing = new SourceJournal(() => source, 1),
    session = new DocumentSession(backing, host);
  try {
    await session.seek(source.length - 1);
    const editor = session.editor!,
      projection = session.projection!;
    const part = projection.mixed!.parts.find((p) => p.projection.table)!;
    const head = part.pm + 1;
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
      pos: editor.state.doc.content.size - 1,
      inside: -1,
    });
    host.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    editor.view.props.createSelectionBetween!(
      editor.view,
      editor.state.doc.resolve(head),
      editor.state.doc.resolve(head),
    );
    await Promise.resolve();
    expect(session.projection).toBe(projection);
    expect(session.snapshot().maxDOMBoundaryIntentBytes).toBe(0);
    // jsdom has no text Range geometry; Chromium proves the actual scroll/caret path.
    editor.view.setProps({ handleScrollToSelection: () => true });
    const point = editor.view.domAtPos(head);
    document.getSelection()!.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await expect
      .poll(() => session.editor!.state.selection.$head.parent.textContent)
      .toBe('Header');
    expect(session.editor).toBe(editor);
    expect(session.error).toBe('');
    expect(backing.region(0)).toBe(source);
  } finally {
    session.destroy();
    host.remove();
    vi.restoreAllMocks();
  }
});
