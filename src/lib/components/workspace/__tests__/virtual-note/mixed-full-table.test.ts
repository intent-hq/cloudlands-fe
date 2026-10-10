import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Slice, Fragment } from '@tiptap/pm/model';
import { ReplaceStep } from '@tiptap/pm/transform';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const table =
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| cell${i} | value |`).join('\n');
const para =
  'following START ' +
  Array.from({ length: 900 }, (_, i) => `segment${i} café 🌍`).join(' ') +
  ' following END';
const source = 'before KEEP\n\n' + table + '\n\n' + para + '\n\nafter KEEP';
async function native(value: string) {
  return new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: await processMarkdownToHTML(value),
      editable: true,
      useMarkdown: true,
      enableComments: true,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
}
function select(e: Editor, backward: boolean) {
  let edge = 0;
  e.state.doc.forEach((node, at) => {
    if (node.type.name === 'table') edge = at + node.nodeSize;
  });
  const left = TextSelection.near(e.state.doc.resolve(edge - 1), -1).head - 1,
    right = TextSelection.near(e.state.doc.resolve(edge + 1), 1).head + 1;
  e.commands.setTextSelection(backward ? { from: right, to: left } : { from: left, to: right });
}
for (const backward of [false, true])
  it(`moves the full following paragraph into a table with ${backward ? 'backward' : 'forward'} selection`, async () => {
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div')),
      oracle = await native(source);
    try {
      await session.seek(source.indexOf('following START'));
      select(oracle, backward);
      select(session.editor!, backward);
      oracle.commands.insertContent('MOVE');
      session.editor!.commands.insertContent('MOVE');
      expect(session.error).toBe('');
      const moved = backing.region(0),
        fresh = await native(moved),
        canonical = await native(processHTMLToMarkdown(oracle.getHTML()));
      try {
        expect(fresh.getJSON()).toEqual(canonical.getJSON());
      } finally {
        fresh.destroy();
        canonical.destroy();
      }
      expect(moved.startsWith(source.slice(0, source.indexOf('| cell799')))).toBe(true);
      expect(moved.endsWith('\n\nafter KEEP')).toBe(true);
      const target = moved.indexOf('segment450'),
        old = session.editor!;
      await session.seek(target);
      expect(old.isDestroyed).toBe(true);
      const active = session.editor!;
      expect(session.projection!.sourceAt(session.projection!.pmAt(target + 7))).toBe(target + 7);
      active.commands.setTextSelection(session.projection!.pmAt(target + 7));
      active.commands.insertContent('EDIT');
      expect(session.error).toBe('');
      const edited = moved.slice(0, target + 7) + 'EDIT' + moved.slice(target + 7);
      expect(backing.region(0)).toBe(edited);
      session.save();
      await session.seek(target);
      expect(active.isDestroyed).toBe(true);
      await session.history();
      expect(backing.region(0)).toBe(moved);
      await session.history();
      expect(backing.region(0)).toBe(source);
      await session.history(true);
      await session.history(true);
      expect(backing.region(0)).toBe(edited);
      expect(session.snapshot().mounted).toBe(1);
      expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });
for (const failure of ['history', 'stale'] as const)
  it(`rejects full table neighbor ${failure} without partial mutation`, async () => {
    const backing = new SourceJournal(() => source, 1),
      session = new DocumentSession(backing, document.createElement('div'));
    try {
      await session.seek(source.indexOf('following START'));
      select(session.editor!, false);
      if (failure === 'history')
        vi.spyOn(backing, 'recordEdit').mockImplementation(() => {
          throw new Error('injected history failure');
        });
      else backing.apply({ from: source.length, to: source.length, insert: ' REMOTE' });
      const before = {
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: session.editor!.getJSON(),
        metadata: backing.stats.backingTableMetadataBytes,
      };
      session.editor!.commands.insertContent('MOVE');
      expect(session.error).toContain(failure === 'history' ? 'injected' : 'Stale');
      expect({
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        doc: session.editor!.getJSON(),
        metadata: backing.stats.backingTableMetadataBytes,
      }).toEqual(before);
    } finally {
      session.destroy();
    }
  });

it.each([false, true, 'overlaps'] as const)(
  'preserves the recorded nested DOM replacement and full following suffix marked=%s',
  async (marked) => {
    const commentIds =
      marked === 'overlaps'
        ? Array.from({ length: 12 }, (_, i) => `nested-comment-${i}`)
        : ['nested-comment'];
    const input = marked
      ? source.replace(
          'segment450',
          commentIds.map((id) => `<!--anchor:${id}:start-->`).join('') +
            'segment450' +
            [...commentIds]
              .reverse()
              .map((id) => `<!--anchor:${id}:end-->`)
              .join(''),
        )
      : source;
    const backing = new SourceJournal(() => input, 1),
      adapter = new Proxy(backing, {
        get(target, key) {
          if (key === 'anchors') throw new Error('Whole annotation map read');
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
      session = new DocumentSession(adapter, document.createElement('div')),
      oracle = await native(input);
    try {
      if (marked) {
        backing.anchors = [];
        for (const id of commentIds) backing.registerComment(id);
        backing.stageCommentDraft(commentIds[0], 0, 0, 'unsent alias draft');
      }
      await session.seek(input.indexOf('following START'));
      for (const e of [oracle, session.editor!]) {
        select(e, false);
        const selected = e.state.selection,
          para = selected.$to.parent;
        const suffix = para.content.cut(selected.$to.parentOffset);
        const nested = e.schema.nodes.table.create(
          null,
          e.schema.nodes.tableRow.create(
            null,
            e.schema.nodes.tableCell.create(
              null,
              e.schema.nodes.paragraph.create(
                null,
                Fragment.from(e.schema.text('MOVE')).append(suffix),
              ),
            ),
          ),
        );
        const slice = new Slice(
          Fragment.from(
            e.schema.nodes.table.create(
              null,
              e.schema.nodes.tableRow.create(
                null,
                e.schema.nodes.tableCell.create(null, [e.schema.nodes.paragraph.create(), nested]),
              ),
            ),
          ),
          4,
          0,
        );
        const tr = e.state.tr.step(new ReplaceStep(selected.from, selected.$to.after(), slice));
        const from = selected.from;
        tr.setSelection(TextSelection.create(tr.doc, from + 11));
        e.view.dispatch(tr);
      }
      expect(session.error).toBe('');
      const moved = backing.region(0);
      expect(moved.startsWith(input.slice(0, input.indexOf('| cell799')))).toBe(true);
      expect(moved.endsWith('\n\nafter KEEP')).toBe(true);
      const fresh = await native(moved),
        canonical = await native(processHTMLToMarkdown(oracle.getHTML()));
      try {
        const count = (e: Editor, type: string) => {
          let n = 0;
          e.state.doc.descendants((node) => {
            if (node.type.name === type) n++;
          });
          return n;
        };
        console.log(
          'nested-canonical-ownership',
          JSON.stringify({
            liveTables: count(oracle, 'table'),
            liveRows: count(oracle, 'tableRow'),
            freshRows: count(fresh, 'tableRow'),
            canonicalRows: count(canonical, 'tableRow'),
            sourceCopies: moved.split('segment450').length - 1,
            canonicalCopies: processHTMLToMarkdown(oracle.getHTML()).split('segment450').length - 1,
          }),
        );
        expect(fresh.getJSON()).toEqual(canonical.getJSON());
      } finally {
        fresh.destroy();
        canonical.destroy();
      }
      const target = moved.indexOf('segment450') + 7;
      await session.seek(target);
      expect(session.projection!.sourceAt(session.projection!.pmAt(target))).toBe(target);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(target));
      expect(session.selection.table?.head.path?.length).toBeGreaterThan(1);
      if (marked) {
        const ids: string[] = [];
        session.editor!.state.doc.descendants((node, at) => {
          if (node.type.name !== 'commentAnchor') return;
          ids.push(node.attrs.id);
          const from = session.projection!.sourceAt(at, 1),
            to = session.projection!.sourceAt(at + 1, -1);
          expect(backing.region(0).slice(from, to)).toBe(`<!--anchor:${node.attrs.id}-->`);
        });
        expect(ids).toEqual([
          ...commentIds.map((id) => `${id}:start`),
          ...[...commentIds].reverse().map((id) => `${id}:end`),
        ]);
        await session.loadAnnotations();
        const seen: string[] = [];
        do {
          seen.push(...session.annotationPage!.items.map((a) => a.id));
          for (const a of session.annotationPage!.items) {
            expect(a.alive).toBe(true);
            expect(
              session.editor!.view.dom.querySelector(`[data-proof-comment="${a.id}"]`)?.textContent,
            ).toBe('segment450');
          }
          const next = session.annotationPage!.next;
          if (!next) break;
          await session.loadAnnotations(next);
        } while (true);
        expect(seen).toEqual(commentIds);
        expect(backing.commentDraftPage(commentIds[0])!.text).toBe('unsent alias draft');
      }
      let nativeTarget = 0;
      oracle.state.doc.descendants((node, at) => {
        if (node.isText && node.text?.includes('segment450'))
          nativeTarget = at + node.text.indexOf('segment450') + 7;
      });
      oracle.commands.setTextSelection(nativeTarget);
      oracle.commands.insertContent('EDIT');
      session.editor!.commands.insertContent('EDIT');
      expect(session.error).toBe('');
      expect(backing.region(0)).toContain('segmentEDIT450');
      expect(session.selection.head).toBe(backing.region(0).indexOf('segmentEDIT450') + 11);
      if (marked) {
        await session.loadAnnotations();
        expect(session.annotationPage!.items.map((a) => a.id)).toEqual(commentIds.slice(0, 8));
        expect(
          session.editor!.view.dom.querySelector(`[data-proof-comment="${commentIds[0]}"]`)
            ?.textContent,
        ).toBe('segmentEDIT450');
      }
      const continued = await native(backing.region(0)),
        expected = await native(processHTMLToMarkdown(oracle.getHTML()));
      try {
        expect(continued.getJSON()).toEqual(expected.getJSON());
      } finally {
        continued.destroy();
        expected.destroy();
      }
      const accepted = {
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        metadata: backing.stats.backingTableMetadataBytes,
      };
      const failure = vi.spyOn(backing, 'recordEdit').mockImplementation(() => {
        throw new Error('injected alias history failure');
      });
      session.editor!.commands.insertContent('FAIL');
      expect(session.error).toContain('injected alias history failure');
      expect({
        source: backing.region(0),
        revision: backing.revision,
        depth: backing.depth,
        metadata: backing.stats.backingTableMetadataBytes,
      }).toEqual(accepted);
      failure.mockRestore();
      await session.history();
      expect(backing.region(0)).toBe(moved);
      await session.history();
      expect(backing.region(0)).toBe(input);
      await session.history(true);
      await session.history(true);
      expect(backing.region(0)).toBe(accepted.source);
      for (const occurrence of [...accepted.source.matchAll(/segmentEDIT450/g)]) {
        const before = {
          source: backing.region(0),
          revision: backing.revision,
          depth: backing.depth,
        };
        expect(() =>
          session.remote({ from: occurrence.index! + 1, to: occurrence.index! + 2, insert: 'X' }),
        ).toThrow(/Conflict/);
        expect({
          source: backing.region(0),
          revision: backing.revision,
          depth: backing.depth,
        }).toEqual(before);
      }
      session.remote({ from: 0, to: 0, insert: 'REMOTE\n\n' });
      expect(backing.region(0)).toBe('REMOTE\n\n' + accepted.source);
      if (marked) {
        await session.seek(backing.region(0).indexOf('segmentEDIT450') + 7);
        await session.loadAnnotations();
        const beforeDelete = backing.region(0);
        const beforeDeleteSelection = structuredClone(session.selection);
        let atom = -1;
        session.editor!.state.doc.descendants((node, at) => {
          if (node.type.name === 'commentAnchor' && node.attrs.id === `${commentIds[0]}:start`)
            atom = at;
        });
        expect(atom).toBeGreaterThan(-1);
        session.editor!.view.dispatch(
          session.editor!.state.tr.delete(atom, atom + 1).setTime(Date.now() + 1000),
        );
        expect(session.error).toBe('');
        expect(session.selection.anchor).toBe(beforeDeleteSelection.anchor);
        expect(session.selection.head).toBe(beforeDeleteSelection.head);
        expect(backing.region(0)).not.toContain(`<!--anchor:${commentIds[0]}:start-->`);
        let nativeAtom = -1;
        oracle.state.doc.descendants((node, at) => {
          if (node.type.name === 'commentAnchor' && node.attrs.id === `${commentIds[0]}:start`)
            nativeAtom = at;
        });
        expect(nativeAtom).toBeGreaterThan(-1);
        oracle.view.dispatch(oracle.state.tr.delete(nativeAtom, nativeAtom + 1));
        const nativeDeleted = processHTMLToMarkdown(oracle.getHTML());
        expect(backing.region(0).slice(backing.region(0).indexOf('| cell799')).trimEnd()).toBe(
          nativeDeleted.slice(nativeDeleted.indexOf('| cell799')).trimEnd(),
        );
        await session.loadAnnotations();
        expect(session.annotationPage!.items.some((a) => a.id === commentIds[0])).toBe(false);
        expect(backing.commentDraftPage(commentIds[0])!.text).toBe('unsent alias draft');
        await session.history();
        expect(backing.region(0)).toBe(beforeDelete);
        await session.loadAnnotations();
        expect(session.annotationPage!.items.some((a) => a.id === commentIds[0])).toBe(true);
      }
      if (marked === 'overlaps') {
        for (const epoch of ['generation', 'commentRevision', 'revision'] as const) {
          await session.loadAnnotations();
          const cursor = session.annotationPage!.next;
          expect(cursor).toBeDefined();
          let release!: () => void;
          session.delayAnnotationResponse = () =>
            new Promise<void>((resolve) => {
              release = resolve;
            });
          const old = session.loadAnnotations();
          session.delayAnnotationResponse = undefined;
          if (epoch === 'generation')
            backing.replaceAttribution(backing.revision, backing.generation, []);
          else if (epoch === 'commentRevision') backing.commentRevision++;
          else session.remote({ from: 0, to: 0, insert: 'NEWER\n\n' });
          const current = session.loadAnnotations();
          release();
          expect(await old).toBe(false);
          expect(await current).toBe(true);
          expect(session.annotationPage![epoch]).toBe(backing[epoch]);
          expect(session.annotationPage!.items.map((a) => a.id)).toEqual(commentIds.slice(0, 8));
          await expect(session.loadAnnotations(cursor)).rejects.toThrow('Stale annotations cursor');
          expect(backing.commentDraftPage(commentIds[0])!.text).toBe('unsent alias draft');
        }
        expect(() => backing.publishCommentDraft(commentIds[0], backing.commentRevision)).toThrow(
          'Comment draft conflict',
        );
      }
      const snapshot = session.snapshot();
      expect(snapshot.mounted).toBe(1);
      expect(snapshot.cachePages).toBeLessThanOrEqual(4);
      expect(snapshot.cacheBytes).toBeLessThanOrEqual(16384);
      expect(snapshot.maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
      expect(snapshot.maxAnnotationRequestBytes).toBeLessThanOrEqual(4096);
      expect(snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(snapshot.maxTableAliasExpansionBytes).toBeLessThanOrEqual(16384);
      expect(snapshot.maxTableAliasResidentBytes).toBeLessThanOrEqual(16384);
    } finally {
      session.destroy();
      oracle.destroy();
    }
  },
);
