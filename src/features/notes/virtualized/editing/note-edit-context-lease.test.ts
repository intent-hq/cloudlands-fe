import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  noteAssemblyResources,
  notePageRequestKey,
  type NoteAssemblyLease,
} from '../note-assembly-reservation';
import { reserveNoteEditContext } from './note-edit-context-lease';
import type { NoteWindow } from '../note-window-reader';
import type { NoteReadPage } from '$lib/client/note-pages';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const identity = { scope, sourceRevision: 'r', snapshotId: 's', expiresAt: '2099-01-01T00:00:00Z' };
const q = { kind: 'context', contextRef: 'detail', maxWireBytes: 8192, maxItems: 64 } as const;
const page: NoteReadPage = { ...identity, kind: 'noteContextPage', items: [], nextCursor: null };
function setup(assemblies = 1) {
  let state = a.initialNotePagesState;
  const listeners = new Set<() => void>();
  let pending: { key: string; assembly: NoteAssemblyLease } | undefined;
  let requests = 0;
  let wireDispatch: ((action: Parameters<typeof a.notePagesReducer>[1]) => void) | undefined;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const listener of [...listeners]) listener();
    if (wireDispatch) {
      wireDispatch(action);
      return;
    }
    if (action.type === a.pageRequested.type) {
      const [, , request, assembly] = (action as ReturnType<typeof a.pageRequested>).payload;
      if (!assembly) throw new Error('Expected assembly');
      requests++;
      const key = notePageRequestKey(request, assembly);
      pending = { key, assembly };
      dispatch(a.pageRequestStarted('w', 'n', 0, key, `ticket:${requests}`, 8192, assembly));
    }
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 0,
      physicalReads: 1,
      assemblies,
    }),
  );
  dispatch(a.pagePanelOpened('w', 'n', 'p'));
  dispatch(
    a.pageStateReceived('w', 'n', 0, {
      scope,
      kind: 'notePageState',
      stateGeneration: '1',
      sourceRevision: 'r',
      attributionGeneration: 'a',
      attributionState: 'ready',
      commentRevision: 'c',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested('w', 'n', 'p', 0));
  const window: NoteWindow = {
    ...identity,
    sourceLength: 3,
    range: { start: 0, end: 3 },
    text: 'abc',
    context: [],
    details: {},
    mapBindings: [],
    documentEnd: true,
    cost: { requests: 2, wireBytes: 500, sourceBytes: 3, contextBytes: 0, assemblyPeakBytes: 500 },
  };
  const original = { owner: 'original', data: 'original-data', control: 'original-control' };
  // Original window construction/retention uses exactly the production reducer path.
  dispatch(a.pageResourcesRequested(original.owner, noteAssemblyResources(original), 12));
  dispatch(
    a.pageWindowSettled('w', 'n', 'p', 0, 1, window, null, {
      sponsor: original.owner,
      resource: original.data,
      owner: 'window-original',
    }),
  );
  dispatch(a.pageResourcesReleased(original.owner));
  return {
    window,
    dispatch,
    setWireDispatch(fn: typeof wireDispatch) {
      wireDispatch = fn;
    },
    port: {
      read: () => state,
      dispatch,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    get state() {
      return state;
    },
    get requests() {
      return requests;
    },
    get listeners() {
      return listeners.size;
    },
    finish(value: NoteReadPage = page) {
      if (!pending) throw new Error('No read');
      dispatch(a.sourcePageReceived('w', 'n', 0, pending.key, value));
    },
    settle() {
      if (!pending) throw new Error('No read');
      dispatch(a.pageReadSettled('w', 'n', 0, pending.key));
      pending = undefined;
    },
  };
}
describe('Redux-backed edit context admission', () => {
  it('reserves before any read and retains DATA after sealing while returning CONTROL', async () => {
    const f = setup(),
      lease = reserveNoteEditContext(f.port, f.window, 'p');
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    expect(ready.grant.window).toBe(f.window);
    expect(ready.grant.identity.expiresAt).toBe(identity.expiresAt);
    expect(f.requests).toBe(0);
    expect(f.state.resourceLedger.used.assemblies).toBe(1);
    const read = ready.read(q);
    f.finish();
    let delivered = false;
    void read.then(() => {
      delivered = true;
    });
    await Promise.resolve();
    expect(delivered).toBe(false);
    f.settle();
    await expect(read).resolves.toEqual(page);
    ready.seal();
    expect(f.state.resourceLedger.used.assemblies).toBe(0);
    expect(ready.current()).toBe(true);
    expect(f.state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    await ready.release();
    expect(ready.current()).toBe(false);
    f.dispatch(workspaceUnmounted('w'));
    expect(f.state.resourceLedger.used.payloadBytes).toBe(0);
    expect(f.listeners).toBe(0);
  });
  it('does not start a read while admission is queued and cancels the queued reservation', async () => {
    const f = setup();
    const blocker = { owner: 'block', data: 'block-data', control: 'block-control' };
    f.dispatch(a.pageResourcesRequested(blocker.owner, noteAssemblyResources(blocker), 12));
    const controller = new AbortController();
    const lease = reserveNoteEditContext(f.port, f.window, 'p', controller.signal);
    const rejected = expect(lease.ready).rejects.toThrow(/superseded/);
    expect(f.requests).toBe(0);
    expect(f.state.resourceLedger.pending).toHaveLength(1);
    controller.abort();
    await rejected;
    expect(f.state.resourceLedger.pending).toHaveLength(0);
    expect(f.requests).toBe(0);
    expect(f.listeners).toBe(0);
  });
  it('invalidates immediately but keeps borrowed window and read debt through actual cancellation settlement', async () => {
    const f = setup(),
      lease = reserveNoteEditContext(f.port, f.window, 'p');
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    const read = ready.read(q);
    const rejected = expect(read).rejects.toThrow(/superseded/);
    lease.cancel();
    expect(ready.current()).toBe(false);
    const release = lease.release();
    expect(lease.release()).toBe(release);
    f.dispatch(workspaceUnmounted('w'));
    expect(f.state.resourceLedger.used.physicalReads).toBe(1);
    expect(f.state.resourceLedger.resources['original-data']).toBeDefined();
    f.finish();
    f.settle();
    await rejected;
    await release;
    expect(f.state.resourceLedger.used.payloadBytes).toBe(0);
    expect(f.state.resourceLedger.used.physicalReads).toBe(0);
    expect(f.listeners).toBe(0);
  });
  it('rejects expiry after a held read settles without exposing the page or refunding early', async () => {
    const f = setup();
    let now = Date.parse(identity.expiresAt) - 1000;
    const lease = reserveNoteEditContext(f.port, f.window, 'p', undefined, () => now);
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    const read = ready.read(q);
    const rejected = expect(read).rejects.toThrow(/expired/);
    now += 1000;
    f.finish();
    expect(ready.current()).toBe(false);
    expect(f.state.resourceLedger.used.physicalReads).toBe(1);
    f.settle();
    await rejected;
    await lease.release();
    expect(f.listeners).toBe(0);
  });
  it('rejects concurrent reads and a seal attempted before actual settlement', async () => {
    const f = setup(),
      lease = reserveNoteEditContext(f.port, f.window, 'p');
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    const read = ready.read(q);
    await expect(ready.read(q)).rejects.toThrow(/Invalid/);
    expect(() => ready.seal()).toThrow(/settled/);
    expect(f.requests).toBe(1);
    f.finish();
    f.settle();
    await read;
    ready.seal();
    await expect(ready.read(q)).rejects.toThrow(/Invalid/);
    await lease.release();
  });
  it('retains a cancelled read through the actual saga transport promise settlement', async () => {
    const f = setup(),
      channel = stdChannel();
    let resolve!: (value: NoteReadPage) => void;
    const transport = vi.fn(
      () =>
        new Promise<NoteReadPage>((r) => {
          resolve = r;
        }),
    );
    const original = appClient.notes.pages;
    appClient.notes.pages = new MockNotePagesClient({
      capabilities: { backendId: 'b', annotations: false },
      read: transport,
    });
    f.setWireDispatch((action) => channel.put(action));
    const task = runSaga(
      { channel, dispatch: f.dispatch, getState: () => ({ notePages: f.state }) },
      notePagesSaga,
    );
    try {
      const lease = reserveNoteEditContext(f.port, f.window, 'p');
      const ready = await lease.ready;
      expect(ready.grant.claim()).toBe(true);
      const read = ready.read(q);
      const rejected = expect(read).rejects.toThrow(/superseded/);
      await vi.waitFor(() => expect(transport).toHaveBeenCalledExactlyOnceWith('w', 'n', q));
      lease.cancel();
      const released = lease.release();
      f.dispatch(workspaceUnmounted('w'));
      await Promise.resolve();
      expect(f.state.resourceLedger.used.physicalReads).toBe(1);
      expect(f.state.resourceLedger.resources['original-data']).toBeDefined();
      resolve(page);
      await rejected;
      await released;
      expect(f.state.resourceLedger.used.physicalReads).toBe(0);
      expect(f.state.resourceLedger.used.payloadBytes).toBe(0);
      expect(f.listeners).toBe(0);
    } finally {
      task.cancel();
      appClient.notes.pages = original;
    }
  });
  it('claims the grant once and enforces one cumulative request budget without refunds', async () => {
    const f = setup();
    f.window.cost.requests = 95;
    const lease = reserveNoteEditContext(f.port, f.window, 'p');
    const ready = await lease.ready;
    await expect(ready.read(q)).rejects.toThrow(/Invalid/);
    expect(ready.grant.claim()).toBe(true);
    expect(ready.grant.claim()).toBe(false);
    const read = ready.read(q);
    f.finish();
    f.settle();
    await read;
    await expect(ready.read({ ...q, contextRef: 'second' })).rejects.toThrow(/Invalid/);
    expect(f.requests).toBe(1);
    await lease.release();
  });
  it('refuses an absent original expiry before acquiring a window or reading', async () => {
    const f = setup();
    delete f.window.expiresAt;
    const lease = reserveNoteEditContext(f.port, f.window, 'p');
    await expect(lease.ready).rejects.toThrow(/unavailable/);
    expect(f.requests).toBe(0);
    expect(f.listeners).toBe(0);
    expect(Object.keys(f.state.resourceLedger.owners)).toEqual(['window-original']);
  });
  it('refuses an equal but foreign window and a mismatched original deadline in a response', async () => {
    const f = setup();
    await expect(reserveNoteEditContext(f.port, { ...f.window }, 'p').ready).rejects.toThrow(
      /unavailable/,
    );
    const lease = reserveNoteEditContext(f.port, f.window, 'p');
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    const read = ready.read(q);
    const rejected = expect(read).rejects.toThrow(/identity/);
    f.finish({ ...page, expiresAt: '2099-01-01T00:00:00.000Z' });
    f.settle();
    await rejected;
    expect(ready.current()).toBe(false);
    await lease.release();
  });
});

it.each(['cancel', 'expiry', 'panel-close', 'revision'] as const)(
  'preserves sealed navigation ownership but rejects %s',
  async (reason) => {
    const f = setup();
    let now = Date.parse(identity.expiresAt) - 1000;
    const lease = reserveNoteEditContext(f.port, f.window, 'p', undefined, () => now);
    const ready = await lease.ready;
    expect(ready.grant.claim()).toBe(true);
    ready.seal();
    f.dispatch(a.pageWindowRequested('w', 'n', 'p', 2));
    expect(ready.current()).toBe(true);
    await expect(ready.read(q)).rejects.toThrow(/Invalid/);
    if (reason === 'cancel') lease.cancel();
    if (reason === 'expiry') now += 1000;
    if (reason === 'panel-close') f.dispatch(a.pagePanelClosed('w', 'n', 'p'));
    if (reason === 'revision')
      f.dispatch(
        a.pageStateReceived('w', 'n', 0, {
          scope,
          kind: 'notePageState',
          sourceRevision: 'r2',
          stateGeneration: '2',
          attributionGeneration: 'a',
          attributionState: 'ready',
          commentRevision: 'c',
          deleted: false,
          invalidation: 'all',
        }),
      );
    expect(ready.current()).toBe(false);
    expect(f.state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    await lease.release();
    f.dispatch(workspaceUnmounted('w'));
    expect(f.state.resourceLedger.used.payloadBytes).toBe(0);
    expect(f.listeners).toBe(0);
  },
);
it('does not extend unsealed read eligibility across navigation', async () => {
  const f = setup(),
    lease = reserveNoteEditContext(f.port, f.window, 'p');
  const ready = await lease.ready;
  expect(ready.grant.claim()).toBe(true);
  f.dispatch(a.pageWindowRequested('w', 'n', 'p', 2));
  expect(ready.current()).toBe(false);
  await expect(ready.read(q)).rejects.toThrow(/superseded/);
  expect(f.requests).toBe(0);
  await lease.release();
});

it('never revives a sealed context after panel close/reopen with another panel keeping the generation alive', async () => {
  const f = setup();
  f.dispatch(a.pagePanelOpened('w', 'n', 'other'));
  const lease = reserveNoteEditContext(f.port, f.window, 'p');
  const ready = await lease.ready;
  expect(ready.grant.claim()).toBe(true);
  ready.seal();
  const generation = f.state.byWorkspaceId.w.notes.n.generation;
  f.dispatch(a.pagePanelClosed('w', 'n', 'p'));
  // Deliberately do not observe current() while the original panel is absent.
  f.dispatch(a.pagePanelOpened('w', 'n', 'p'));
  expect(f.state.byWorkspaceId.w.notes.n.generation).toBe(generation);
  expect(ready.current()).toBe(false);
  expect(f.state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  await lease.release();
  f.dispatch(workspaceUnmounted('w'));
  expect(f.state.resourceLedger.used.payloadBytes).toBe(0);
  expect(f.listeners).toBe(0);
});
