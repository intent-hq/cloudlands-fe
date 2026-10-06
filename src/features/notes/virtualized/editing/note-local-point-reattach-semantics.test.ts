/** TEST ONLY: direct original-Editor lifecycle observation beneath NoteWindowView.
 * This does not add a production remount path or detach session authority.
 * Recorded Store clock/transport, jsdom DOM, controlled timers/async node cleanup
 * are explicitly limited evidence; no live server or heap measurement. */
/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { NoteNativeLifetime } from '../note-native-lifetime';
import type { Node as TiptapNode } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
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
  vi.useRealTimers();
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
  const borrow = editing.borrow!;
  let releaseViewLease: (() => void) | undefined;
  vi.spyOn(editing, 'borrow').mockImplementation((target) => {
    const lease = borrow(target);
    releaseViewLease = lease.release;
    return lease;
  });
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
    releaseViewLease() {
      if (!releaseViewLease) throw new Error('Missing actual view lease');
      releaseViewLease();
    },
    editing,
    onClock(fn?: () => void) {
      clockHook = fn;
    },
    onPublication(fn?: () => void) {
      publishedHook = fn;
    },
    panelRoundTrip() {
      dispatch(a.pagePanelClosed(ws, id, 'panel'));
      dispatch(a.pagePanelOpened(ws, id, 'panel'));
    },
    expire() {
      time = Date.parse(identity.expiresAt);
    },
    unmount() {
      dispatch(workspaceUnmounted(ws));
    },
    async cleanup(retainedFailure = false) {
      const retainedEditor = view.editor;
      try {
        view.destroy();
      } finally {
        // Manual lifetime disposal caches its unmount callback, so a subsequent
        // NoteWindowView.destroy cannot replace it with Editor.destroy.
        retainedEditor?.destroy();
      }
      // A deliberately failed native unmount cannot return its DATA credit.
      if (retainedFailure) void offer.release();
      else await offer.release();
      task.cancel();
      await task.toPromise();
    },
  };
}

