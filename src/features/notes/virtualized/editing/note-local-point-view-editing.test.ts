/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import type { Workspace } from '$shared/types';
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { Editor, Extension } from '@tiptap/core';
import { NoteNativeLifetime } from '../note-native-lifetime';
import { NoteRetainedNativeLifetime } from '../note-retained-native-lifetime';
import type { Node as TiptapNode } from '@tiptap/core';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { readNoteWindow } from '../note-window-reader';
import { NoteWindowView } from '../note-window-view';
import { prepareNoteLocalPointViewEditing } from './note-local-point-view-editing';
import plainLocal from './__fixtures__/note-local-point/plain-paragraph-ab.json';
const pointId = '00000000-0000-4000-8000-000000000001';
const literal = `<!--anchor:${pointId}:point-->`;
const original = appClient.notes.pages;
afterEach(() => {
  appClient.notes.pages = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function fixture(withData = false, upload = false) {
  const calls = plainLocal.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxItems === q.maxItems &&
        r.maxWireBytes === q.maxWireBytes &&
        ('contextRef' in q
          ? 'contextRef' in r && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (q.kind === 'source') {
      expect(q.snapshotId).toBe(identity.snapshotId);
      expect(q.sourceRevision).toBe(identity.sourceRevision);
      expect(q.noteInstanceId).toBe(identity.scope.noteInstanceId);
    }
    if (!found) throw new Error('Uncaptured request');
    return found.response;
  });
  const readPage = (q: NotePageRequest) =>
    reader.read(identity.scope.workspaceId, identity.scope.noteId, q);
  const window = await readNoteWindow(readPage, { ...identity, at: plainLocal.at });
  const ws = identity.scope.workspaceId,
    id = identity.scope.noteId;
  let pages = a.notePagesReducer(undefined, a.pagePanelOpened(ws, id, 'panel'));
  const channel = stdChannel(),
    listeners = new Set<() => void>();
  let clockHook: (() => void) | undefined;
  let publishedHook: (() => void) | undefined;
  let changedHook: (() => void) | undefined;
  let retainHook: (() => void) | undefined;
  let selectionHook: (() => void) | undefined;
  let dataReleases = 0;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    pages = a.notePagesReducer(pages, action);
    for (const fn of listeners) fn();
    channel.put(action);
    if (action.type === a.pageDocumentPublished.type) publishedHook?.();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: upload ? 21_827_584 : 100_000_000,
      stringUnits: upload ? 21_827_584 : 100_000_000,
      objectNodes: upload ? 13_705_216 : 100_000_000,
      domNodes: 10000,
      physicalReads: upload ? 5 : 16,
      assemblies: upload ? 10 : 16,
    }),
  );
  dispatch(
    a.pageStateReceived(ws, id, 0, {
      kind: 'notePageState',
      scope: identity.scope,
      stateGeneration: '1',
      sourceRevision: identity.sourceRevision,
      attributionGeneration: '1',
      attributionState: 'ready',
      commentRevision: '1',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(ws, id, 'panel', plainLocal.at));
  const note = () => pages.byWorkspaceId[ws].notes[id];
  const seed = { owner: 'local-seed', data: 'local-seed-data', control: 'local-seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  dispatch(
    a.pageWindowSettled(
      ws,
      id,
      'panel',
      note().generation,
      note().windows.panel.request,
      window,
      null,
      { sponsor: seed.owner, resource: seed.data, owner: 'local-window' },
    ),
  );
  dispatch(a.pageResourcesReleased(seed.owner));

  let time = plainLocal.capturedAtMs;
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  const resizeCallbacks: Array<() => void> = [];
  let observations = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {
        observations++;
      }
      disconnect() {}
    },
  );
  const d = note().document!;
  dispatch(
    a.pageDocumentSelectionChanged(ws, id, note().generation, d, {
      anchor: 1,
      head: 1,
      anchorAffinity: 1,
      headAffinity: 1,
    }),
  );
  const port = {
    read: () => pages,
    dispatch,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: identity.scope.backendId, annotations: false },
    read: (_w, _n, q) => readPage(q),
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: pages }) },
    notePagesSaga,
  );
  const offer = prepareNoteLocalPointViewEditing([
    port,
    window,
    'panel',
    undefined,
    () => {
      clockHook?.();
      return time;
    },
  ]);
  const editing = await offer.ready;
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    workspace: { id: ws } as Workspace,
    ...(withData
      ? {
          retainWindow(target: typeof window) {
            const owner = 'retained-host-window';
            dispatch(a.pageWindowRetained(ws, id, 'panel', note().generation, target, owner));
            expect(pages.resourceLedger.owners[owner]).toBeDefined();
            retainHook?.();
            return () => {
              dataReleases++;
              dispatch(a.pageResourcesReleased(owner));
            };
          },
        }
      : {}),
    editing,
    changed: () => changedHook?.(),
    seek: vi.fn(),
    fullOperation: vi.fn(),
    selectionChanged(selection) {
      selectionHook?.();
      const n = note();
      if (n.document)
        dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document, selection));
    },
  });
  return {
    view,
    resize: () => resizeCallbacks.at(-1)!(),
    observations: () => observations,
    window,
    offer,
    note,
    dispatch,
    ledger: () => pages.resourceLedger,
    onSelection(fn?: () => void) {
      selectionHook = fn;
    },
    onRetain(fn: () => void) {
      retainHook = fn;
    },
    dataReleases: () => dataReleases,
    editing,
    onChanged(fn?: () => void) {
      changedHook = fn;
    },
    onClock(fn?: () => void) {
      clockHook = fn;
    },
    onPublication(fn?: () => void) {
      publishedHook = fn;
    },
    expire() {
      time = Date.parse(identity.expiresAt);
    },
    unmount() {
      dispatch(workspaceUnmounted(ws));
    },
    async cleanup(retainedFailure = false) {
      view.destroy();
      // A deliberately failed native unmount cannot return its DATA credit.
      if (retainedFailure) void offer.release();
      else await offer.release();
      task.cancel();
      await task.toPromise();
    },
  };
}
it('mounts the actual local point command and preserves the original editor through repeated undo redo', async () => {
  const f = await fixture();
  try {
    expect(f.view.show(f.window)).toBe(true);
    const editor = f.view.editor!;
    const schema = editor.schema;
    const plugins = editor.state.plugins.slice();
    expect(editor.state.selection.anchor).toBe(2);
    expect(editor.chain().insertContent('X').insertPointAnchor(pointId).run()).toBe(true);
    expect(f.note().document!.length).toBe(59);
    expect(f.note().document!.history).toHaveLength(1);
    expect(f.note().document!.history[0].kind).toBe('local-point');
    expect(f.view.projection!.source).toBe(`aX${literal}b`);
    for (let i = 0; i < 4; i++) {
      expect(f.view.history('undo')).toBe(true);
      expect(f.view.editor).toBe(editor);
      expect(editor.schema).toBe(schema);
      expect(editor.state.plugins).toEqual(plugins);
      expect(editor.state.doc.textContent).toBe('ab');
      expect(f.note().document!.cursor).toBe(0);
      expect(f.note().document!.length).toBe(2);
      expect(f.view.history('redo')).toBe(true);
      expect(f.view.editor).toBe(editor);
      expect(editor.schema).toBe(schema);
      expect(editor.state.plugins).toEqual(plugins);
      expect(editor.state.doc.child(0).child(1).type.name).toBe('commentAnchor');
      expect(f.note().document!.cursor).toBe(1);
      expect(f.note().document!.length).toBe(59);
      expect(f.view.projection!.source).toBe(`aX${literal}b`);
    }
  } finally {
    await f.cleanup();
  }
});
it('retires on expiry without discarding the unsaved local group', async () => {
  const f = await fixture();
  try {
    expect(f.view.show(f.window)).toBe(true);
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    expect(f.note().document!.history).toHaveLength(1);
    const savedDocument = f.note().document;
    f.expire();
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document).toBe(savedDocument);
  } finally {
    await f.cleanup();
  }
});

