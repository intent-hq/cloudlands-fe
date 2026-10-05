import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state';
import { createNoteEditAuthority } from './note-edit-authority';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  moveNoteDocumentHistory,
  overlayNoteDocumentSource,
  reconcileNoteDocumentSave,
  materializeNoteDocumentAuthority,
} from './note-document-edit-session';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
  marks: { bold: {} },
});
const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
function fixture(
  raw = 'abc',
  start = 100,
  sourceLength = 1000,
  rendered = raw,
  mapping = 'identity',
) {
  const owner = {
    kind: 'boundary',
    id: 'owner',
    construct: 'paragraph',
    entryPath: 'markdown',
    sourceRange: { start, end: start + raw.length },
  } as const;
  const w = {
    scope,
    sourceRevision: 'r1',
    snapshotId: 'snap1',
    sourceLength,
    range: owner.sourceRange,
    text: raw,
    documentEnd: false,
    details: { owner: { openingSource: '', closingSource: '' } },
    mapBindings: [],
    native: {
      references: { parent: ['root'], leafParent: ['paragraph'], ownerRef: ['owner'] },
      attributes: { empty: {} },
      texts: { text: rendered },
    },
    context: [
      owner,
      {
        kind: 'nativeNode',
        id: 'root',
        nodeType: 'doc',
        nodeClass: 'container',
        parentRef: null,
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'paragraph',
        nodeType: 'paragraph',
        nodeClass: 'container',
        parentRef: 'parent',
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'leaf',
        nodeType: 'text',
        nodeClass: 'text',
        parentRef: 'leafParent',
        childIndex: 0,
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'sourceMap',
        id: 'map',
        ownerRef: 'ownerRef',
        textNodeId: 'leaf',
        sourceRange: owner.sourceRange,
        renderedRange: { start: 0, end: rendered.length },
        mapping,
        textRef: 'text',
      },
    ],
  } as unknown as NoteWindow;
  const projection = new NoteCanonicalProjection(w);
  const doc = schema.nodeFromJSON(projection.content);
  const authority = createNoteEditAuthority(w, projection, [owner], doc);
  const session = createNoteDocumentSession(scope, 'r1', sourceLength);
  session.selection = { anchor: start, head: start, anchorAffinity: 1, headAffinity: 1 };
  return { session, authority, w, projection, owner };
}

