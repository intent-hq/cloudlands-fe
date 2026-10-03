import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { ReplaceStep } from '@tiptap/pm/transform';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const source =
  'before KEEP\n\n- sibling END\n\n```text\n' +
  Array.from({ length: 900 }, (_, i) => `line${i} café 🌍`).join('\n') +
  '\n```\n\nafter KEEP';
const owner = source.indexOf('```text');
function key(editor: Editor, value: string) {
  return editor.view.someProp('handleKeyDown', (f) =>
    f(editor.view, new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })),
  );
}
for (const operation of ['Backspace', 'Delete'] as const)
  it(`continues full native ${operation} list newline edits through eviction and history`, async () => {
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div'));
    const native = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(source),
        editable: true,
        useMarkdown: true,
        enableComments: true,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    try {
      await session.seek(owner);
      for (const editor of [native, session.editor!]) {
        const edge =
          editor.state.doc.firstChild!.nodeSize +
          (editor === native ? editor.state.doc.child(1).nodeSize : 0);
        // Mounted boundary contains only the last list and leading code fragment.
        const boundary = editor === native ? edge : editor.state.doc.firstChild!.nodeSize;
        editor.commands.setTextSelection(
          TextSelection.near(
            editor.state.doc.resolve(boundary + (operation === 'Backspace' ? 1 : -1)),
            operation === 'Backspace' ? 1 : -1,
          ).head,
        );
        key(editor, operation);
      }
      expect(session.error).toBe('');
      const afterJoin = backing.region(0),
        target = afterJoin.indexOf('line450');
      const old = session.editor!;
      await session.seek(target);
      expect(old.isDestroyed).toBe(true);
      const projection = session.projection!,
        mounted = session.editor!;
      const liveParagraph = native.state.doc.child(1).lastChild!.firstChild!;
      const sourceBody = afterJoin.indexOf('sibling END');
      const from = projection.start - sourceBody,
        to = projection.start + projection.source.length - sourceBody;
      const actual = mounted.state.doc.firstChild!.lastChild!.firstChild!;
      expect(actual.toJSON()).toEqual(
        liveParagraph.cut(Math.max(0, from), Math.min(to, liveParagraph.content.size)).toJSON(),
      );
      expect({
        start: projection.start,
        end: projection.start + projection.source.length,
        mapped: projection.sourceAt(projection.pmAt(target + 4)),
      }).toMatchObject({ mapped: target + 4 });
      mounted.commands.setTextSelection(projection.pmAt(target + 4));
      mounted.commands.insertContent('EDIT');
      expect(session.error).toBe('');
      const edited = afterJoin.slice(0, target + 4) + 'EDIT' + afterJoin.slice(target + 4);
      expect(backing.region(0)).toBe(edited);
      expect(edited.startsWith('before KEEP\n\n')).toBe(true);
      expect(edited.endsWith('\n\nafter KEEP')).toBe(true);
      session.save();
      await session.seek(target);
      expect(mounted.isDestroyed).toBe(true);
      await session.history();
      expect(backing.region(0)).toBe(afterJoin);
      await session.history();
      expect(backing.region(0)).toBe(source);
      await session.history(true);
      expect(backing.region(0)).toBe(afterJoin);
      await session.history(true);
      expect(backing.region(0)).toBe(edited);
      // Backspace materializes hardBreak leaves; Delete retains one newline text leaf.
      expect(backing.stats.maxBackingMixedCommandNodes).toBeGreaterThan(
        operation === 'Backspace' ? 256 : 1,
      );
      expect(backing.stats.maxBackingMixedCommandBytes).toBeGreaterThan(source.length);
      expect(backing.stats.maxMixedCommandRequestBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().mounted).toBe(1);
    } finally {
      session.destroy();
      native.destroy();
    }
  });
