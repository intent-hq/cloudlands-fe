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
const opening = '<!--anchor:cmt-cross:start-->',
  closing = '<!--anchor:cmt-cross:end-->';
const source =
  'before ' +
  opening +
  'café 🌍\n\n- parent\n  - child\n\n```text\nliteral café 🌍\n```\n\n| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| row${i} | repeated${i === 799 ? closing : ''} |\n`).join(
    '',
  ) +
  '\nafter';
const native = async (value: string) => {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: await processMarkdownToHTML(value, { preserveAnchors: true }),
    editable: true,
    useMarkdown: true,
    enableComments: false,
    enableMentions: false,
    onUpdate: () => {},
  });
  return new Editor({ ...config, extensions: [...config.extensions!, CommentAnchor] });
};
for (const edge of ['start', 'end'] as const)
  it(`preserves cross-construct marker ${edge} orphaning, remote mapping and dirty drafts`, async () => {
    const backing = new SourceJournal(() => source, 1);
    backing.anchors = [];
    backing.registerComment('cmt-cross');
    backing.stageCommentDraft('cmt-cross', 0, 0, 'unsent café 🌍');
    const adapter = new Proxy(backing, {
      get(t, k) {
        if (k === 'anchors') throw new Error('Whole annotation map read');
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const session = new DocumentSession(adapter, document.createElement('div')),
      oracle = await native(source);
    try {
      await session.seek(edge === 'start' ? 0 : source.length - 1);
      await session.loadAnnotations();
      expect(session.annotationPage!.items).toMatchObject([
        {
          id: 'cmt-cross',
          from: source.indexOf(opening) + opening.length,
          to: source.indexOf(closing),
        },
      ]);
      if (edge === 'end')
        expect(session.annotationPage!.items[0].from).toBeLessThan(session.projection!.start);
      for (const editor of [oracle, session.editor!]) {
        let at = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'commentAnchor' && node.attrs.id === `cmt-cross:${edge}`) at = pos;
        });
        expect(at).toBeGreaterThan(-1);
        editor.view.dispatch(editor.state.tr.delete(at, at + 1));
      }
      expect(session.error).toBe('');
      const token = edge === 'start' ? opening : closing;
      expect(backing.region(0)).toBe(source.replace(token, ''));
      const canonical = await native(backing.region(0));
      try {
        expect(canonical.getJSON()).toEqual(oracle.getJSON());
      } finally {
        canonical.destroy();
      }
      await session.loadAnnotations();
      expect(session.annotationPage!.items).toEqual([]);
      expect(backing.commentDraftPage('cmt-cross')!.text).toBe('unsent café 🌍');
      const old = session.editor!;
      await session.seek(edge === 'start' ? backing.length - 1 : 0);
      expect(old.isDestroyed).toBe(true);
      await session.history();
      expect(backing.region(0)).toBe(source);
      await session.loadAnnotations();
      expect(session.annotationPage!.items).toMatchObject([{ id: 'cmt-cross', alive: true }]);
      await session.history(true);
      expect(backing.region(0)).toBe(source.replace(token, ''));
      await session.history();
      session.remote({ from: 0, to: 0, insert: 'remote ' });
      await session.seek(edge === 'start' ? 0 : backing.length - 1);
      await session.loadAnnotations();
      expect(session.annotationPage!.items).toMatchObject([
        {
          id: 'cmt-cross',
          from: source.indexOf(opening) + opening.length + 7,
          to: source.indexOf(closing) + 7,
        },
      ]);
      backing.commentRevision++;
      await session.loadAnnotations();
      expect(() => backing.publishCommentDraft('cmt-cross', backing.commentRevision)).toThrow(
        'Comment draft conflict',
      );
      expect(backing.commentDraftPage('cmt-cross')!.text).toBe('unsent café 🌍');
      const stats = session.snapshot();
      expect(stats.maxSourceRead).toBeLessThanOrEqual(4096);
      expect(stats.maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
      expect(stats.cachePages).toBeLessThanOrEqual(4);
      expect(stats.retainedEditorStates).toBe(0);
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });
