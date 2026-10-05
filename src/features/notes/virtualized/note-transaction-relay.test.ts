import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { SourceProjection } from './projection/source-projection';
import { createNoteTransactionRelay, type NoteTransactionOwner } from './note-transaction-relay';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});
const doc = (text: string) =>
  schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
function fixture(extra: Plugin[] = []) {
  const initial = { doc: doc('abc'), projection: new SourceProjection('abc', 100) };
  // Deliberately small plain-text oracle; lexical source admission belongs to the
  // document owner, not this relay control.
  const prepare = vi.fn<NoteTransactionOwner['prepare']>((tr, before) => {
    expect(before.doc.eq(tr.before)).toBe(true);
    return { doc: tr.doc, projection: new SourceProjection(tr.doc.textContent, 100) };
  });
  const commit = vi.fn<NoteTransactionOwner['commit']>();
  const owner: NoteTransactionOwner = { initial, prepare, commit, current: () => true };
  let active: NoteTransactionOwner | undefined = owner;
  const relay = createNoteTransactionRelay(() => active);
  return {
    owner,
    prepare,
    commit,
    relay,
    state: EditorState.create({ doc: initial.doc, plugins: [relay.plugin, ...extra] }),
    replace(value?: NoteTransactionOwner) {
      active = value;
    },
  };
}

function nativeFixture(
  hooks: {
    update?(editor: Editor): void;
    commit?(editor: Editor): void;
    finalize?: NoteTransactionOwner['finalize'];
  } = {},
) {
  let active: NoteTransactionOwner | undefined;
  let valid = true;
  let committed = 'abc';
  let published = new SourceProjection(committed, 100);
  const relay = createNoteTransactionRelay(() => active);
  const adopt = vi.fn();
  const commits = vi.fn<NoteTransactionOwner['commit']>((chain) => {
    committed = chain.after.doc.textContent;
    hooks.commit?.(editor);
  });
  const editor = new Editor({
    element: document.createElement('div'),
    content: '<p>abc</p>',
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Extension.create({
        name: 'serializedOwner',
        priority: 2000,
        addProseMirrorPlugins: () => [
          relay.plugin,
          new Plugin({
            view: () => ({
              update() {
                if (active) hooks.update?.(editor);
              },
            }),
          }),
        ],
        dispatchTransaction({ transaction, next }) {
          relay.dispatch(transaction, next, this.editor);
        },
      }),
    ],
    editorProps: {
      handleDOMEvents: {
        copy: (_view, event) => {
          if (!relay.busy) return false;
          event.preventDefault();
          return true;
        },
      },
    },
    onTransaction({ transaction, appendedTransactions, editor }) {
      const result = relay.adopt([transaction, ...appendedTransactions], editor.state);
      if (result) published = result.projection;
      adopt(result);
    },
  });
  const initial = { doc: editor.state.doc, projection: published };
  active = {
    initial,
    current: () => valid,
    prepare: (tr) => ({ doc: tr.doc, projection: new SourceProjection(tr.doc.textContent, 100) }),
    commit: commits,
    finalize: hooks.finalize,
  };
  return {
    editor,
    relay,
    commits,
    adopt,
    invalidate() {
      valid = false;
    },
    replace() {
      active = { ...active!, initial: { doc: editor.state.doc, projection: published } };
    },
    get committed() {
      return committed;
    },
    get published() {
      return published;
    },
  };
}

