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

for (const literal of [false, true]) {
  it(`keeps canonical marker identity ${literal ? 'literal inside fenced code' : 'inside native table cells'}`, async () => {
    const marked = '<!--anchor:cmt-cross:start-->café 🌍 repeated<!--anchor:cmt-cross:end-->';
    const source = literal
      ? '```text\n' + marked + '\n```\n\nfollowing'
      : '| H |\n| --- |\n| ' + marked + ' |';
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
    const service = new SourceJournal(() => source, 1);
    service.anchors = [];
    service.registerComment('cmt-cross');
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.show(0);
      native.commands.setTextSelection(1);
      session.editor!.commands.setTextSelection(1);
      expect(session.error).toBe('');
      let count = 0;
      native.state.doc.descendants((node) => {
        if (node.type.name === 'commentAnchor') count++;
      });
      expect(count).toBe(literal ? 0 : 2);
      expect(session.editor!.getJSON()).toEqual(native.getJSON());
      expect(session.annotationPage!.items.map((a) => a.id)).toEqual(literal ? [] : ['cmt-cross']);
      if (!literal) {
        let at = -1;
        native.state.doc.descendants((node, pos) => {
          if (node.isText && node.text!.startsWith('café')) at = pos + 2;
        });
        native.commands.setTextSelection(at);
        session.editor!.commands.setTextSelection(
          session.projection!.pmAt(source.indexOf('café') + 2),
        );
        native.view.dispatch(native.state.tr.insertText('X'));
        session.editor!.view.dispatch(session.editor!.state.tr.insertText('X'));
        const edited = source.replace('café', 'caXfé');
        expect(session.error).toBe('');
        expect(service.region(0)).toBe(edited);
        const fresh = new Editor({
          ...config,
          extensions: [...config.extensions!, CommentAnchor],
          element: document.createElement('div'),
          content: await processMarkdownToHTML(edited, { preserveAnchors: true }),
        });
        try {
          fresh.commands.setTextSelection(native.state.selection.head);
          expect(fresh.getJSON()).toEqual(native.getJSON());
        } finally {
          fresh.destroy();
        }
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        expect(session.editor!.state.selection.toJSON()).toEqual(native.state.selection.toJSON());
        const old = session.editor!;
        session.save();
        await session.seek(service.length - 3);
        expect(old.isDestroyed).toBe(true);
        native.commands.undo();
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        native.commands.redo();
        await session.history(true);
        expect(service.region(0)).toBe(edited);
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        service.stageCommentDraft('cmt-cross', 0, 0, 'unsent table draft');
        let first = -1,
          last = -1;
        native.state.doc.descendants((node, pos) => {
          if (node.type.name === 'commentAnchor') {
            if (first < 0) first = pos;
            last = pos + node.nodeSize;
          }
        });
        native.commands.setTextSelection({ from: first, to: last });
        session.editor!.commands.setTextSelection({
          from: session.projection!.pmAt(edited.indexOf('<!--anchor:')),
          to: session.projection!.pmAt(edited.indexOf(':end-->') + ':end-->'.length),
        });
        native.commands.deleteSelection();
        session.editor!.commands.deleteSelection();
        expect(session.error).toBe('');
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        expect(session.annotationPage!.items).toEqual([]);
        expect(service.commentDraftPage('cmt-cross')!.text).toBe('unsent table draft');
        native.commands.undo();
        await session.history();
        expect(session.editor!.getJSON()).toEqual(native.getJSON());
        expect(session.annotationPage!.items.map((a) => a.id)).toEqual(['cmt-cross']);
      }
    } finally {
      session.destroy();
      native.destroy();
    }
  });
}

it('retains canonical table marker overlap across evicted cell fragments and stale comment pages', async () => {
  const opening = '<!--anchor:cmt-cross:start-->',
    closing = '<!--anchor:cmt-cross:end-->';
  const body = opening + 'repeated café 🌍 '.repeat(1400) + closing;
  const source = '| H |\n| --- |\n| ' + body + ' |';
  const service = new SourceJournal(() => source, 1);
  service.anchors = [];
  service.registerComment('cmt-cross');
  service.stageCommentDraft('cmt-cross', 0, 0, 'fragment draft');
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    const middle = source.indexOf('café', Math.floor(source.length / 2));
    await session.seek(middle);
    expect(session.error).toBe('');
    const cell = session.projection!.table!.window.cells.find((c) => c.partial)!;
    expect(cell).toBeDefined();
    expect(cell.first).toBeGreaterThan(source.indexOf(opening) + opening.length);
    expect(cell.last).toBeLessThan(source.indexOf(closing));
    expect(session.annotationPage!.items.map((a) => a.id)).toEqual(['cmt-cross']);
    expect(
      session.editor!.view.dom.querySelector('[data-proof-comment="cmt-cross"]'),
    ).not.toBeNull();
    session.editor!.commands.setTextSelection(session.projection!.pmAt(middle + 2));
    session.editor!.commands.insertContent('X');
    const edited = source.slice(0, middle + 2) + 'X' + source.slice(middle + 2);
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(edited);
    const old = session.editor!;
    await session.seek(edited.indexOf(closing));
    expect(old.isDestroyed).toBe(true);
    expect(session.error).toBe('');
    let atoms = 0;
    session.editor!.state.doc.descendants((node) => {
      if (node.type.name === 'commentAnchor') {
        atoms++;
        expect(node.nodeSize).toBe(1);
        expect(node.attrs.commentId).toBe('cmt-cross');
      }
    });
    expect(atoms).toBe(1);
    let release!: () => void;
    session.delayAnnotationResponse = () => new Promise<void>((resolve) => (release = resolve));
    const stale = session.loadAnnotations();
    session.delayAnnotationResponse = undefined;
    service.commentRevision++;
    const current = session.loadAnnotations();
    release();
    expect(await stale).toBe(false);
    expect(await current).toBe(true);
    expect(session.annotationPage!.commentRevision).toBe(service.commentRevision);
    await session.history();
    expect(service.region(0)).toBe(source);
    expect(session.annotationPage!.items.map((a) => a.id)).toEqual(['cmt-cross']);
    await session.history(true);
    expect(service.region(0)).toBe(edited);
    expect(service.commentDraftPage('cmt-cross')!.text).toBe('fragment draft');
    const stats = session.snapshot();
    expect(stats.cachePages).toBeLessThanOrEqual(4);
    expect(stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(stats.pmNodes).toBeLessThanOrEqual(4096);
    expect(stats.maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
    expect(stats.retainedEditorStates).toBe(0);
  } finally {
    session.destroy();
  }
});
