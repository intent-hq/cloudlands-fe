/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import type { Workspace } from '$shared/types';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { NoteNativeLifetime } from '../note-native-lifetime';
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
async function fixture() {
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
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    pages = a.notePagesReducer(pages, action);
    for (const fn of listeners) fn();
    channel.put(action);
    if (action.type === a.pageDocumentPublished.type) publishedHook?.();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 10000,
      physicalReads: 16,
      assemblies: 16,
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
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
    editing,
    seek: vi.fn(),
    fullOperation: vi.fn(),
    selectionChanged(selection) {
      const n = note();
      if (n.document)
        dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document, selection));
    },
  });
  return {
    view,
    window,
    offer,
    note,
    dispatch,
    ledger: () => pages.resourceLedger,
    editing,
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