describe('accepted native transaction ownership', () => {
  it('prepares final selection metadata once and carries it into the next edit', () => {
    const f = fixture();
    const finalize = vi.fn<NonNullable<NoteTransactionOwner['finalize']>>((after) => ({
      ...after,
    }));
    f.owner.finalize = finalize;
    const first = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    f.relay.adopt(first.transactions, first.state);
    const accepted = f.commit.mock.calls[0][0].after;
    expect(finalize).toHaveBeenCalledWith(
      expect.anything(),
      first.state.selection,
      first.transactions,
    );
    expect(accepted).toBe(finalize.mock.results[0].value);
    const next = first.state.applyTransaction(first.state.tr.insertText('Y', 3));
    expect(f.prepare.mock.calls[1][1]).toBe(accepted);
    f.relay.adopt(next.transactions, next.state);
    expect(f.commit).toHaveBeenCalledTimes(2);
  });

  it.each(['throw', 'projection', 'coordinates'] as const)(
    'restores native state when finalization rejects by %s',
    (kind) => {
      const f = nativeFixture({
        finalize(after) {
          if (kind === 'throw') throw new Error('Unsupported final selection');
          if (kind === 'coordinates')
            return { ...after, coordinates: { start: 0, end: 1, length: 1, toBase: () => 0 } };
          return { ...after, projection: new SourceProjection('unowned', 100) };
        },
      });
      try {
        f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2));
        expect(f.editor.state.doc.textContent).toBe('abc');
        expect(f.editor.view.dom.textContent).toBe('abc');
        expect(f.committed).toBe('abc');
        expect(f.commits).not.toHaveBeenCalled();
        expect(f.relay.busy).toBe(false);
      } finally {
        f.editor.destroy();
      }
    },
  );

  it('does not publish a prepared edit rejected by a later plugin', () => {
    const f = fixture([new Plugin({ filterTransaction: () => false })]);
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(result.transactions).toEqual([]);
    expect(result.state).toBe(f.state);
    expect(f.relay.adopt(result.transactions, result.state)).toBeUndefined();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.owner.initial.doc.textContent).toBe('abc');
    expect(f.owner.initial.projection.sourceAt(2)).toBe(101);
  });

  it('prepares an appended transform against the accepted candidate and adopts the chain once', () => {
    const append = new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!transactions.some((tr) => tr.getMeta('root'))) return null;
        const tr = state.tr.insertText('Y', 3);
        return tr.setSelection(TextSelection.create(tr.doc, 1));
      },
    });
    const f = fixture([append]);
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2).setMeta('root', true));
    expect(result.transactions).toHaveLength(2);
    expect(f.prepare.mock.calls.map(([, before]) => before.doc.textContent)).toEqual([
      'abc',
      'aXbc',
    ]);
    expect(f.commit).not.toHaveBeenCalled();
    const projection = f.relay.adopt(result.transactions, result.state);
    expect(f.commit).toHaveBeenCalledOnce();
    const chain = f.commit.mock.calls[0][0];
    expect(chain.before.doc.textContent).toBe('abc');
    expect(chain.after.doc.textContent).toBe('aXYbc');
    expect(chain.transactions).toEqual(result.transactions);
    expect(chain.selection).toBe(result.state.selection);
    expect(chain.selection.head).toBe(1);
    expect(projection?.projection).toBe(chain.after.projection);
    expect(f.relay.adopt(result.transactions, result.state)).toBeUndefined();
    expect(f.commit).toHaveBeenCalledOnce();
  });

  it('uses the advanced projection for consecutive native edits', () => {
    const f = fixture();
    const first = f.state.applyTransaction(f.state.tr.insertText('XY', 2));
    const firstProjection = f.relay.adopt(first.transactions, first.state);
    const next = first.state.tr.insertText('Z', 5);
    const second = first.state.applyTransaction(
      next.setSelection(TextSelection.create(next.doc, 6)),
    );
    expect(f.prepare.mock.calls[1][1].projection).toBe(firstProjection?.projection);
    const secondProjection = f.relay.adopt(second.transactions, second.state);
    expect(second.state.doc.textContent).toBe('aXYbZc');
    expect(secondProjection?.projection.sourceAt(second.state.selection.head)).toBe(105);
    expect(f.commit).toHaveBeenCalledTimes(2);
  });

  it('includes selection-only append results without an extra history adoption', () => {
    const f = fixture([
      new Plugin({
        appendTransaction(transactions, _old, state) {
          return transactions.some((tr) => tr.docChanged)
            ? state.tr.setSelection(TextSelection.create(state.doc, 1))
            : null;
        },
      }),
    ]);
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    expect(result.transactions).toHaveLength(2);
    expect(f.prepare).toHaveBeenCalledOnce();
    f.relay.adopt(result.transactions, result.state);
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.commit.mock.calls[0][0].selection.head).toBe(1);
  });

  it('rejects old-owner adoption and only permits a replacement bound to the current document', () => {
    const f = fixture();
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    const nextCommit = vi.fn<NoteTransactionOwner['commit']>();
    const replacement: NoteTransactionOwner = { ...f.owner, commit: nextCommit };
    f.replace(replacement);
    expect(f.relay.adopt(result.transactions, result.state)).toBeUndefined();
    expect(f.commit).not.toHaveBeenCalled();
    expect(result.state.applyTransaction(result.state.tr.insertText('Y', 3)).transactions).toEqual(
      [],
    );
    f.replace({
      ...replacement,
      initial: { doc: result.state.doc, projection: new SourceProjection('aXbc', 100) },
    });
    const fresh = result.state.applyTransaction(result.state.tr.insertText('Y', 3));
    f.relay.adopt(fresh.transactions, fresh.state);
    expect(nextCommit).toHaveBeenCalledOnce();
    expect(nextCommit.mock.calls[0][0].before.doc.textContent).toBe('aXbc');
  });

  it('refuses stale scope and a candidate that does not describe the actual native result', () => {
    const f = fixture();
    f.replace({ ...f.owner, current: () => false });
    expect(f.state.applyTransaction(f.state.tr.insertText('X', 2)).transactions).toEqual([]);
    expect(f.prepare).not.toHaveBeenCalled();
    f.replace({ ...f.owner, prepare: () => f.owner.initial });
    expect(f.state.applyTransaction(f.state.tr.insertText('X', 2)).transactions).toEqual([]);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('keeps read-only selection transactions while refusing document edits without an owner', () => {
    const f = fixture();
    f.replace();
    const selected = f.state.applyTransaction(
      f.state.tr.setSelection(TextSelection.create(f.state.doc, 2)),
    );
    expect(selected.transactions).toHaveLength(1);
    expect(f.relay.adopt(selected.transactions, selected.state)).toBeUndefined();
    expect(f.state.applyTransaction(f.state.tr.insertText('X', 2)).transactions).toEqual([]);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('checks the mounted projection budget before accepting any source/history adoption', () => {
    const f = fixture();
    const oversized = new SourceProjection('abc', 100);
    oversized.content.content = Array.from({ length: 4097 }, () => ({ type: 'paragraph' }));
    f.replace({ ...f.owner, prepare: (tr) => ({ doc: tr.doc, projection: oversized }) });
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    expect(result.transactions).toEqual([]);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('uses actual TipTap accepted notifications rather than beforeTransaction for adoption', () => {
    let owner: NoteTransactionOwner | undefined;
    const relay = createNoteTransactionRelay(() => owner);
    const commit = vi.fn<NoteTransactionOwner['commit']>();
    const before = vi.fn();
    const applied = vi.fn();
    const editor = new Editor({
      element: document.createElement('div'),
      content: '<p>abc</p>',
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Extension.create({
          name: 'fixtureRelay',
          priority: 2000,
          addProseMirrorPlugins: () => [relay.plugin],
          dispatchTransaction({ transaction, next }) {
            relay.dispatch(transaction, next, this.editor);
          },
        }),
        Extension.create({
          name: 'fixtureTransforms',
          addProseMirrorPlugins: () => [
            new Plugin({
              filterTransaction: (tr) => !tr.getMeta('reject'),
              appendTransaction(transactions, _old, state) {
                if (!transactions.some((tr) => tr.getMeta('append'))) return null;
                const tr = state.tr.insertText('Y', 3);
                return tr.setSelection(TextSelection.create(tr.doc, 1));
              },
            }),
          ],
        }),
      ],
      onTransaction({ transaction, appendedTransactions, editor }) {
        applied(relay.adopt([transaction, ...appendedTransactions], editor.state));
      },
    });
    editor.on('beforeTransaction', before);
    try {
      owner = {
        initial: { doc: editor.state.doc, projection: new SourceProjection('abc', 100) },
        current: () => true,
        prepare: (tr) => ({
          doc: tr.doc,
          projection: new SourceProjection(tr.doc.textContent, 100),
        }),
        commit,
      };
      editor.view.dispatch(editor.state.tr.insertText('X', 2).setMeta('reject', true));
      expect(before).toHaveBeenCalledOnce();
      expect(applied).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(editor.state.doc.textContent).toBe('abc');
      editor.view.dispatch(editor.state.tr.insertText('X', 2).setMeta('append', true));
      expect(commit).toHaveBeenCalledOnce();
      expect(commit.mock.calls[0][0].transactions).toHaveLength(2);
      expect(commit.mock.calls[0][0].after.doc).toBe(editor.state.doc);
      expect(commit.mock.calls[0][0].selection).toBe(editor.state.selection);
      expect(editor.state.doc.textContent).toBe('aXYbc');
      expect(applied.mock.calls[0][0].projection.sourceAt(editor.state.selection.head)).toBe(100);
    } finally {
      editor.destroy();
    }
  });

  it('restores committed native text after synchronous owner invalidation before adoption', () => {
    let copied = false;
    const f = nativeFixture({
      update(editor) {
        const event = new Event('copy', { bubbles: true, cancelable: true });
        editor.view.dom.dispatchEvent(event);
        copied ||= !event.defaultPrevented;
      },
    });
    try {
      f.editor.on('beforeTransaction', () => f.invalidate());
      f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2));
      expect(f.commits).not.toHaveBeenCalled();
      expect(f.editor.state.doc.textContent).toBe('abc');
      expect(f.editor.view.dom.textContent).toBe('abc');
      expect(f.committed).toBe('abc');
      expect(copied).toBe(false);
      f.editor.view.dispatch(f.editor.state.tr.insertText('Y', 2));
      expect(f.editor.state.doc.textContent).toBe('abc');
    } finally {
      f.editor.destroy();
    }
  });

  it('defers replacement binding until the accepted state is committed', () => {
    const f = nativeFixture();
    const bound: string[] = [];
    try {
      f.editor.on('beforeTransaction', () => {
        expect(
          f.relay.defer('owner', () => {
            bound.push(f.committed);
            f.replace();
          }),
        ).toBe(true);
      });
      f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2));
      expect(bound).toEqual(['aXbc']);
      expect(f.commits).toHaveBeenCalledOnce();
      f.editor.view.dispatch(f.editor.state.tr.insertText('Y', 3));
      expect(f.committed).toBe('aXYbc');
      expect(f.editor.state.doc.textContent).toBe(f.committed);
    } finally {
      f.editor.destroy();
    }
  });

  it.each(['update', 'commit'] as const)(
    'serializes nested %s dispatch without publishing an older projection last',
    (hook) => {
      let queued = false;
      const f = nativeFixture({
        [hook](editor: Editor) {
          if (queued) return;
          queued = true;
          expect(f.relay.projectionAt(editor.state)?.sourceAt(3)).toBe(102);
          editor.view.dispatch(editor.state.tr.insertText('Y', 3));
          expect(editor.state.doc.textContent).toBe('aXbc');
        },
      });
      try {
        f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2));
        expect(f.commits).toHaveBeenCalledTimes(2);
        expect(f.committed).toBe('aXYbc');
        expect(f.editor.state.doc.textContent).toBe('aXYbc');
        expect(f.published).toBe(f.commits.mock.calls[1][0].after.projection);
        expect(f.relay.busy).toBe(false);
      } finally {
        f.editor.destroy();
      }
    },
  );

  it('turns expected unsupported preparation into refusal before native apply', () => {
    const f = fixture();
    f.replace({
      ...f.owner,
      prepare: () => {
        throw new Error('Unsupported bounded owner');
      },
    });
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2));
    expect(result.transactions).toEqual([]);
    expect(result.state).toBe(f.state);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('clears nested work and deferred bindings when a plugin throws before owner adoption', () => {
    const primary = new Error('Plugin update failed');
    const replacement = vi.fn();
    let first = true;
    const f = nativeFixture({
      update(editor) {
        if (!first) return;
        first = false;
        editor.view.dispatch(editor.state.tr.insertText('Y', 3));
        f.relay.defer('owner', replacement);
        throw primary;
      },
    });
    try {
      expect(() => f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2))).toThrow(primary);
      expect(f.relay.busy).toBe(false);
      expect(f.commits).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      expect(f.editor.state.doc.textContent).toBe('abc');
      expect(f.editor.view.dom.textContent).toBe('abc');
      f.editor.view.dispatch(f.editor.state.tr.insertText('Z', 2));
      expect(f.committed).toBe('aZbc');
      expect(f.commits).toHaveBeenCalledOnce();
      expect(replacement).not.toHaveBeenCalled();
    } finally {
      f.editor.destroy();
    }
  });

  it('retains the original plugin error when rollback also throws and resets the dispatch guard', () => {
    const primary = new Error('First plugin failure');
    const rollback = new Error('Rollback plugin failure');
    let first = true;
    const f = nativeFixture({
      update() {
        const error = first ? primary : rollback;
        first = false;
        throw error;
      },
    });
    try {
      let failure: unknown;
      try {
        f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([primary, rollback]);
      expect((failure as AggregateError).cause).toBe(primary);
      expect(f.relay.busy).toBe(false);
      expect(f.commits).not.toHaveBeenCalled();
      expect(f.committed).toBe('abc');
      expect(f.editor.isDestroyed).toBe(true);
    } finally {
      if (!f.editor.isDestroyed) f.editor.destroy();
    }
  });

  it('retires uncertain throwing owner adoption without rolling its source back', () => {
    const primary = new Error('Owner commit failed');
    const f = nativeFixture({
      commit(editor) {
        editor.view.dispatch(editor.state.tr.insertText('Y', 3));
        throw primary;
      },
    });
    expect(() => f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2))).toThrow(primary);
    expect(f.committed).toBe('aXbc');
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.editor.isDestroyed).toBe(true);
    expect(f.relay.busy).toBe(false);
  });

  it('does not roll back an already committed owner after a later event listener throws', () => {
    const primary = new Error('Later transaction listener failed');
    const f = nativeFixture();
    const fail = () => {
      throw primary;
    };
    f.editor.on('transaction', fail);
    try {
      expect(() => f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2))).toThrow(primary);
      expect(f.committed).toBe('aXbc');
      expect(f.editor.state.doc.textContent).toBe('aXbc');
      expect(f.published).toBe(f.commits.mock.calls[0][0].after.projection);
      expect(f.relay.busy).toBe(false);
      f.editor.off('transaction', fail);
      f.editor.view.dispatch(f.editor.state.tr.insertText('Y', 3));
      expect(f.committed).toBe('aXYbc');
    } finally {
      f.editor.destroy();
    }
  });

  it('clears queued work if a deferred lifecycle rebind throws', () => {
    const primary = new Error('Deferred owner binding failed');
    let first = true;
    const f = nativeFixture({
      commit(editor) {
        if (!first) return;
        first = false;
        editor.view.dispatch(editor.state.tr.insertText('Y', 3));
        f.relay.defer('owner', () => {
          throw primary;
        });
      },
    });
    try {
      expect(() => f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2))).toThrow(primary);
      expect(f.relay.busy).toBe(false);
      expect(f.committed).toBe('aXbc');
      f.editor.view.dispatch(f.editor.state.tr.insertText('Z', 2));
      expect(f.committed).toBe('aZXbc');
      expect(f.commits).toHaveBeenCalledTimes(2);
    } finally {
      f.editor.destroy();
    }
  });

  it('honors deferred unmount cleanup even when the native dispatch throws', () => {
    const primary = new Error('Plugin failed during unmount');
    const retirement = vi.fn();
    let first = true;
    const f = nativeFixture({
      update(editor) {
        if (!first) return;
        first = false;
        f.relay.defer('destroy', () => {
          retirement();
          editor.destroy();
        });
        throw primary;
      },
    });
    expect(() => f.editor.view.dispatch(f.editor.state.tr.insertText('X', 2))).toThrow(primary);
    expect(retirement).toHaveBeenCalledOnce();
    expect(f.editor.isDestroyed).toBe(true);
    expect(f.relay.busy).toBe(false);
    expect(f.commits).not.toHaveBeenCalled();
  });
});