for (const mode of ['source-failure', 'history-failure', 'stale', 'oversized'] as const)
  it(`rejects full mixed ${mode} without changing source or the mounted view`, async () => {
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div'));
    try {
      await session.seek(owner);
      const editor = session.editor!,
        edge = editor.state.doc.firstChild!.nodeSize;
      const left = TextSelection.near(editor.state.doc.resolve(edge - 1), -1).head,
        right = TextSelection.near(editor.state.doc.resolve(edge + 1), 1).head;
      editor.commands.setTextSelection({ from: left - 1, to: right + 1 });
      if (mode === 'source-failure') {
        const stage = backing.stage.bind(backing);
        vi.spyOn(backing, 'stage').mockImplementation((change, history) => {
          stage(change, history);
          throw new Error('injected source failure');
        });
      }
      if (mode === 'history-failure')
        vi.spyOn(backing, 'recordEdit').mockImplementation(() => {
          throw new Error('injected history failure');
        });
      if (mode === 'stale')
        backing.apply({ from: source.length, to: source.length, insert: ' REMOTE' });
      const before = {
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        metadata: backing.stats.backingParagraphSeamBytes,
      };
      editor.commands.insertContent(mode === 'oversized' ? 'Z'.repeat(5000) : 'EDIT');
      expect(session.error).toContain(
        mode === 'stale' ? 'Stale' : mode === 'oversized' ? 'budget' : 'injected',
      );
      expect({
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: editor.getJSON(),
        selection: editor.state.selection.toJSON(),
        metadata: backing.stats.backingParagraphSeamBytes,
      }).toEqual(before);
      expect(session.editor).toBe(editor);
    } finally {
      session.destroy();
    }
  });

it('retains the native code suffix after the recorded DOM first-line replacement shape', async () => {
  const backing = new SourceJournal(() => source, 1),
    session = new DocumentSession(backing, document.createElement('div'));
  const oracle = new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: await processMarkdownToHTML(source),
      editable: true,
      useMarkdown: true,
      enableComments: true,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
  try {
    await session.seek(owner);
    for (const editor of [oracle, session.editor!]) {
      let listAt = 0,
        codeAt = 0;
      editor.state.doc.forEach((node, at) => {
        if (node.type.name === 'bulletList') listAt = at;
        if (node.type.name === 'codeBlock') codeAt = at;
      });
      const list = editor.state.doc.nodeAt(listAt)!,
        code = editor.state.doc.nodeAt(codeAt)!;
      const from = listAt + list.nodeSize - 4,
        firstLine = code.textContent.split('\n')[0];
      editor.commands.setTextSelection({ from, to: codeAt + 2 });
      const slice = new Slice(
        Fragment.fromArray([
          editor.schema.nodes.bulletList.create(
            null,
            editor.schema.nodes.listItem.create(
              null,
              editor.schema.nodes.paragraph.create(
                null,
                editor.schema.text('MOVE' + firstLine.slice(1)),
              ),
            ),
          ),
          editor.schema.nodes.codeBlock.create(code.attrs),
        ]),
        3,
        1,
      );
      const tr = editor.state.tr.step(
        new ReplaceStep(from, codeAt + 1 + firstLine.length + 1, slice),
      );
      tr.setSelection(TextSelection.create(tr.doc, from + 4));
      editor.view.dispatch(tr);
    }
    expect(session.error).toBe('');
    const moved = backing.region(0);
    expect(moved).toContain('sibling ENMOVEine0 café 🌍');
    expect(moved).toContain('```text\nline1 café 🌍');
    const target = moved.indexOf('line450');
    await session.seek(target);
    expect(session.editor!.state.doc.firstChild!.type.name).toBe('codeBlock');
    expect(session.editor!.state.doc.textContent).toContain('line450');
    expect(oracle.state.doc.child(2).textContent.startsWith('line1')).toBe(true);
    session.editor!.commands.setTextSelection(session.projection!.pmAt(target + 4));
    session.editor!.commands.insertContent('EDIT');
    expect(session.error).toBe('');
    expect(backing.region(0)).toBe(moved.slice(0, target + 4) + 'EDIT' + moved.slice(target + 4));
    await session.history();
    expect(backing.region(0)).toBe(moved);
    await session.history();
    expect(backing.region(0)).toBe(source);
  } finally {
    session.destroy();
    oracle.destroy();
  }
});