describe('document-owned edits', () => {
  it('prepares without publishing and refreshes exact maps for consecutive Unicode edits', () => {
    const { session, authority } = fixture();
    const first = prepareNoteDocumentEdit(
      session,
      EditorState.create({ doc: authority.doc })
        .tr.setSelection(TextSelection.create(authority.doc, 2))
        .insertText('😀'),
      authority,
    );
    expect(session.dirty).toEqual([]);
    expect(authority.source).toBe('abc');
    expect(first.authority.source).toBe('a😀bc');
    const second = prepareNoteDocumentEdit(
      first.state,
      EditorState.create({ doc: first.authority.doc })
        .tr.setSelection(TextSelection.create(first.authority.doc, 4))
        .insertText('!'),
      first.authority,
    );
    expect(second.splices).toEqual([{ start: 103, end: 103, text: '\\!' }]);
    expect(second.authority.source).toBe('a😀\\!bc');
    expect(second.state.selection.head).toBe(105);
    expect(() =>
      prepareNoteDocumentEdit(
        first.state,
        EditorState.create({ doc: authority.doc }).tr.insertText('x', 2),
        authority,
      ),
    ).toThrow(/stale/i);
  });

  it('reconstructs one original document through eviction, dirty reload, undo and redo', () => {
    const original = 'PREFIX::abc.......def::SUFFIX';
    const aStart = original.indexOf('abc'),
      bStart = original.indexOf('def');
    const apply = (
      source: string,
      splices: readonly { start: number; end: number; text: string }[],
    ) => {
      for (const s of [...splices].reverse())
        source = source.slice(0, s.start) + s.text + source.slice(s.end);
      return source;
    };
    const a = fixture('abc', aStart, original.length);
    const first = prepareNoteDocumentEdit(
      a.session,
      EditorState.create({ doc: a.authority.doc }).tr.insertText('X', 2),
      a.authority,
    );
    const b = fixture('def', bStart, original.length);
    const mountedB = materializeNoteDocumentAuthority(first.state, b.authority);
    expect(mountedB.start).toBe(bStart + 1);
    const second = prepareNoteDocumentEdit(
      {
        ...first.state,
        selection: {
          anchor: mountedB.start,
          head: mountedB.start,
          anchorAffinity: 1,
          headAffinity: 1,
        },
      },
      EditorState.create({ doc: mountedB.doc }).tr.insertText('Y', 2),
      mountedB,
    );
    expect(apply(original, second.state.dirty)).toBe('PREFIX::aXbc.......dYef::SUFFIX');
    expect(apply(apply(original, first.splices), second.splices)).toBe(
      apply(original, second.state.dirty),
    );
    const reloadA = materializeNoteDocumentAuthority(
      second.state,
      fixture('abc', aStart, original.length).authority,
    );
    const reloadB = materializeNoteDocumentAuthority(
      second.state,
      fixture('def', bStart, original.length).authority,
    );
    expect(reloadA.source).toBe('aXbc');
    expect(reloadB.source).toBe('dYef');
    expect(reloadB.doc.textContent).toBe('dYef');
    expect(reloadB.sourceAt(3)).toBe(bStart + 3);
    const undo = moveNoteDocumentHistory(second.state, 'undo')!;
    expect(apply(original, undo.state.dirty)).toBe('PREFIX::aXbc.......def::SUFFIX');
    expect(
      materializeNoteDocumentAuthority(
        undo.state,
        fixture('def', bStart, original.length).authority,
      ).doc.textContent,
    ).toBe('def');
    const redo = moveNoteDocumentHistory(undo.state, 'redo')!;
    expect(apply(original, redo.state.dirty)).toBe('PREFIX::aXbc.......dYef::SUFFIX');
    expect(
      materializeNoteDocumentAuthority(
        redo.state,
        fixture('def', bStart, original.length).authority,
      ).source,
    ).toBe('dYef');
    const third = prepareNoteDocumentEdit(
      {
        ...redo.state,
        selection: {
          anchor: reloadA.start,
          head: reloadA.start,
          anchorAffinity: 1,
          headAffinity: 1,
        },
      },
      EditorState.create({ doc: reloadA.doc }).tr.insertText('Q', 3),
      materializeNoteDocumentAuthority(
        redo.state,
        fixture('abc', aStart, original.length).authority,
      ),
    );
    expect(apply(original, third.state.dirty)).toBe('PREFIX::aXQbc.......dYef::SUFFIX');
  });

  it('refuses scalar splits, partial lexical tokens and visible AllSelection replacements', () => {
    const emoji = fixture('😀a');
    expect(() =>
      prepareNoteDocumentEdit(
        emoji.session,
        EditorState.create({ doc: emoji.authority.doc }).tr.delete(2, 3),
        emoji.authority,
      ),
    ).toThrow(/scalar|coverage/i);
    const entity = fixture('&NotEqualTilde;', 100, 1000, '≂̸', 'entity');
    expect(() =>
      prepareNoteDocumentEdit(
        entity.session,
        EditorState.create({ doc: entity.authority.doc }).tr.delete(1, 2),
        entity.authority,
      ),
    ).toThrow(/coverage/i);
    const all = fixture();
    const editor = EditorState.create({ doc: all.authority.doc });
    expect(() =>
      prepareNoteDocumentEdit(
        {
          ...all.session,
          selection: { anchor: 0, head: 1000, anchorAffinity: 1, headAffinity: 1 },
        },
        editor.tr.setSelection(new AllSelection(editor.doc)).insertText('x'),
        all.authority,
      ),
    ).toThrow(/selection/i);
  });

  it('rejects deletion that would create Markdown syntax while retaining navigation coverage', () => {
    const f = fixture('a# b');
    expect(f.authority.sourceAt(2)).toBe(f.projection.sourceAt(2));
    expect(f.authority.pmAt(102)).toBe(f.projection.pmAt(102));
    expect(() =>
      prepareNoteDocumentEdit(
        f.session,
        EditorState.create({ doc: f.authority.doc }).tr.delete(1, 2),
        f.authority,
      ),
    ).toThrow(/coverage/);
    expect(f.session.dirty).toEqual([]);
    const noOwner = createNoteEditAuthority(f.w, f.projection, [], f.authority.doc);
    expect(noOwner.sourceAt(3)).toBe(102);
    expect(() =>
      prepareNoteDocumentEdit(
        f.session,
        EditorState.create({ doc: noOwner.doc }).tr.insertText('X', 2),
        noOwner,
      ),
    ).toThrow(/coverage/);
  });

  it('refuses empty lexical owners, exposed whitespace and cropped lexical contexts', () => {
    const f = fixture('a');
    const owner = { ...f.owner, construct: 'strong', sourceRange: { start: 98, end: 103 } };
    f.w.details.owner = { openingSource: '**', closingSource: '**' };
    const authority = createNoteEditAuthority(f.w, f.projection, [owner], f.authority.doc);
    expect(() =>
      prepareNoteDocumentEdit(
        f.session,
        EditorState.create({ doc: authority.doc }).tr.delete(1, 2),
        authority,
      ),
    ).toThrow(/repair/);
    const spaces = fixture('a b');
    expect(() =>
      prepareNoteDocumentEdit(
        spaces.session,
        EditorState.create({ doc: spaces.authority.doc }).tr.delete(1, 2),
        spaces.authority,
      ),
    ).toThrow(/whitespace/);
    const cropped = fixture('abc');
    const partial = createNoteEditAuthority(
      cropped.w,
      cropped.projection,
      [{ ...cropped.owner, sourceRange: { start: 0, end: 1000 } }],
      cropped.authority.doc,
    );
    expect(() =>
      prepareNoteDocumentEdit(
        cropped.session,
        EditorState.create({ doc: partial.doc }).tr.insertText('x', 2),
        partial,
      ),
    ).toThrow(/coverage/);
  });

  it('serializes explicit HTML text and reloads exact raw entities without losing their selection map', () => {
    const f = fixture('abc');
    const owner = {
      ...f.owner,
      entryPath: 'html' as const,
      htmlSource: {
        provenance: 'explicit' as const,
        openingRange: null,
        closingRange: null,
        bodyRange: f.w.range,
      },
    };
    const base = createNoteEditAuthority(f.w, f.projection, [owner], f.authority.doc);
    const first = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({ doc: base.doc }).tr.insertText('<&>', 2),
      base,
    );
    expect(first.authority.source).toBe('a&lt;&amp;&gt;bc');
    const fresh = createNoteEditAuthority(f.w, f.projection, [owner], f.authority.doc);
    const reload = materializeNoteDocumentAuthority(first.state, fresh);
    expect(reload.source).toBe(first.authority.source);
    expect(reload.doc.textContent).toBe('a<&>bc');
    expect(reload.sourceAt(3)).toBe(105);
    const entity = fixture('&NotEqualTilde;', 100, 1000, '≂̸', 'entity');
    const readonly = createNoteEditAuthority(entity.w, entity.projection, [], entity.authority.doc);
    expect(readonly.pmAt(104, -1)).toBe(entity.projection.pmAt(104, -1));
    expect(readonly.pmAt(104, 1)).toBe(entity.projection.pmAt(104, 1));
  });

  it('refuses marked-boundary edits using real canonical bold marks while admitting interior typing', () => {
    const f = fixture('x**ab**y');
    const owner = {
      ...f.owner,
      id: 'bold',
      construct: 'strong',
      sourceRange: { start: 101, end: 107 },
    };
    f.w.details.bold = { openingSource: '**', closingSource: '**' };
    const native = f.w.native!;
    native.attributes.bold = [{ type: 'bold' }];
    native.texts = { pre: 'x', text: 'ab', post: 'y' };
    native.references.ownerRef = ['bold'];
    native.references.paragraphOwner = ['owner'];
    const containers = f.w.context.filter(
      (n) => n.kind === 'nativeNode' && n.nodeClass === 'container',
    );
    const leaf = (id: string, index: number, start: number, end: number, marksRef?: string) => ({
      kind: 'nativeNode' as const,
      id,
      nodeType: 'text',
      nodeClass: 'text' as const,
      parentRef: 'leafParent',
      childIndex: index,
      sourceRange: { start, end },
      ...(marksRef ? { marksRef } : {}),
    });
    const map = (
      id: string,
      leafId: string | null,
      start: number,
      end: number,
      textRef: string | null,
      ownerRef = 'paragraphOwner',
    ) => ({
      kind: 'sourceMap' as const,
      id,
      ownerRef,
      textNodeId: leafId,
      sourceRange: { start, end },
      renderedRange: { start: 0, end: textRef ? native.texts[textRef].length : 0 },
      mapping: textRef ? 'identity' : 'omitted',
      textRef,
    });
    f.w.context = [
      f.owner,
      owner,
      ...containers,
      leaf('pre', 0, 100, 101),
      leaf('leaf', 1, 103, 105, 'bold'),
      leaf('post', 2, 107, 108),
      map('pre-map', 'pre', 100, 101, 'pre'),
      map('open', null, 101, 103, null),
      map('bold-map', 'leaf', 103, 105, 'text', 'ownerRef'),
      map('close', null, 105, 107, null),
      map('post-map', 'post', 107, 108, 'post'),
    ] as NoteWindow['context'];
    const projection = new NoteCanonicalProjection(f.w),
      doc = schema.nodeFromJSON(projection.content);
    expect(doc.nodeAt(2)?.marks.map((m) => m.type.name)).toEqual(['bold']);
    const authority = createNoteEditAuthority(f.w, projection, [f.owner, owner], doc);
    const editor = EditorState.create({ doc });
    for (const [at, text] of [
      [2, 'x'],
      [4, ' '],
      [4, '!'],
    ] as const)
      expect(() =>
        prepareNoteDocumentEdit(f.session, editor.tr.insertText(text, at), authority),
      ).toThrow(/marks|boundary/);
    const edit = prepareNoteDocumentEdit(f.session, editor.tr.insertText('c', 3), authority);
    expect(edit.authority.source).toBe('x**acb**y');
    expect(edit.authority.doc.nodeAt(2)?.marks.map((m) => m.type.name)).toEqual(['bold']);
    expect(edit.authority.sourceAt(6)).toBe(109);
    expect(edit.authority.pmAt(108)).toBe(5);
  });

  it('prepares multi-step native edits against each preceding source map', () => {
    const f = fixture();
    const tr = EditorState.create({ doc: f.authority.doc })
      .tr.insertText('😀', 2)
      .insertText('!', 4);
    const candidate = prepareNoteDocumentEdit(f.session, tr, f.authority);
    expect(candidate.authority.source).toBe('a😀\\!bc');
    expect(candidate.state.history).toHaveLength(1);
    expect(materializeNoteDocumentAuthority(candidate.state, fixture().authority).source).toBe(
      'a😀\\!bc',
    );
    expect(moveNoteDocumentHistory(candidate.state, 'undo')!.state.dirty).toEqual([]);
  });

  it('groups root, document-appended and final selection-only changes into one undo entry', () => {
    const f = fixture();
    f.session.limits = { ...f.session.limits, historyEntries: 1 };
    f.session.selection = { anchor: 102, head: 101, anchorAffinity: -1, headAffinity: 1 };
    const root = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({
        doc: f.authority.doc,
        selection: TextSelection.create(f.authority.doc, 3, 2),
      }).tr.insertText('X', 2),
      f.authority,
    );
    const appended = prepareNoteDocumentEdit(
      root.state,
      EditorState.create({ doc: root.authority.doc }).tr.insertText('Y', 3),
      root.authority,
      { appendTo: root.historyGroup },
    );
    expect(appended.state.history).toHaveLength(1);
    expect(appended.authority.source).toBe('aXYbc');
    const final = prepareNoteDocumentEdit(
      appended.state,
      EditorState.create({ doc: appended.authority.doc }).tr.setSelection(
        TextSelection.create(appended.authority.doc, 5, 2),
      ),
      appended.authority,
      { appendTo: root.historyGroup },
    );
    expect(final.state.selection).toEqual({
      anchor: 104,
      head: 101,
      anchorAffinity: 1,
      headAffinity: 1,
    });
    expect(final.state.history).toHaveLength(1);
    expect(final.state.dirty).toBe(appended.state.dirty);
    expect(final.state.replay).toBe(appended.state.replay);
    expect(final.splices).toEqual([]);
    const undone = moveNoteDocumentHistory(final.state, 'undo')!;
    expect(undone.state.dirty).toEqual([]);
    expect(undone.state.replay).toEqual([]);
    expect(undone.state.selection).toEqual(f.session.selection);
    expect(materializeNoteDocumentAuthority(undone.state, fixture().authority).source).toBe('abc');
    const redone = moveNoteDocumentHistory(undone.state, 'redo')!;
    expect(redone.state.selection).toEqual(final.state.selection);
    expect(materializeNoteDocumentAuthority(redone.state, fixture().authority).source).toBe(
      'aXYbc',
    );
    expect(f.session.history).toEqual([]);
    expect(root.authority.source).toBe('aXbc');
  });

  it('rejects stale selection-only appended groups and keeps unrelated selections out of edit history', () => {
    const f = fixture();
    const root = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
      f.authority,
    );
    const selection = EditorState.create({ doc: root.authority.doc }).tr.setSelection(
      TextSelection.create(root.authority.doc, 4, 2),
    );
    expect(() =>
      prepareNoteDocumentEdit(root.state, selection, root.authority, { appendTo: 999 }),
    ).toThrow(/Stale appended/);
    const unrelated = prepareNoteDocumentEdit(root.state, selection, root.authority);
    expect(unrelated.state.selection).not.toEqual(root.state.selection);
    expect(unrelated.state.history).toBe(root.state.history);
    expect(unrelated.state.history[0].after).toEqual(root.state.selection);
    expect(root.state.selection).toEqual(root.state.history[0].after);
    const undo = moveNoteDocumentHistory(root.state, 'undo')!.state;
    const authority = materializeNoteDocumentAuthority(undo, fixture().authority);
    expect(() =>
      prepareNoteDocumentEdit(
        undo,
        EditorState.create({ doc: authority.doc }).tr.setSelection(
          TextSelection.create(authority.doc, 2),
        ),
        authority,
        { appendTo: root.historyGroup },
      ),
    ).toThrow(/Stale appended/);
  });

  it('reserves inverse retention so reaching edit pressure never disables undo', () => {
    const f = fixture();
    f.session.limits = { ...f.session.limits, historyEntries: 1 };
    const first = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
      f.authority,
    );
    expect(() =>
      prepareNoteDocumentEdit(
        first.state,
        EditorState.create({ doc: first.authority.doc }).tr.insertText('Y', 2),
        first.authority,
      ),
    ).toThrow(/budget/i);
    const undone = moveNoteDocumentHistory(first.state, 'undo')!;
    expect(undone.state.dirty).toEqual([]);
    expect(moveNoteDocumentHistory(undone.state, 'redo')!.splices).toEqual(first.splices);
  });

  it('keeps undo across an exact save and refuses unknown canonical effects', () => {
    const f = fixture();
    const edit = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
      f.authority,
    );
    expect(() =>
      reconcileNoteDocumentSave(edit.state, {
        generation: edit.state.generation,
        baseRevision: 'r1',
        sourceRevision: 'r2',
        sourceLength: 1001,
        exactLocalResult: false,
      }),
    ).toThrow(/authority/i);
    const saved = reconcileNoteDocumentSave(edit.state, {
      generation: edit.state.generation,
      baseRevision: 'r1',
      sourceRevision: 'r2',
      sourceLength: 1001,
      exactLocalResult: true,
    });
    expect(saved.dirty).toEqual([]);
    const undo = moveNoteDocumentHistory(saved, 'undo')!;
    expect(overlayNoteDocumentSource(undo.state, 100, 'aXbc', 'r2').text).toBe('abc');
    expect(() => overlayNoteDocumentSource(undo.state, 100, 'aXbc', 'r1')).toThrow(/Stale/);
    expect(undo.state.selection).toEqual(f.session.selection);
    const savedWindow = fixture('aXbc', 100, 1001);
    savedWindow.w.sourceRevision = 'r2';
    const savedAuthority = createNoteEditAuthority(
      savedWindow.w,
      savedWindow.projection,
      [savedWindow.owner],
      savedWindow.authority.doc,
    );
    expect(materializeNoteDocumentAuthority(undo.state, savedAuthority).source).toBe('abc');
    let cycling = undo.state;
    for (let i = 0; i < 100; i++) {
      cycling = moveNoteDocumentHistory(cycling, 'redo')!.state;
      cycling = moveNoteDocumentHistory(cycling, 'undo')!.state;
    }
    expect(cycling.replay).toEqual(undo.state.replay);
    expect(cycling.dirty).toEqual(undo.state.dirty);
    expect(materializeNoteDocumentAuthority(cycling, savedAuthority).doc.textContent).toBe('abc');
  });

  it('preserves unsaved reverse edits when branching after undo of a saved edit', () => {
    const f = fixture();
    const first = prepareNoteDocumentEdit(
      f.session,
      EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
      f.authority,
    );
    const saved = reconcileNoteDocumentSave(first.state, {
      generation: first.state.generation,
      baseRevision: 'r1',
      sourceRevision: 'r2',
      sourceLength: 1001,
      exactLocalResult: true,
    });
    const undone = moveNoteDocumentHistory(saved, 'undo')!.state;
    const base = fixture('aXbc', 100, 1001);
    base.w.sourceRevision = 'r2';
    const clean = createNoteEditAuthority(
      base.w,
      base.projection,
      [base.owner],
      base.authority.doc,
    );
    const mounted = materializeNoteDocumentAuthority(undone, clean);
    const branch = prepareNoteDocumentEdit(
      undone,
      EditorState.create({ doc: mounted.doc }).tr.insertText('Y', 3),
      mounted,
    );
    expect(materializeNoteDocumentAuthority(branch.state, clean).source).toBe('abYc');
    expect(moveNoteDocumentHistory(branch.state, 'redo')).toBeUndefined();
    expect(
      materializeNoteDocumentAuthority(moveNoteDocumentHistory(branch.state, 'undo')!.state, clean)
        .source,
    ).toBe('abc');
  });

  it('retains selection direction and rejects a logical selection beyond the mounted source', () => {
    const f = fixture();
    const state = EditorState.create({ doc: f.authority.doc });
    f.session.selection = { anchor: 103, head: 101, anchorAffinity: -1, headAffinity: 1 };
    const candidate = prepareNoteDocumentEdit(
      f.session,
      state.tr.setSelection(TextSelection.create(state.doc, 4, 2)).insertText('x'),
      f.authority,
    );
    expect(moveNoteDocumentHistory(candidate.state, 'undo')!.state.selection).toEqual(
      f.session.selection,
    );
    expect(() =>
      prepareNoteDocumentEdit(
        { ...f.session, selection: { ...f.session.selection, anchor: 0 } },
        state.tr.insertText('x', 2),
        f.authority,
      ),
    ).toThrow(/selection/i);
  });
});