it.each(['root', 'appended'] as const)(
  'validates %s prepared output before native acceptance or adoption',
  (kind) => {
    const append = new Plugin({
      appendTransaction(transactions, _old, state) {
        return transactions.some((tr) => tr.getMeta('root')) ? state.tr.insertText('Y', 3) : null;
      },
    });
    const f = fixture([append]);
    f.prepare.mockImplementation((tr) => {
      const projection = new SourceProjection(tr.doc.textContent, 100);
      if (kind === 'root' || tr.doc.textContent.includes('Y')) {
        projection.content.content![0].attrs = { unexpected: 'discarded by constructor' };
        expect(schema.nodeFromJSON(projection.content).eq(tr.doc)).toBe(true);
      }
      return { doc: tr.doc, projection };
    });
    const result = f.state.applyTransaction(f.state.tr.insertText('X', 2).setMeta('root', true));
    expect(f.prepare).toHaveBeenCalledTimes(kind === 'root' ? 1 : 2);
    expect(result.transactions).toHaveLength(kind === 'root' ? 0 : 1);
    expect(result.state.doc.textContent).toBe(kind === 'root' ? 'abc' : 'aXbc');
    expect(f.commit).not.toHaveBeenCalled();
    f.relay.adopt(result.transactions, result.state);
    expect(f.commit).toHaveBeenCalledTimes(kind === 'root' ? 0 : 1);
    if (kind === 'appended') expect(f.commit.mock.calls[0][0].after.doc.textContent).toBe('aXbc');
  },
);