function insertPoint(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.view.show(f.window)).toBe(true);
  f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
  expect(f.note().document!.history).toHaveLength(1);
  expect(f.note().document!.length).toBe(59);
}
it('holds history busy before the first clock callback can reenter', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    let nested: boolean | undefined;
    f.onClock(() => {
      f.onClock();
      nested = f.view.history('undo');
    });
    expect(f.view.history('undo')).toBe(true);
    expect(nested).toBe(false);
    expect(f.note().document!.cursor).toBe(0);
  } finally {
    await f.cleanup();
  }
});
it('rejects an installed selection changed by updateState before Redux publication', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    const editor = f.view.editor!,
      original = editor.view.updateState.bind(editor.view),
      before = f.note().document;
    vi.spyOn(editor.view, 'updateState').mockImplementation((state) => {
      original(state);
      Reflect.set(state, 'selection', TextSelection.create(state.doc, 1));
    });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document).toBe(before);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
it('never rolls back an acknowledged undo when publication loses its lifetime', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    f.onPublication(() => {
      f.onPublication();
      f.expire();
    });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document!.cursor).toBe(0);
    expect(f.note().document!.history).toHaveLength(1);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
it.each(['applied', 'undone'] as const)(
  'refuses remount of %s local history while preserving drafts',
  async (kind) => {
    const f = await fixture();
    let second: NoteWindowView | undefined;
    try {
      insertPoint(f);
      if (kind === 'undone') expect(f.view.history('undo')).toBe(true);
      const savedDocument = f.note().document;
      f.view.destroy();
      const host = document.createElement('div');
      document.body.append(host);
      second = new NoteWindowView(host, {
        editing: f.editing,
        seek: vi.fn(),
        selectionChanged: vi.fn(),
        fullOperation: vi.fn(),
      });
      expect(() => second!.show(f.window)).toThrow();
      expect(f.note().document).toBe(savedDocument);
    } finally {
      second?.destroy();
      await f.cleanup();
    }
  },
);
it('bounds native cleanup across repeated history and holds DATA through dependent IO', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => (resolve = r));
  let destroyed = 0;
  const extensions = NoteNativeLifetime.prototype.extensions;
  vi.spyOn(NoteNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return extensions.call(
      this,
      items.map((e) =>
        e.name === 'commentAnchor'
          ? (e as TiptapNode).extend({
              addNodeView() {
                return () => ({
                  dom: document.createElement('span'),
                  destroy() {
                    destroyed++;
                    return pending;
                  },
                });
              },
            })
          : e,
      ),
    );
  });
  const f = await fixture();
  try {
    insertPoint(f);
    expect(f.view.history('undo')).toBe(true);
    expect(destroyed).toBe(1);
    const bytes = f.ledger().used.payloadBytes;
    expect(f.view.history('redo')).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(bytes);
    const drop = f.offer.retain();
    f.view.destroy();
    let released = false;
    const releasing = f.offer.release().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(f.ledger().used.payloadBytes).toBeGreaterThan(0);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(false);
    drop();
    await releasing;
    expect(released).toBe(true);
  } finally {
    resolve();
    await f.cleanup();
  }
});