function insert(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.view.show(f.window)).toBe(true);
  const editor = f.view.editor!;
  expect(editor.chain().insertContent('X').insertPointAnchor(pointId).run()).toBe(true);
  expect(f.note().document!.length).toBe(59);
  expect(f.note().document!.history).toHaveLength(1);
  expect(f.note().document!.history[0].kind).toBe('local-point');
  expect(f.view.projection!.source).toBe(`aX${literal}b`);
  return editor;
}
function target() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}
function observeLifetime(cleanup?: Promise<void>) {
  const original = NoteNativeLifetime.prototype.extensions;
  const lifetimes: NoteNativeLifetime[] = [];
  const constructed: NodeView[] = [];
  let destroyed = 0;
  vi.spyOn(NoteNativeLifetime.prototype, 'extensions').mockImplementation(function (items) {
    lifetimes.push(this);
    const configured = items.map((e) =>
      e.name === 'commentAnchor'
        ? (e as TiptapNode).extend({
            addNodeView() {
              const factory = this.parent?.();
              return (props) => {
                // Default tests delegate the actual configured NodeView. Only cleanup
                // controls substitute the explicitly controlled async destroy hook.
                const view: NodeView = cleanup
                  ? {
                      dom: document.createElement('span'),
                      destroy() {
                        destroyed++;
                        return cleanup;
                      },
                    }
                  : factory!(props);
                constructed.push(view);
                return view;
              };
            },
          })
        : e,
    );
    return original.call(this, configured);
  });
  return {
    lifetimes,
    constructed,
    destroyed: () => destroyed,
    async cleanupRejected(from: number) {
      // Only objects constructed by the rejected diagnostic call. Observe every
      // controlled cleanup result, including deliberate rejection, before exit.
      return Promise.allSettled(
        constructed.slice(from).map(async (view) => {
          try {
            await view.destroy?.();
          } finally {
            view.dom.parentNode?.removeChild(view.dom);
          }
        }),
      );
    },
  };
}
function localAllocation(f: Awaited<ReturnType<typeof fixture>>) {
  const keys = Object.keys(f.ledger().owners).filter((key) => key.startsWith('local-point:'));
  expect(keys).toHaveLength(1);
  return keys[0];
}
it('observes new native view and configured plugins on the retained original Editor, with exact local history', async () => {
  const f = await fixture();
  try {
    const editor = insert(f),
      oldView = editor.view,
      schema = editor.schema;
    const state = editor.state,
      group = f.note().document!.history[0];
    const plugins = state.plugins.slice();
    editor.unmount();
    expect(oldView.isDestroyed).toBe(true);
    expect(editor.isDestroyed).toBe(true);
    expect(editor.state).toBe(state);
    editor.mount(target());
    expect(editor.view).not.toBe(oldView);
    expect(editor.schema).toBe(schema);
    expect(editor.state.doc).toBe(state.doc);
    expect(editor.state.selection.eq(state.selection)).toBe(true);
    expect(editor.state.plugins.some((p) => !plugins.includes(p))).toBe(true);
    // The configured relay extension returns its existing plugin instance, while
    // other configured factories create new plugins. Neither wholesale identity
    // preservation nor wholly fresh callback binding may be assumed.
    expect(editor.state.plugins.filter((p) => plugins.includes(p)).length).toBeGreaterThan(0);
    expect(f.note().document!.history[0]).toBe(group);
    expect(f.view.history('undo')).toBe(true);
    expect(editor.state.doc.textContent).toBe('ab');
    expect(f.note().document!.cursor).toBe(0);
    expect(f.view.history('redo')).toBe(true);
    expect(editor.state.doc.child(0).child(1).type.name).toBe('commentAnchor');
    expect(f.note().document!.length).toBe(59);
    expect(f.note().document!.history[0]).toBe(group);
    const beforeRefusedCommand = editor.state.doc;
    editor.commands.insertContent('Y');
    expect(editor.state.doc).toBe(beforeRefusedCommand);
    expect(f.note().document!.history[0]).toBe(group);
    expect(f.note().document!.length).toBe(59);
  } finally {
    await f.cleanup();
  }
});
it('keeps copied native factories bound to the original permanently closed lifetime', async () => {
  const observed = observeLifetime();
  const f = await fixture();
  try {
    const editor = insert(f),
      old = observed.lifetimes[0];
    let settled = false;
    await old.dispose(
      () => editor.unmount(),
      () => {
        settled = true;
        f.releaseViewLease();
      },
    );
    expect(settled).toBe(true);
    // Actual CommentAnchor's configured NodeView is a plain span. This does not
    // establish async disposal of arbitrary SvelteRenderer node views.
    expect(observed.constructed.length).toBeGreaterThan(0);
    expect(observed.constructed.every((view) => !('renderer' in view))).toBe(true);
    const replacement = new NoteNativeLifetime();
    expect(replacement.idle).toBe(true);
    // Re-reading extensionManager.nodeViews invokes the retained copied factory;
    // allocating another tracker cannot rebind track. Closed admission now refuses
    // BEFORE invoking the actual retained factory; no product needs cleanup.
    const constructedBefore = observed.constructed.length;
    try {
      expect(() => editor.mount(target())).toThrow('Cannot construct a retired note view');
      expect(observed.constructed.length).toBe(constructedBefore);
    } finally {
      await observed.cleanupRejected(constructedBefore);
    }
    expect(observed.lifetimes).toHaveLength(1);
    expect(old.idle).toBe(false);
    expect(f.note().document!.length).toBe(59);
    await replacement.dispose(
      () => {},
      () => {},
    );
  } finally {
    await f.cleanup();
  }
});
it('withholds physical release during controlled native unmount and rejects reattachment after settlement', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let drop: (() => void) | undefined;
  const observed = observeLifetime(pending),
    f = await fixture();
  try {
    const editor = insert(f),
      old = observed.lifetimes[0];
    drop = f.offer.retain();
    const before = f.note().document;
    const allocation = localAllocation(f),
      allocationRecord = f.ledger().owners[allocation];
    const bytes = f.ledger().used.payloadBytes;
    let released = false;
    const disposal = old.dispose(
      () => editor.unmount(),
      () => {
        released = true;
        f.releaseViewLease();
      },
    );
    await Promise.resolve();
    expect(observed.destroyed()).toBe(1);
    expect(released).toBe(false);
    expect(old.idle).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(bytes);
    expect(f.ledger().owners[allocation]).toBe(allocationRecord);
    // This diagnostic deliberately exercises the existing refusal, not a new
    // session mount operation; no successful mount is claimed while IO is held.
    const constructedBefore = observed.constructed.length;
    try {
      expect(() => editor.mount(target())).toThrow('Cannot construct a retired note view');
      expect(observed.constructed.length).toBe(constructedBefore);
    } finally {
      finish();
      await observed.cleanupRejected(constructedBefore);
    }
    finish();
    await disposal;
    expect(released).toBe(true);
    expect(f.note().document).toBe(before);
    expect(f.ledger().owners[allocation]).toBe(allocationRecord);
    drop();
    expect(f.ledger().owners[allocation]).toBeUndefined();
  } finally {
    finish();
    drop?.();
    await f.cleanup();
  }
});
it('retains the exact local allocation after rejected cleanup and refuses factory construction', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const observed = observeLifetime(pending),
    f = await fixture();
  try {
    const editor = insert(f),
      old = observed.lifetimes[0];
    const saved = f.note().document;
    const allocation = localAllocation(f),
      record = f.ledger().owners[allocation];
    let released = false;
    const disposed = old.dispose(
      () => editor.unmount(),
      () => {
        released = true;
        f.releaseViewLease();
      },
    );
    const failure = expect(disposed).rejects.toThrow('controlled unmount failure');
    reject(new Error('controlled unmount failure'));
    await failure;
    expect(released).toBe(false);
    expect(f.ledger().owners[allocation]).toBe(record);
    const constructedBefore = observed.constructed.length;
    try {
      expect(() => editor.mount(target())).toThrow('Cannot construct a retired note view');
      expect(observed.constructed.length).toBe(constructedBefore);
    } finally {
      await observed.cleanupRejected(constructedBefore);
    }
    expect(f.note().document).toBe(saved);
  } finally {
    await f.cleanup(true);
  }
});
it.each(['expiry', 'panel', 'loss'] as const)(
  'does not revive local history after %s across direct native reattachment',
  async (kind) => {
    const f = await fixture();
    try {
      const editor = insert(f),
        saved = f.note().document;
      editor.unmount();
      if (kind === 'expiry') f.expire();
      else if (kind === 'panel') f.panelRoundTrip();
      else f.offer.cancel();
      editor.mount(target());
      expect(f.view.history('undo')).toBe(false);
      expect(f.note().document!.history).toBe(saved!.history);
      expect(f.note().document!.dirty).toBe(saved!.dirty);
      expect(f.note().document!.length).toBe(59);
      expect(f.view.history('undo')).toBe(false);
    } finally {
      await f.cleanup();
    }
  },
);
it('observes both old and new mount create callbacks on the second native view before any epoch guard exists', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = await fixture();
  try {
    const editor = insert(f),
      first = editor.view;
    const creates: unknown[] = [];
    editor.on('create', () => creates.push(editor.view));
    editor.unmount();
    editor.mount(target());
    const second = editor.view;
    expect(second).not.toBe(first);
    expect(creates).toHaveLength(0);
    await vi.runOnlyPendingTimersAsync();
    // Observed vulnerability/required future fence, not a claimed safe attach.
    expect(creates).toEqual([second, second]);
    expect(f.note().document!.length).toBe(59);
  } finally {
    await f.cleanup();
  }
});
it('old mount autofocus reaches the reattached view and remains a callback boundary', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = await fixture();
  try {
    const editor = insert(f);
    editor.setOptions({ autofocus: 'end' });
    const getCommands = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(editor),
      'commands',
    )!.get!;
    const focused: unknown[] = [];
    vi.spyOn(editor, 'commands', 'get').mockImplementation(() => {
      const commands = getCommands.call(editor) as typeof editor.commands;
      return {
        ...commands,
        focus: (...args: Parameters<typeof commands.focus>) => {
          focused.push(editor.view);
          return commands.focus(...args);
        },
      };
    });
    editor.unmount();
    editor.mount(target());
    const second = editor.view,
      saved = f.note().document;
    await vi.runOnlyPendingTimersAsync();
    expect(focused).toEqual([second, second]);
    // Native selection callbacks can revoke this restricted producer; neither
    // autofocus nor create is a proof of domain publication/readiness.
    expect(f.note().document!.history).toBe(saved!.history);
  } finally {
    await f.cleanup();
  }
});

it('create callback loss on the reattached view cannot revive domain authority', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = await fixture();
  try {
    const editor = insert(f),
      saved = f.note().document;
    const attempts: boolean[] = [];
    editor.on('create', () => {
      f.offer.cancel();
      attempts.push(f.view.history('undo'));
    });
    editor.unmount();
    editor.mount(target());
    await vi.runOnlyPendingTimersAsync();
    expect(attempts).toEqual([false, false]);
    expect(f.note().document!.history).toBe(saved!.history);
    expect(f.note().document!.dirty).toBe(saved!.dirty);
    expect(f.view.history('undo')).toBe(false);
  } finally {
    await f.cleanup();
  }
});