it('refuses callback mutation of retained relay projection despite unchanged native candidate and current owner', () => {
  let projection: SourceProjection | undefined;
  let mutated = false;
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: {
        content: 'text*',
        attrs: {
          probe: {
            default: null,
            validate() {
              if (projection) {
                projection.content.content![0].content![0].text = 'changed';
                mutated = true;
              }
            },
          },
        },
      },
      text: {},
    },
  });
  const initial = {
    doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('abc'))]),
    projection: new SourceProjection('abc', 100),
  };
  const commit = vi.fn();
  const owner: NoteTransactionOwner = {
    initial,
    current: () => true,
    commit,
    prepare(tr) {
      projection = new SourceProjection(tr.doc.textContent, 100);
      return { doc: tr.doc, projection };
    },
  };
  const relay = createNoteTransactionRelay(() => owner);
  const before = EditorState.create({ doc: initial.doc, plugins: [relay.plugin] });
  const result = before.applyTransaction(before.tr.insertText('X', 2));
  expect(mutated).toBe(true);
  expect(owner.current()).toBe(true);
  expect(result.transactions).toHaveLength(0);
  expect(result.state).toBe(before);
  expect(relay.adopt(result.transactions, result.state)).toBeUndefined();
  expect(commit).not.toHaveBeenCalled();
  expect(initial.doc.textContent).toBe('abc');
  expect(initial.projection.content.content![0].content![0].text).toBe('abc');
});

it('refuses an exact candidate when its explicit native adapter refuses', () => {
  const f = fixture();
  const validate = vi.fn<NonNullable<NoteTransactionOwner['nativeOutput']>>(() => undefined);
  f.owner.nativeOutput = validate;
  const tr = f.state.tr.insertText('X', 2);
  const result = f.state.applyTransaction(tr);
  expect(validate).toHaveBeenCalledExactlyOnceWith(f.prepare.mock.results[0].value, tr);
  expect(result.transactions).toEqual([]);
  expect(result.state).toBe(f.state);
  expect(f.relay.adopt(result.transactions, result.state)).toBeUndefined();
  expect(f.commit).not.toHaveBeenCalled();
});