it('permits exact selection no-ops but permanently refuses changed selection', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    const before = f.note().document!;
    f.view.setSelection({ ...before.selection });
    expect(f.note().document).toBe(before);
    expect(f.view.history('undo')).toBe(true);
    expect(f.view.history('redo')).toBe(true);
    const saved = f.note().document!;
    f.view.setSelection({ anchor: 0, head: 0, anchorAffinity: 1, headAffinity: 1 });
    f.view.setSelection({ ...saved.selection });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document!.history).toBe(saved.history);
    expect(f.note().document!.dirty).toBe(saved.dirty);
  } finally {
    await f.cleanup();
  }
});
it.each(['destroy', 'owner'] as const)(
  'rejects %s reentry before native history installation',
  async (kind) => {
    const f = await fixture();
    try {
      insertPoint(f);
      const before = f.note().document;
      f.onClock(() => {
        f.onClock();
        if (kind === 'destroy') f.view.destroy();
        else f.view.updateEditing(undefined);
      });
      expect(f.view.history('undo')).toBe(false);
      expect(f.note().document).toBe(before);
      expect(f.view.editor).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  },
);
it('retires a partially installed history state when native update throws', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    const editor = f.view.editor!,
      original = editor.view.updateState.bind(editor.view);
    const before = f.note().document;
    vi.spyOn(editor.view, 'updateState').mockImplementation((state) => {
      original(state);
      throw new Error('Native update failed after installation');
    });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document).toBe(before);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
it('keeps history busy through the acknowledged publication callback', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    let nested: boolean | undefined;
    f.onPublication(() => {
      f.onPublication();
      nested = f.view.history('redo');
    });
    expect(f.view.history('undo')).toBe(true);
    expect(nested).toBe(false);
    expect(f.view.history('redo')).toBe(true);
  } finally {
    await f.cleanup();
  }
});
it('rejects an installed foreign schema before domain publication', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    const editor = f.view.editor!,
      original = editor.view.updateState.bind(editor.view);
    const before = f.note().document;
    vi.spyOn(editor.view, 'updateState').mockImplementation((state) => {
      original(state);
      Object.defineProperty(state, 'schema', { value: {}, configurable: true });
    });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document).toBe(before);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});

it.each(['selection', 'destroy', 'owner'] as const)(
  'refuses %s drift during the commit-time clock before Redux ACK',
  async (kind) => {
    const f = await fixture();
    try {
      insertPoint(f);
      const before = f.note().document,
        editor = f.view.editor!;
      const owner = Reflect.get(f.view, 'historyOwner') as NoteTransactionOwner;
      const history = owner.history!.bind(owner);
      let callbackRan = false;
      vi.spyOn(owner, 'history').mockImplementation((direction) => {
        const plan = history(direction)!;
        const commit = plan.commitNative!.bind(plan);
        plan.commitNative = (view, state) => {
          f.onClock(() => {
            f.onClock();
            callbackRan = true;
            if (kind === 'selection')
              Reflect.set(editor.state, 'selection', TextSelection.create(editor.state.doc, 1));
            else if (kind === 'destroy') f.view.destroy();
            else f.view.updateEditing(undefined);
          });
          commit(view, state);
        };
        return plan;
      });
      expect(f.view.history('undo')).toBe(false);
      expect(callbackRan).toBe(true);
      expect(f.note().document).toBe(before);
    } finally {
      await f.cleanup();
    }
  },
);

