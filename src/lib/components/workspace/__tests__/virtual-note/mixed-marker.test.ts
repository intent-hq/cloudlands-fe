import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

for (const source of [
  'before <!--anchor:cmt-cross:start-->café 🌍 repeated<!--anchor:cmt-cross:end--> after',
  'before **<!--anchor:cmt-cross:start-->café 🌍 repeated<!--anchor:cmt-cross:end-->** after',
]) {
  it(`preserves native marker atoms and exact spelling when editing ${source.includes('**') ? 'marked' : 'plain'} text`, async () => {
    const config = createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    });
    const native = new Editor({
      ...config,
      extensions: [...config.extensions!, CommentAnchor],
      content: await processMarkdownToHTML(source, { preserveAnchors: true }),
    });
    const backing = new SourceJournal(() => source, 1);
    const session = new DocumentSession(backing, document.createElement('div'));
    try {
      await session.show(0);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      let position = -1;
      native.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.startsWith('café')) position = pos + 2;
      });
      native.commands.setTextSelection(position);
      session.editor!.commands.setTextSelection(
        session.projection!.pmAt(source.indexOf('café') + 2),
      );
      native.commands.insertContent('X');
      session.editor!.commands.insertContent('X');
      expect(session.error).toBe('');
      expect(backing.region(0)).toBe(source.replace('café', 'caXfé'));
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      await session.history();
      expect(backing.region(0)).toBe(source);
    } finally {
      session.destroy();
      native.destroy();
    }
  });
}

it('orphaning and undo restore marker identity without losing a dirty comment draft', async () => {
  const opening = '<!--anchor:cmt-cross:start-->',
    closing = '<!--anchor:cmt-cross:end-->';
  const source = 'before ' + opening + 'café 🌍 repeated' + closing + ' after';
  const backing = new SourceJournal(() => source, 1);
  backing.anchors = [];
  backing.registerComment('cmt-cross');
  backing.stageCommentDraft('cmt-cross', 0, 0, 'unsent café 🌍');
  const session = new DocumentSession(backing, document.createElement('div'));
  try {
    await session.show(0);
    const from = source.indexOf(opening),
      to = source.indexOf(closing) + closing.length;
    session.editor!.commands.setTextSelection({
      from: session.projection!.pmAt(from),
      to: session.projection!.pmAt(to),
    });
    session.editor!.commands.deleteSelection();
    expect(session.error).toBe('');
    expect(backing.region(0)).toBe('before  after');
    expect(session.annotationPage!.items).toEqual([]);
    expect(backing.commentDraftPage('cmt-cross')!.text).toBe('unsent café 🌍');
    await session.history();
    expect(backing.region(0)).toBe(source);
    expect(session.annotationPage!.items).toMatchObject([{ id: 'cmt-cross', alive: true }]);
    backing.commentRevision++;
    await session.loadAnnotations();
    expect(() => backing.publishCommentDraft('cmt-cross', backing.commentRevision)).toThrow(
      'Comment draft conflict',
    );
    expect(backing.commentDraftPage('cmt-cross')!.text).toBe('unsent café 🌍');
    await session.history(true);
    expect(session.annotationPage!.items).toEqual([]);
    await session.history();
    session.remote({ from: 0, to: 0, insert: 'remote ' });
    await session.seek(session.selection.head);
    expect(session.annotationPage!.items).toMatchObject([
      { id: 'cmt-cross', from: from + opening.length + 7 },
    ]);
    expect(backing.commentDraftPage('cmt-cross')!.text).toBe('unsent café 🌍');
  } finally {
    session.destroy();
  }
});