function heldPointUnmount() {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => (resolve = r));
  let destroyed = 0;
  const original = NoteNativeLifetime.prototype.extensions;
  vi.spyOn(NoteNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return original.call(
      this,
      items.map((e) =>
        e.name === 'commentAnchor'
          ? (e as TiptapNode).extend({
              addNodeView() {
                return () => ({
                  dom: document.createElement('span'),
                  destroy() {
                    destroyed++;
                    return pending;
                  },
                });
              },
            })
          : e,
      ),
    );
  });
  return { resolve: () => resolve(), destroyed: () => destroyed };
}
it('retains the original prepared allocation after initial native publication loses its owner', async () => {
  const held = heldPointUnmount(),
    f = await fixture();
  try {
    expect(f.view.show(f.window)).toBe(true);
    const baseline = f.ledger().used.payloadBytes;
    let installed = false,
      charged = 0;
    f.onPublication(() => {
      f.onPublication();
      installed = f.view.editor!.state.doc.child(0).child(1).type.name === 'commentAnchor';
      charged = f.ledger().used.payloadBytes;
      f.offer.cancel();
    });
    expect(() =>
      f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run(),
    ).toThrow('Unsupported local point owner');
    expect(installed).toBe(true);
    expect(f.note().document!.length).toBe(59);
    expect(f.note().document!.history).toHaveLength(1);
    expect(held.destroyed()).toBe(1);
    expect(f.view.editor).toBeUndefined();
    expect(charged).toBeGreaterThan(baseline);
    expect(f.ledger().used.payloadBytes).toBe(charged);
    let released = false;
    const releasing = f.offer.release().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    held.resolve();
    await releasing;
    expect(f.note().document!.length).toBe(59);
    expect(f.ledger().used.payloadBytes).toBeLessThan(charged);
  } finally {
    held.resolve();
    await f.cleanup();
  }
});
it('keeps a rejected prepared command charged until native disposal and refuses another allocation', async () => {
  const original = NoteNativeLifetime.prototype.extensions;
  vi.spyOn(NoteNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return original.call(this, [
      ...items,
      Extension.create({
        name: 'rejectLocalPointForTest',
        priority: -1000,
        addProseMirrorPlugins: () => [new Plugin({ filterTransaction: (tr) => !tr.docChanged })],
      }),
    ]);
  });
  const f = await fixture();
  try {
    expect(f.view.show(f.window)).toBe(true);
    const before = f.note().document,
      baseline = f.ledger().used.payloadBytes;
    const editor = f.view.editor!;
    editor.chain().insertContent('X').insertPointAnchor(pointId).run();
    expect(f.note().document).toBe(before);
    expect(editor.state.doc.textContent).toBe('ab');
    const retained = f.ledger().used.payloadBytes;
    expect(retained).toBeGreaterThan(baseline);
    editor.chain().insertContent('X').insertPointAnchor(pointId).run();
    expect(f.ledger().used.payloadBytes).toBe(retained);
    expect(f.note().document).toBe(before);
    f.view.destroy();
    await f.offer.release();
    expect(f.ledger().used.payloadBytes).toBeLessThan(retained);
  } finally {
    await f.cleanup();
  }
});
it('admits redo only after the previous native point unmount has settled', async () => {
  const held = heldPointUnmount(),
    f = await fixture();
  try {
    insertPoint(f);
    expect(f.view.history('undo')).toBe(true);
    const before = f.note().document;
    expect(f.view.history('redo')).toBe(false);
    expect(f.note().document).toBe(before);
    held.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.view.history('redo')).toBe(true);
    expect(f.note().document!.length).toBe(59);
  } finally {
    held.resolve();
    await f.cleanup();
  }
});

it('retains native DATA and refuses further history after asynchronous unmount failure', async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_, fail) => (reject = fail));
  const original = NoteNativeLifetime.prototype.extensions;
  vi.spyOn(NoteNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return original.call(
      this,
      items.map((e) =>
        e.name === 'commentAnchor'
          ? (e as TiptapNode).extend({
              addNodeView() {
                return () => ({ dom: document.createElement('span'), destroy: () => pending });
              },
            })
          : e,
      ),
    );
  });
  const f = await fixture();
  try {
    insertPoint(f);
    expect(f.view.history('undo')).toBe(true);
    const before = f.note().document,
      charged = f.ledger().used.payloadBytes;
    reject(new Error('Controlled native unmount failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.view.history('redo')).toBe(false);
    expect(f.note().document).toBe(before);
    f.view.destroy();
    let released = false;
    void f.offer.release().then(() => {
      released = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(charged);
  } finally {
    reject(new Error('Controlled cleanup'));
    await f.cleanup(true);
  }
});

it('rejects configured plugin replacement during native state installation', async () => {
  const f = await fixture();
  try {
    insertPoint(f);
    const before = f.note().document,
      editor = f.view.editor!,
      original = editor.view.updateState.bind(editor.view);
    vi.spyOn(editor.view, 'updateState').mockImplementation((state) => {
      original(state);
      state.plugins.splice(0, state.plugins.length);
    });
    expect(f.view.history('undo')).toBe(false);
    expect(f.note().document).toBe(before);
  } finally {
    await f.cleanup();
  }
});

it('reattaches the retained original Editor with actual local history and new physical views', async () => {
  const f = await fixture();
  try {
    const pending = f.view.prepareRetained(f.window);
    expect(f.view.history('undo')).toBe(false);
    await pending.ready;
    const editor = f.view.editor!,
      schema = editor.schema;
    expect(editor.options.autofocus).toBe(false);
    expect(editor.chain().insertContent('X').insertPointAnchor(pointId).run()).toBe(true);
    const group = f.note().document!.history[0];
    expect(f.note().document!.length).toBe(59);
    for (let i = 0; i < 3; i++) {
      const previous = editor.view;
      const oldDispatch = previous.props.dispatchTransaction!;
      const oldTransaction = previous.state.tr;
      const token = await f.view.detachRetained();
      expect(previous.isDestroyed).toBe(true);
      expect(f.view.editor).toBeUndefined();
      expect(f.view.history('undo')).toBe(false);
      const mount = f.view.attachRetained(token);
      expect(() => f.view.attachRetained(token)).toThrow();
      await mount.ready;
      expect(f.view.editor).toBe(editor);
      expect(editor.schema).toBe(schema);
      expect(editor.view).not.toBe(previous);
      expect(() => oldDispatch.call(previous, oldTransaction)).toThrow();
      expect(f.note().document!.history[0]).toBe(group);
      expect(f.view.history('undo')).toBe(true);
      expect(f.note().document!.length).toBe(2);
      const undone = await f.view.detachRetained();
      await f.view.attachRetained(undone).ready;
      expect(f.view.history('redo')).toBe(true);
      expect(f.note().document!.length).toBe(59);
    }
  } finally {
    await f.cleanup();
  }
});
it('cancels retained initial readiness before the actual create task and preserves original state', async () => {
  const f = await fixture();
  try {
    const before = f.note().document;
    const pending = f.view.prepareRetained(f.window);
    pending.cancel();
    await expect(pending.ready).rejects.toThrow();
    expect(f.note().document).toBe(before);
    expect(() => f.view.prepareRetained(f.window)).toThrow();
  } finally {
    await f.cleanup();
  }
});
it('refuses retained reattachment after expiry without discarding unsaved history', async () => {
  const f = await fixture();
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const token = await f.view.detachRetained(),
      before = f.note().document;
    f.expire();
    await expect(f.view.attachRetained(token).ready).rejects.toThrow();
    expect(f.note().document).toBe(before);
    expect(before!.history).toHaveLength(1);
    expect(() => f.view.attachRetained(token)).toThrow();
  } finally {
    await f.cleanup();
  }
});

it('refuses reentrant public show during initial retained setup', async () => {
  const f = await fixture();
  try {
    let nested: boolean | undefined;
    f.onChanged(() => {
      f.onChanged();
      nested = f.view.show(f.window);
    });
    await f.view.prepareRetained(f.window).ready;
    expect(nested).toBe(false);
  } finally {
    await f.cleanup();
  }
});

it('waits for admitted dependent work before issuing a detach token', async () => {
  const f = await fixture();
  let drop: (() => void) | undefined;
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    drop = f.offer.retain();
    let settled = false;
    const pending = f.view.detachRetained().then((token) => {
      settled = true;
      return token;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(() => f.offer.retain()).toThrow();
    expect(() => f.view.attachRetained({})).toThrow();
    drop();
    drop = undefined;
    const token = await pending;
    await f.view.attachRetained(token).ready;
    expect(f.view.history('undo')).toBe(true);
  } finally {
    drop?.();
    await f.cleanup();
  }
});

it('cannot revive a detached token when the owner callback cancels attachment', async () => {
  const f = await fixture();
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const token = await f.view.detachRetained();
    const before = f.note().document;
    f.onClock(() => {
      f.onClock();
      f.view.destroy();
    });
    await expect(f.view.attachRetained(token).ready).rejects.toThrow();
    expect(f.note().document).toBe(before);
    expect(() => f.view.attachRetained(token)).toThrow();
  } finally {
    await f.cleanup();
  }
});

it('blocks scroller commands before readiness and while detached', async () => {
  const f = await fixture();
  try {
    const pending = f.view.prepareRetained(f.window);
    const before = f.view.getSelection();
    const command = () => {
      f.view.scroller.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }),
      );
      f.view.scroller.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
      );
    };
    command();
    expect(f.view.getSelection()).toEqual(before);
    await pending.ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const selection = f.view.getSelection();
    const token = await f.view.detachRetained();
    command();
    expect(f.view.getSelection()).toEqual(selection);
    const mount = f.view.attachRetained(token);
    command();
    expect(f.view.getSelection()).toEqual(selection);
    await mount.ready;
  } finally {
    await f.cleanup();
  }
});

it('rejects initial base mutation from the last readiness callback', async () => {
  const f = await fixture();
  try {
    const pending = f.view.prepareRetained(f.window);
    const editor = f.view.editor!;
    f.onChanged(() => {
      f.onChanged();
      Reflect.set(editor.state.doc.firstChild!.attrs, 'alien', true);
    });
    await expect(pending.ready).rejects.toThrow();
    expect(f.note().document!.history).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('retains physical cleanup debt while a mounted point destroy is held', async () => {
  const f = await fixture();
  let resolve!: () => void;
  const held = new Promise<void>((done) => {
    resolve = done;
  });
  const destroy = vi.fn(() => held);
  const products = retainedPointCleanup(destroy);
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const charged = f.ledger().used.payloadBytes;
    let settled = false;
    const pending = f.view.detachRetained().then((token) => {
      settled = true;
      return token;
    });
    await new Promise((done) => setTimeout(done, 10));
    expect(products.length).toBeGreaterThan(0);
    expect(destroy).toHaveBeenCalledTimes(products.length);
    for (const product of products) expect(product).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(charged);
    expect(() => f.view.attachRetained({})).toThrow();
    resolve();
    await f.view.attachRetained(await pending).ready;
  } finally {
    resolve();
    await f.cleanup();
  }
});

it('keeps unsaved state and refuses revival after failed physical detach cleanup', async () => {
  const f = await fixture();
  const destroy = vi.fn(() => Promise.reject(new Error('controlled retained cleanup failure')));
  const products = retainedPointCleanup(destroy);
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const before = f.note().document,
      charged = f.ledger().used.payloadBytes;
    await expect(f.view.detachRetained()).rejects.toThrow();
    expect(products.length).toBeGreaterThan(0);
    expect(products.length).toBeGreaterThan(0);
    expect(destroy).toHaveBeenCalledTimes(products.length);
    for (const product of products) expect(product).toHaveBeenCalledOnce();
    expect(f.note().document).toBe(before);
    expect(f.ledger().used.payloadBytes).toBe(charged);
    expect(() => f.view.attachRetained({})).toThrow();
  } finally {
    await f.cleanup(true);
  }
});

function retainedPointCleanup(cleanup: () => Promise<void>, constructed?: () => void) {
  const products: Array<ReturnType<typeof vi.fn>> = [];
  const original = NoteRetainedNativeLifetime.prototype.extensions;
  vi.spyOn(NoteRetainedNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return original.call(
      this,
      items.map((e) =>
        e.name === 'commentAnchor'
          ? (e as TiptapNode).extend({
              addNodeView() {
                const factory = this.parent?.();
                if (!factory) throw new Error('Missing configured point renderer');
                return (props) => {
                  const view = factory(props),
                    destroy = view.destroy;
                  const owned = vi.fn(() => {
                    destroy?.call(view);
                    return cleanup();
                  });
                  products.push(owned);
                  view.destroy = owned;
                  constructed?.();
                  return view;
                };
              },
            })
          : e,
      ),
    );
  });
  return products;
}

it('cancels stale core focus and nested scheduling before a new physical mount', async () => {
  const f = await fixture();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  try {
    const pending = f.view.prepareRetained(f.window);
    await vi.runAllTimersAsync();
    await pending.ready;
    const editor = f.view.editor!,
      old = editor.view;
    editor.chain().insertContent('X').insertPointAnchor(pointId).run();
    const scope = editor.captureDeferredTasks(old)!,
      stale = vi.fn();
    scope.enqueue('selection-focus', () => {
      stale();
      scope.enqueue('selection-focus', stale);
    });
    const focus = vi.spyOn(old, 'focus');
    editor.commands.focus();
    const token = await f.view.detachRetained();
    await scope.settled;
    const mount = f.view.attachRetained(token);
    await vi.runAllTimersAsync();
    await mount.ready;
    expect(stale).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(() => scope.enqueue('selection-focus', stale)).toThrow();
    expect(editor.view).not.toBe(old);
    expect(f.view.history('undo')).toBe(true);
  } finally {
    vi.useRealTimers();
    await f.cleanup();
  }
});

it('rejects new scheduled work from the final readiness callback', async () => {
  const f = await fixture();
  try {
    const pending = f.view.prepareRetained(f.window),
      work = vi.fn();
    f.onChanged(() => {
      f.onChanged();
      const editor = f.view.editor!;
      editor.captureDeferredTasks(editor.view)!.enqueue('selection-focus', work);
    });
    await expect(pending.ready).rejects.toThrow();
    await new Promise((done) => setTimeout(done, 10));
    expect(work).not.toHaveBeenCalled();
    expect(f.note().document!.history).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('does not reconnect observers after cancellation inside actual measurement', async () => {
  const f = await fixture();
  try {
    await f.view.prepareRetained(f.window).ready;
    // jsdom has no layout hit testing; the actual measurement proceeds with no anchor hit.
    vi.spyOn(f.view.editor!.view, 'posAtCoords').mockReturnValue(null);
    const host = f.view.scroller.querySelector('.note-window-native') as HTMLElement;
    const before = f.observations();
    vi.spyOn(host, 'getBoundingClientRect').mockImplementationOnce(() => {
      f.view.destroy();
      return new DOMRect(0, 0, 10, 10);
    });
    f.resize();
    expect(f.observations()).toBe(before);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});

it('refuses native update after a genuine selection borrower retires the mount', async () => {
  const f = await fixture(true);
  let borrow: ReturnType<NoteWindowView['borrowSelectionMarkdown']> | undefined;
  try {
    await f.view.prepareRetained(f.window).ready;
    const native = f.view.editor!.view,
      before = native.state;
    borrow = f.view.borrowSelectionMarkdown(
      {
        scope: f.window.scope,
        sourceRevision: f.window.sourceRevision,
        snapshotId: f.window.snapshotId,
        expiresAt: f.window.expiresAt!,
        documentGeneration: f.note().document!.generation,
        liveGeneration: f.view.selectionCaptureGeneration,
        selectionGeneration: 0,
      },
      () => true,
    );
    expect(borrow.current()).toBe(true);
    const lost = vi.fn(() => f.view.destroy());
    borrow.subscribe(lost);
    expect(lost).not.toHaveBeenCalled();
    const next = EditorState.create({
      schema: before.schema,
      doc: before.doc,
      plugins: before.plugins,
      selection: TextSelection.create(before.doc, 1),
    });
    expect(next).not.toBe(before);
    expect(lost).not.toHaveBeenCalled();
    expect(() => native.updateState(next)).toThrow();
    expect(lost).toHaveBeenCalledOnce();
    expect(native.state).toBe(before);
    expect(f.note().document!.history).toHaveLength(0);
  } finally {
    borrow?.release();
    await f.cleanup();
  }
});

it('does not invoke native hit testing after a geometry callback retires the mount', async () => {
  const f = await fixture();
  try {
    await f.view.prepareRetained(f.window).ready;
    const native = f.view.editor!.view;
    const hit = vi.spyOn(native, 'posAtCoords').mockReturnValue(null);
    vi.spyOn(f.view.scroller, 'getBoundingClientRect').mockImplementationOnce(() => {
      f.view.destroy();
      return new DOMRect();
    });
    f.resize();
    expect(hit).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

it('destroys a returned original Editor when initial binding throws before mounting', async () => {
  const f = await fixture();
  const borrow = f.editing.borrow!;
  vi.spyOn(f.editing, 'borrow').mockImplementation((window) => {
    const original = borrow(window);
    return {
      ...original,
      bind() {
        throw new Error('Controlled initial binding failure');
      },
    };
  });
  const destroy = vi.spyOn(Editor.prototype, 'destroy');
  try {
    await expect(f.view.prepareRetained(f.window).ready).rejects.toThrow();
    await new Promise((done) => setTimeout(done, 0));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(f.note().document!.history).toHaveLength(0);
  } finally {
    await f.cleanup(true);
  }
});

it('owns a returned Editor after cancellation inside its actual constructor callback', async () => {
  const f = await fixture();
  const extensions = NoteRetainedNativeLifetime.prototype.extensions;
  const beforeCreate = vi.fn();
  vi.spyOn(NoteRetainedNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    return extensions.call(this, [
      ...items,
      Extension.create({
        name: 'cancelInitialConstruction',
        onBeforeCreate() {
          beforeCreate();
          f.view.destroy();
        },
      }),
    ]);
  });
  const destroy = vi.spyOn(Editor.prototype, 'destroy');
  try {
    await expect(f.view.prepareRetained(f.window).ready).rejects.toThrow();
    await new Promise((done) => setTimeout(done, 0));
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(f.view.editor).toBeUndefined();
    expect(f.note().document!.history).toHaveLength(0);
  } finally {
    await f.cleanup(true);
  }
});
it('denies retained initial reservation before readiness and destroys the returned Editor', async () => {
  const f = await fixture();
  const destroy = vi.spyOn(Editor.prototype, 'destroy');
  const used = f.ledger().used;
  f.dispatch(
    a.pageResourcesRequested(
      'deny-initial',
      [
        {
          id: 'deny-initial-data',
          cost: {
            payloadBytes: 100_000_000 - used.payloadBytes - 1,
            stringUnits: 0,
            objectNodes: 0,
            domNodes: 0,
            physicalReads: 0,
            assemblies: 0,
          },
        },
      ],
      1,
    ),
  );
  expect(f.ledger().owners['deny-initial']).toBeDefined();
  try {
    await expect(f.view.prepareRetained(f.window).ready).rejects.toThrow();
    await new Promise((done) => setTimeout(done, 0));
    expect(destroy).toHaveBeenCalledOnce();
    expect(f.note().document!.history).toHaveLength(0);
    expect(f.view.editor).toBeUndefined();
  } finally {
    await f.cleanup(true);
  }
});
it('owns actual point products returned after reentrant cancellation during reattachment', async () => {
  const f = await fixture();
  let armed = false;
  const products = retainedPointCleanup(
    () => Promise.resolve(),
    () => {
      if (armed) f.view.destroy();
    },
  );
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    const token = await f.view.detachRetained(),
      before = f.note().document;
    const previous = products.length;
    armed = true;
    await expect(f.view.attachRetained(token).ready).rejects.toThrow();
    await new Promise((done) => setTimeout(done, 0));
    expect(products.length).toBeGreaterThan(previous);
    for (const destroy of products) expect(destroy).toHaveBeenCalledOnce();
    expect(f.note().document).toBe(before);
    expect(() => f.view.attachRetained(token)).toThrow();
  } finally {
    await f.cleanup(true);
  }
});
it('refuses saves after physical reattachment and permanently refuses a closed panel token', async () => {
  const f = await fixture();
  const save = vi.spyOn(appClient.notes.pages, 'applySplices');
  try {
    await f.view.prepareRetained(f.window).ready;
    f.view.editor!.chain().insertContent('X').insertPointAnchor(pointId).run();
    await f.view.attachRetained(await f.view.detachRetained()).ready;
    const before = f.note().document;
    f.dispatch(a.pageSaveDraftsRequested(f.window.scope.workspaceId, f.window.scope.noteId));
    await new Promise((done) => setTimeout(done, 0));
    expect(save).not.toHaveBeenCalled();
    expect(f.note().document).toBe(before);
    const token = await f.view.detachRetained();
    f.dispatch(a.pagePanelClosed(f.window.scope.workspaceId, f.window.scope.noteId, 'panel'));
    await expect(f.view.attachRetained(token).ready).rejects.toThrow();
    expect(f.note().document?.history).toEqual(before!.history);
    expect(() => f.view.attachRetained(token)).toThrow();
  } finally {
    await f.cleanup();
  }
});

it.each(['data', 'borrow'] as const)(
  'owns the returned %s lease when acquisition cancels retained setup',
  async (stage) => {
    const f = await fixture(true);
    const extensions = vi.spyOn(NoteRetainedNativeLifetime.prototype, 'extensions');
    if (stage === 'data') f.onRetain(() => f.view.destroy());
    else {
      const borrow = f.editing.borrow!;
      vi.spyOn(f.editing, 'borrow').mockImplementation((window) => {
        const result = borrow(window);
        f.view.destroy();
        return result;
      });
    }
    try {
      await expect(f.view.prepareRetained(f.window).ready).rejects.toThrow();
      await new Promise((done) => setTimeout(done, 0));
      expect(extensions).not.toHaveBeenCalled();
      expect(f.dataReleases()).toBe(1);
      expect(f.view.editor).toBeUndefined();
      expect(f.note().document!.history).toHaveLength(0);
      expect(() => f.view.prepareRetained(f.window)).toThrow();
    } finally {
      await f.cleanup(true);
    }
  },
);

it('fences actual NoteWindowView native and source selection while upload is prepared', async () => {
  const f = await fixture(false, true);
  let upload: ReturnType<typeof f.offer.prepareUpload> | undefined;
  try {
    insertPoint(f);
    upload = f.offer.prepareUpload();
    const e = f.view.editor!,
      state = e.state,
      selection = f.view.getSelection(),
      document = f.note().document;
    f.view.setSelection({ anchor: 0, head: 0, anchorAffinity: 1, headAffinity: 1 });
    expect(f.view.getSelection()).toEqual(selection);
    f.view.setSelection(selection);
    expect(f.view.getSelection()).toEqual(selection);
    expect(e.commands.setTextSelection(1)).toBe(true); // TipTap command return is not acceptance.
    expect(e.state).toBe(state);
    expect(() =>
      e.view.updateState(
        EditorState.create({
          doc: state.doc,
          plugins: state.plugins,
          selection: TextSelection.create(state.doc, 1),
        }),
      ),
    ).toThrow();
    expect(e.state).toBe(state);
    expect(f.note().document).toBe(document);
    expect(f.view.history('undo')).toBe(false);
  } finally {
    await upload?.release();
    await f.cleanup();
  }
});
it('refuses save issuance during actual direct native update plugin callbacks', async () => {
  const f = await fixture(false, true);
  try {
    insertPoint(f);
    const e = f.view.editor!;
    let reached = false;
    const plugin = new Plugin({
      view: () => ({
        update() {
          reached = true;
          expect(() => f.offer.prepareUpload()).toThrow();
        },
      }),
    });
    e.view.updateState(e.state.reconfigure({ plugins: [...e.state.plugins, plugin] }));
    e.view.updateState(e.state);
    expect(reached).toBe(true);
  } finally {
    await f.cleanup();
  }
});

it('blocks nested save during actual selection publication with an otherwise eligible genuine group', async () => {
  const f = await fixture(false, true);
  let upload: ReturnType<typeof f.offer.prepareUpload> | undefined;
  try {
    insertPoint(f);
    let reached = false;
    f.onSelection(() => {
      reached = true;
      expect(() => f.offer.prepareUpload()).toThrow();
    });
    f.view.setSelection(f.view.getSelection());
    expect(reached).toBe(true);
    f.onSelection();
    upload = f.offer.prepareUpload();
    expect(upload.input.header.localEditSequence).toBe(f.note().document!.history[0].id);
  } finally {
    f.onSelection();
    await upload?.release();
    await f.cleanup();
  }
});
