import { noteWindowSaga } from './note-window-saga';
import { createNoteReadingSurface } from '$features/notes/virtualized/note-reading-surface';
import { canonicalGrowthFixture } from '$features/notes/virtualized/__tests__/canonical-growth-fixture';
import { readNoteReceiptPage } from '$lib/client/note-receipt-reader';
import { composeNoteEdits } from '$features/notes/virtualized/editing/note-edit-plan';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import type {
  NoteSpliceOperation,
  NotePageState,
  NoteSourcePage,
  NotePagingCapabilities,
} from '$lib/client/note-pages';
import * as a from '../note-pages-slice';
import { notePagesSaga } from './note-pages-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
const scope = { backendId: 'db-a', workspaceId: 'ws-a', noteId: 'spec', noteInstanceId: 'inc-a' };
const tuple: NotePageState = {
  kind: 'notePageState',
  scope,
  stateGeneration: '10',
  sourceRevision: 'r:7',
  attributionGeneration: 'a:2',
  attributionState: 'ready',
  commentRevision: 'c:4',
  deleted: false,
  invalidation: 'all',
};
const page: NoteSourcePage = {
  kind: 'noteSourcePage',
  scope,
  sourceRevision: 'r:7',
  snapshotId: 'snap',
  expiresAt: '2099-01-01T00:00:00.000Z',
  sourceLength: 3,
  range: { start: 0, end: 3 },
  text: 'A😀',
  nextCursor: null,
  previousCursor: null,
  contextRef: 'ctx',
  metadataRef: 'meta',
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const original = appClient.notes.pages;
const tasks: Array<ReturnType<typeof runSaga>> = [];
afterEach(() => {
  tasks.forEach((t) => t.cancel());
  tasks.length = 0;
  appClient.notes.pages = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function run(client: MockNotePagesClient) {
  appClient.notes.pages = client;
  const channel = stdChannel();
  let state = a.notePagesReducer(
    a.initialNotePagesState,
    a.pageResourceLimitsConfigured({
      payloadBytes: 64 * 1024 * 1024,
      stringUnits: 64 * 1024 * 1024,
      objectNodes: 64 * 1024 * 1024,
      domNodes: 0,
      physicalReads: 4,
      assemblies: 1,
    }),
  );
  const listeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const listener of [...listeners]) listener();
    channel.put(action);
    return action;
  };
  let windowOwner: ReturnType<typeof runSaga> | undefined;
  let windowFork: number | undefined;
  const task = runSaga(
    {
      channel,
      sagaMonitor: {
        effectTriggered({ effectId, effect }) {
          if (effect.type === 'FORK' && effect.payload.fn === noteWindowSaga) windowFork = effectId;
        },
        effectResolved(effectId, result) {
          if (effectId === windowFork) windowOwner = result;
        },
      },
      dispatch,
      getState: () => ({ notePages: state }),
      context: {
        reduxStore: {
          getState: () => ({ notePages: state }),
          dispatch,
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        },
      },
    },
    notePagesSaga,
  );
  tasks.push(task);
  return {
    dispatch,
    state: () => state,
    task,
    cancelWindowOwner: () => {
      expect(windowOwner).toBeDefined();
      windowOwner!.cancel();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

it('reserves physical reads across notes and wakes another note after real settlement', async () => {
  const pending = Array.from({ length: 3 }, () => deferred<NoteSourcePage>());
  const read = vi.fn((_ws: string, note: string) => pending[Number(note)].promise);
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(
    a.pageResourceLimitsConfigured({ ...r.state().resourceLedger.limit, physicalReads: 2 }),
  );
  for (let i = 0; i < 3; i++) r.dispatch(a.pagePanelOpened('ws-a', String(i), 'p'));
  await flush();
  for (let i = 0; i < 3; i++) client.push({ ...tuple, scope: { ...scope, noteId: String(i) } });
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(r.state().resourceLedger.used.physicalReads).toBe(2);
  r.dispatch(a.pagePanelClosed('ws-a', '0', 'p'));
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(r.state().resourceLedger.used.physicalReads).toBe(2);
  pending[0].resolve({ ...page, scope: { ...scope, noteId: '0' } });
  await flush();
  expect(read).toHaveBeenCalledTimes(3);
  expect(r.state().resourceLedger.used.physicalReads).toBe(2);
  for (let i = 1; i < 3; i++)
    pending[i].resolve({ ...page, scope: { ...scope, noteId: String(i) } });
  await flush();
  expect(r.state().resourceLedger.used.physicalReads).toBe(0);
  expect(r.state().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
});

it('cancels a queued read on workspace closure without starting physical IO', async () => {
  const pending = deferred<NoteSourcePage>();
  const read = vi.fn(() => pending.promise);
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(
    a.pageResourceLimitsConfigured({ ...r.state().resourceLedger.limit, physicalReads: 1 }),
  );
  for (const note of ['0', '1']) r.dispatch(a.pagePanelOpened('ws-a', note, 'p'));
  await flush();
  for (const note of ['0', '1']) client.push({ ...tuple, scope: { ...scope, noteId: note } });
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(r.state().resourceLedger.pending).toHaveLength(1);
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.pending).toHaveLength(0);
  expect(r.state().resourceLedger.used.physicalReads).toBe(1);
  pending.resolve({ ...page, scope: { ...scope, noteId: '0' } });
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(r.state().resourceLedger.used.physicalReads).toBe(0);
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
});
it('deduplicates panels and requests; closing one panel leaves the other subscription alive', async () => {
  const pending = deferred<NoteSourcePage>();
  const read = vi.fn(() => pending.promise);
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p1'));
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p2'));
  await flush();
  expect(client.subscriptionCount).toBe(1);
  client.push(tuple);
  await flush();
  const request = {
    kind: 'source' as const,
    at: 0,
    sourceRevision: 'r:7',
    noteInstanceId: 'inc-a',
  };
  r.dispatch(a.pageRequested('ws-a', 'spec', request));
  r.dispatch(a.pageRequested('ws-a', 'spec', request));
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  r.dispatch(a.pagePanelClosed('ws-a', 'spec', 'p1'));
  expect(client.subscriptionCount).toBe(1);
  pending.resolve(page);
  await flush();
  expect(Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.pages)).toEqual([page]);
  r.dispatch(a.pagePanelClosed('ws-a', 'spec', 'p2'));
  expect(client.subscriptionCount).toBe(0);
});
it('ignores a late read after reconnect and waits for the authoritative snapshot', async () => {
  const pending = deferred<NoteSourcePage>();
  const read = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ ...page, sourceRevision: 'r:8' });
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  client.reconnect();
  await flush();
  pending.resolve(page);
  await flush();
  expect(Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.pages)).toEqual([]);
  expect(read).toHaveBeenCalledTimes(1);
  client.push({ ...tuple, stateGeneration: '11', sourceRevision: 'r:8' });
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.pages)[0]).toMatchObject({
    sourceRevision: 'r:8',
  });
});
it('unmount cancels subscriptions and rejects late reads while preserving drafts and uncertain saves', async () => {
  const pending = deferred<NoteSourcePage>();
  const save = deferred<never>();
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: () => pending.promise,
    save: () => save.promise,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: [{ start: 0, end: 1, text: 'draft' }],
    selection: {
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
      anchor: 0,
      head: 1,
    },
  };
  r.dispatch(a.pageDraftChanged('ws-a', 'spec', draft));
  r.dispatch(
    a.pageSaveRequested(
      'ws-a',
      'spec',
      {
        scope,
        baseRevision: 'r:7',
        operationId: 'op',
        payloadDigest: 'digest',
        expiresAt: '2099-01-01T00:00:00.000Z',
        splices: draft.splices,
      },
      1,
    ),
  );
  await flush();
  r.dispatch(workspaceUnmounted('ws-a'));
  pending.resolve(page);
  await flush();
  expect(client.subscriptionCount).toBe(0);
  const n = r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(n.drafts).toEqual([draft]);
  expect(n.pending?.operation.operationId).toBe('op');
  expect(n.pages).toEqual({});
});
it('falls back explicitly without issuing page calls when the daemon has no capability', async () => {
  const read = vi.fn();
  const client = new MockNotePagesClient({ capabilities: null, read });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.status).toBe('legacy');
  expect(read).not.toHaveBeenCalled();
  expect(client.subscriptionCount).toBe(0);
});

it('recovers an expired read through a fresh bounded subscription and snapshot', async () => {
  const read = vi.fn().mockRejectedValueOnce({ code: 'note-page-expired' }).mockResolvedValue(page);
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  expect(client.subscriptionCount).toBe(1);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.pages).toEqual({});
  client.push(tuple);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.pages)).toEqual([page]);
});
it('retains later typing and history when a lost save acknowledgement is recovered after switching workspace', async () => {
  const operation = {
    scope,
    baseRevision: 'r:7',
    operationId: 'op',
    payloadDigest: 'digest',
    expiresAt: '2099-01-01T00:00:00.000Z',
    splices: [{ start: 0, end: 1, text: 'saved' }],
  };
  const receipt = {
    kind: 'noteCommitReceipt' as const,
    outcome: 'committed' as const,
    scope,
    operationId: 'op',
    payloadDigest: 'digest',
    beforeRevision: 'r:7',
    afterRevision: 'r:8',
    sourceLength: 7,
    mappingRef: 'map',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    receiptExpiresAt: '2099-01-01T00:00:00.000Z',
    invalidation: 'all' as const,
  };
  const save = vi.fn().mockRejectedValue(new Error('ack lost'));
  const status = vi.fn().mockResolvedValue(receipt);
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async () => page,
    save,
    status,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices: operation.splices,
    selection: {
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
      anchor: 0,
      head: 1,
    },
  };
  r.dispatch(a.pageDraftChanged('ws-a', 'spec', draft));
  r.dispatch(a.pageSaveRequested('ws-a', 'spec', operation, 1));
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.pending?.status).toBe('unknown');
  r.dispatch(a.pageDraftChanged('ws-a', 'spec', { ...draft, sequence: 2 }));
  r.dispatch(workspaceUnmounted('ws-a'));
  r.dispatch(a.pageSaveRetryRequested('ws-a', 'spec'));
  await flush();
  expect(status).toHaveBeenCalledWith(operation);
  expect(save).toHaveBeenCalledTimes(1);
  const n = r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(n.drafts.map((d) => d.sequence)).toEqual([2]);
  expect(n.history).toHaveLength(2);
  expect(n.receipts).toEqual([receipt]);
  expect(n.needsReconcile).toBe(true);
});
it('isolates identical note IDs and revisions across concurrent workspaces', async () => {
  const other = { ...scope, workspaceId: 'ws-b', noteInstanceId: 'inc-b' };
  const read = vi.fn(async (ws: string) => ({ ...page, scope: ws === 'ws-a' ? scope : other }));
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pagePanelOpened('ws-b', 'spec', 'p'));
  await flush();
  client.push(tuple);
  client.push({ ...tuple, scope: other });
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(Object.values(r.state().byWorkspaceId['ws-b'].notes.spec.pages)[0].scope).toEqual(other);
  r.dispatch(workspaceUnmounted('ws-a'));
  expect(client.subscriptionCount).toBe(1);
  expect(Object.values(r.state().byWorkspaceId['ws-b'].notes.spec.pages)).toHaveLength(1);
});
it('stops repeated stale-page recovery until explicit refresh and never falls back to full reads', async () => {
  const read = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('expired'), { code: 'note-page-expired' }));
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  client.push(tuple);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.status).toBe('error');
  r.dispatch(a.pageRefreshRequested('ws-a', 'spec'));
  await flush();
  client.push(tuple);
  await flush();
  expect(read).toHaveBeenCalledTimes(3);
});
it('keeps capability transport failure recoverable without selecting legacy', async () => {
  const client = new MockNotePagesClient({ capabilities: null, read: async () => page });
  vi.spyOn(client, 'capabilities').mockRejectedValue(new Error('offline'));
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.status).toBe('error');
  expect(r.task.isRunning()).toBe(true);
});

it('bounds physical reads across revision invalidation and admits the latest demand when they settle', async () => {
  const pending = deferred<NoteSourcePage>();
  let active = 0,
    peak = 0;
  const read = vi.fn(() => {
    active++;
    peak = Math.max(peak, active);
    return pending.promise.finally(() => active--);
  });
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  for (let i = 0; i < 12; i++) {
    client.push({ ...tuple, stateGeneration: String(10 + i), sourceRevision: `r:${7 + i}` });
    await flush();
  }
  expect(peak).toBeLessThanOrEqual(4);
  pending.resolve(page);
  await flush();
  expect(read).toHaveBeenCalledTimes(5);
  expect(read.mock.calls.at(-1)).toEqual([
    'ws-a',
    'spec',
    expect.objectContaining({ sourceRevision: 'r:18' }),
  ]);
});
it.each([false, true])(
  'renegotiates lost capability on reconnect and retains dirty ownership: %s',
  async (dirty) => {
    const client = new MockNotePagesClient({
      capabilities: { backendId: 'db-a', annotations: false },
      read: async () => page,
    });
    const caps = vi
      .spyOn(client, 'capabilities')
      .mockResolvedValueOnce({ backendId: 'db-a', annotations: false })
      .mockResolvedValue(null);
    const r = run(client);
    r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
    await flush();
    client.push(tuple);
    await flush();
    if (dirty)
      r.dispatch(
        a.pageDraftChanged('ws-a', 'spec', {
          scope,
          sequence: 1,
          baseRevision: 'r:7',
          splices: [{ start: 0, end: 1, text: 'draft' }],
          selection: { anchor: 0, head: 1, anchorAffinity: 'before', headAffinity: 'after' },
        }),
      );
    client.reconnect();
    await flush();
    expect(caps).toHaveBeenCalledTimes(2);
    const n = r.state().byWorkspaceId['ws-a'].notes.spec;
    expect(n.status).toBe(dirty ? 'error' : 'legacy');
    expect(n.drafts).toHaveLength(dirty ? 1 : 0);
  },
);
it('classifies an explicit revision conflict without losing the draft or save identity', async () => {
  const failure = Object.assign(new Error('Revision conflict'), {
    code: 'note-revision-conflict',
    rpcCode: -32005,
    data: { code: 'note-revision-conflict', currentRevision: 'r:8' },
  });
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async () => page,
    save: async () => {
      throw failure;
    },
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  const splices = [{ start: 0, end: 1, text: 'draft' }];
  const draft = {
    scope,
    sequence: 1,
    baseRevision: 'r:7',
    splices,
    selection: {
      anchor: 0,
      head: 1,
      anchorAffinity: 'before' as const,
      headAffinity: 'after' as const,
    },
  };
  r.dispatch(a.pageDraftChanged('ws-a', 'spec', draft));
  r.dispatch(
    a.pageSaveRequested(
      'ws-a',
      'spec',
      {
        scope,
        baseRevision: 'r:7',
        operationId: 'op',
        payloadDigest: 'digest',
        expiresAt: '2099-01-01T00:00:00Z',
        splices,
      },
      1,
    ),
  );
  await flush();
  const n = r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(n.drafts).toEqual([draft]);
  expect(n.pending?.status).toBe('conflict');
});

it('accepts a clean replacement backend only after reconnect renegotiation', async () => {
  const replacement = { ...scope, backendId: 'db-b', noteInstanceId: 'inc-b' };
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async () => ({ ...page, scope: replacement }),
  });
  vi.spyOn(client, 'capabilities')
    .mockResolvedValueOnce({ backendId: 'db-a', annotations: false })
    .mockResolvedValue({ backendId: 'db-b', annotations: false });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  client.reconnect();
  client.push({ ...tuple, scope: replacement, stateGeneration: '1' });
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.state?.scope).toEqual(replacement);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.status).toBe('ready');
});

it('invalidates prior reads before awaiting a reconnect capability handshake', async () => {
  const outstanding = deferred<NoteSourcePage>(),
    hello = deferred<NotePagingCapabilities | null>();
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: () => outstanding.promise,
  });
  vi.spyOn(client, 'capabilities')
    .mockResolvedValueOnce({ backendId: 'db-a', annotations: false })
    .mockReturnValueOnce(hello.promise);
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  client.reconnect();
  await flush();
  outstanding.resolve(page);
  await flush();
  const duringHello = r.state().byWorkspaceId['ws-a'].notes.spec;
  hello.resolve({ backendId: 'db-a', annotations: false });
  await flush();
  expect(duringHello.pages).toEqual({});
  expect(duringHello.status).not.toBe('ready');
});
it.each(['unsupported', 'error'])(
  'ignores a superseded reconnect hello outcome: %s',
  async (outcome) => {
    const olderHello = deferred<NotePagingCapabilities | null>();
    const client = new MockNotePagesClient({
      capabilities: { backendId: 'db-a', annotations: false },
      read: async () => page,
    });
    const oldResult = olderHello.promise.then((value) => {
      if (outcome === 'error') throw new Error('old connection offline');
      return value;
    });
    const caps = vi
      .spyOn(client, 'capabilities')
      .mockResolvedValueOnce({ backendId: 'db-a', annotations: false })
      .mockReturnValueOnce(oldResult)
      .mockResolvedValue({ backendId: 'db-a', annotations: false });
    const r = run(client);
    r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
    await flush();
    client.push(tuple);
    await flush();
    client.reconnect();
    await flush();
    client.reconnect();
    await flush();
    olderHello.resolve(null);
    await flush();
    client.push({ ...tuple, stateGeneration: '11' });
    await flush();
    expect(r.state().byWorkspaceId['ws-a'].notes.spec.status).toBe('ready');
    expect(client.subscriptionCount).toBe(1);
    expect(caps).toHaveBeenCalledTimes(3);
  },
);

it('assembles a renderer window through real page ownership and bounded context requests', async () => {
  const read = vi.fn(async (_ws, _id, q) =>
    q.kind === 'context'
      ? {
          kind: 'noteContextPage',
          scope,
          sourceRevision: 'r:7',
          snapshotId: 'snap',
          expiresAt: page.expiresAt,
          items: [
            {
              kind: 'boundary',
              id: 'p',
              construct: 'paragraph',
              sourceRange: { start: 0, end: 3 },
              continuationBefore: false,
              continuationAfter: false,
            },
          ],
          nextCursor: null,
        }
      : page,
  );
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  client.push(tuple);
  await flush();
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.windows.p.value?.text).toBe('A😀');
  expect(read.mock.calls.some((c) => c[2].kind === 'context')).toBe(true);
  expect(Object.keys(r.state().physicalReads)).toHaveLength(0);
  expect(
    Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.pages).length,
  ).toBeLessThanOrEqual(4);
});

it('retains assembly inputs until cancellation and never publishes after its panel closes', async () => {
  const pending = deferred<any>();
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async (_ws, _id, q) => (q.kind === 'context' ? pending.promise : page),
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  expect(Object.keys(r.state().physicalReads)).toHaveLength(1);
  expect(
    Object.keys(r.state().resourceLedger.owners).some((owner) => owner.startsWith('assembly:')),
  ).toBe(true);
  r.dispatch(a.pagePanelClosed('ws-a', 'spec', 'p'));
  await flush();
  expect(
    Object.keys(r.state().resourceLedger.owners).some((owner) => owner.startsWith('assembly:')),
  ).toBe(false);
  expect(r.state().resourceLedger.used.physicalReads).toBe(1);
  pending.resolve({
    kind: 'noteContextPage',
    scope,
    sourceRevision: 'r:7',
    snapshotId: 'snap',
    expiresAt: page.expiresAt,
    items: [],
    nextCursor: null,
  });
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.windows.p).toBeUndefined();
  expect(Object.keys(r.state().physicalReads)).toHaveLength(0);
});

it('reserves window completion before reading and transfers data ownership after assembly', async () => {
  const pending = deferred<any>();
  const read = vi.fn(async (_ws, _id, q) => (q.kind === 'context' ? pending.promise : page));
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  client.push(tuple);
  await flush();
  expect(r.state().resourceLedger.used.assemblies).toBe(1);
  expect(r.state().resourceLedger.used.physicalReads).toBe(1);
  expect(read.mock.calls).toHaveLength(2);
  pending.resolve({
    kind: 'noteContextPage',
    scope,
    sourceRevision: 'r:7',
    snapshotId: 'snap',
    expiresAt: page.expiresAt,
    items: [],
    nextCursor: null,
  });
  await flush();
  await flush();
  const note = r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(note.windows.p.value?.text).toBe('A😀');
  expect(note.windows.p.resourceOwner).toMatch(/^window:/);
  expect(r.state().resourceLedger.used.assemblies).toBe(0);
  expect(r.state().resourceLedger.used.physicalReads).toBe(0);
  expect(r.state().resourceLedger.owners[note.windows.p.resourceOwner!]).toHaveLength(1);
  r.dispatch(
    a.pageWindowRetained(
      'ws-a',
      'spec',
      'p',
      note.generation,
      note.windows.p.value!,
      'runtime-view',
    ),
  );
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  expect(Object.keys(r.state().resourceLedger.owners)).toEqual(['runtime-view']);
  r.dispatch(a.pageResourcesReleased('runtime-view'));
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
});

it('refreshes an open window at its retained position after authoritative revision changes', async () => {
  let revision = 'r:7';
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async (_ws, _id, q) =>
      q.kind === 'context'
        ? {
            kind: 'noteContextPage',
            scope,
            sourceRevision: revision,
            snapshotId: revision,
            expiresAt: page.expiresAt,
            items: [],
            nextCursor: null,
          }
        : {
            ...page,
            sourceRevision: revision,
            snapshotId: revision,
            text: revision === 'r:7' ? 'A😀' : 'B😀',
          },
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  client.push(tuple);
  await flush();
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.windows.p.value?.text).toBe('A😀');
  revision = 'r:8';
  client.push({ ...tuple, stateGeneration: '11', sourceRevision: revision });
  await flush();
  await flush();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.windows.p.value?.text).toBe('B😀');
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.windows.p.value?.sourceRevision).toBe('r:8');
});

it('finishes every visible panel window after saturated physical reads drain', async () => {
  const waiting: Array<() => void> = [];
  let outstanding = 0,
    peak = 0;
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read: async (_ws, _id, q) => {
      outstanding++;
      peak = Math.max(peak, outstanding);
      await new Promise<void>((resolve) => waiting.push(resolve));
      outstanding--;
      if (q.kind === 'context')
        return {
          kind: 'noteContextPage',
          scope,
          sourceRevision: 'r:7',
          snapshotId: 'snap',
          expiresAt: page.expiresAt,
          items: [],
          nextCursor: null,
        };
      const start = q.kind === 'source' ? (q.at ?? 0) : 0;
      return {
        ...page,
        text: 'abc',
        range: { start, end: start + 3 },
        sourceLength: 100,
        contextRef: `ctx-${start}`,
      };
    },
  });
  const r = run(client);
  for (let i = 0; i < 6; i++) {
    r.dispatch(a.pagePanelOpened('ws-a', 'spec', `p${i}`));
    r.dispatch(a.pageWindowRequested('ws-a', 'spec', `p${i}`, i * 10));
  }
  await flush();
  client.push(tuple);
  await flush();
  for (let turn = 0; turn < 12; turn++) {
    waiting.splice(0).forEach((resolve) => resolve());
    await flush();
    await flush();
  }
  const windows = Object.values(r.state().byWorkspaceId['ws-a'].notes.spec.windows);
  expect(windows).toHaveLength(6);
  expect(windows.map((window) => window.error)).toEqual(Array(6).fill(null));
  expect(windows.map((w) => w.value?.range.start).sort((a, b) => a! - b!)).toEqual([
    0, 10, 20, 30, 40, 50,
  ]);
  expect(peak).toBeLessThanOrEqual(4);
  expect(outstanding).toBe(0);
});

// Real edit composition and digest, controlled RPC outcomes. These controls do
// not stand in for the backend's atomic receipt transaction.
async function draftSaveHarness() {
  const { webcrypto } = await import('node:crypto');
  vi.stubGlobal('crypto', webcrypto);
  const save = vi.fn(async (_operation: NoteSpliceOperation) => {
    throw new Error('acknowledgement lost');
  });
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    save,
    read: async (_ws, _id, q) =>
      q.kind === 'context'
        ? {
            kind: 'noteContextPage',
            scope,
            sourceRevision: 'r:7',
            snapshotId: 'snap',
            expiresAt: page.expiresAt,
            items: [],
            nextCursor: null,
          }
        : page,
  });
  const r = run(client);
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  client.push(tuple);
  await flush();
  await flush();
  await vi.waitFor(() => {
    const window = r.state().byWorkspaceId['ws-a'].notes.spec.windows.p;
    expect(window.error).toBeNull();
    expect(window.value).toBeDefined();
  });
  // Controlled document-owner publication: legacy pageDraftChanged deliberately
  // gates an already initialized document. Native transaction/history behavior is
  // covered by the document-owner suites; this fixture drives save scheduling.
  const draft = (sequence: number, start: number, end: number, text: string) => {
    const note = r.state().byWorkspaceId['ws-a'].notes.spec;
    const before = note.document!;
    const splices = [{ start, end, text }];
    const after = {
      ...before,
      generation: before.generation + 1,
      length: before.length + text.length - end + start,
      dirty: composeNoteEdits(before.baseLength, [{ splices: before.dirty }, { splices }]),
      selection: {
        anchor: start + text.length,
        head: start + text.length,
        anchorAffinity: 1 as const,
        headAffinity: 1 as const,
      },
    };
    r.dispatch(a.pageDocumentPublished('ws-a', 'spec', note.generation, before, after, splices));
    expect(r.state().byWorkspaceId['ws-a'].notes.spec.history.at(-1)?.sequence).toBe(sequence);
  };
  return { ...r, save, client, draft };
}

it('builds one base-revision save from local typing and retains its lost-ack identity', async () => {
  const r = await draftSaveHarness();
  r.draft(1, 0, 1, 'first');
  r.draft(2, 1, 5, 'inal');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await vi.waitFor(() => expect(r.save).toHaveBeenCalledTimes(1));
  const pending = r.state().byWorkspaceId['ws-a'].notes.spec.pending!;
  expect(pending.operation.splices).toEqual([{ start: 0, end: 1, text: 'final' }]);
  expect(pending.operation.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(pending.throughSequence).toBe(2);
  r.draft(3, 5, 5, '!');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await flush();
  expect(r.save).toHaveBeenCalledTimes(1);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.pending?.operation).toBe(pending.operation);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.drafts).toHaveLength(3);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.history).toHaveLength(1);
  vi.unstubAllGlobals();
});

it('does not adopt a prepared save when the document changes while hashing', async () => {
  const r = await draftSaveHarness();
  const { webcrypto } = await import('node:crypto');
  const hashed = deferred<ArrayBuffer>();
  const digest = vi.spyOn(webcrypto.subtle, 'digest').mockReturnValue(hashed.promise);
  r.draft(1, 0, 1, 'local');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1));
  expect(r.save).not.toHaveBeenCalled();
  r.client.push({ ...tuple, stateGeneration: '11', sourceRevision: 'r:8' });
  await vi.waitFor(() =>
    expect(r.state().byWorkspaceId['ws-a'].notes.spec.state?.sourceRevision).toBe('r:8'),
  );
  hashed.resolve(new ArrayBuffer(32));
  await flush();
  expect(r.task.isRunning()).toBe(true);
  expect(r.save).not.toHaveBeenCalled();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.drafts[0].splices[0].text).toBe('local');
  vi.unstubAllGlobals();
});

it('saves only the captured prefix when typing continues during hashing', async () => {
  const r = await draftSaveHarness();
  const { webcrypto } = await import('node:crypto');
  const actualDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  const hashed = deferred<ArrayBuffer>();
  const digest = vi.spyOn(webcrypto.subtle, 'digest').mockReturnValue(hashed.promise);
  r.draft(1, 0, 1, 'first');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1));
  expect(r.save).not.toHaveBeenCalled();
  r.draft(2, 5, 5, '!');
  const call = digest.mock.calls[0];
  hashed.resolve(await actualDigest(call[0], call[1]));
  await vi.waitFor(() => expect(r.save).toHaveBeenCalledTimes(1));
  const n = r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(n.pending?.throughSequence).toBe(1);
  expect(n.pending?.operation.splices).toEqual([{ start: 0, end: 1, text: 'first' }]);
  expect(n.drafts.map((d) => d.sequence)).toEqual([1, 2]);
  expect(n.drafts[1].splices).toEqual([{ start: 5, end: 5, text: '!' }]);
  expect(digest).toHaveBeenCalledTimes(1);
  expect(r.task.isRunning()).toBe(true);
});

it('keeps oversized edits dirty and only clears a proven local insertion/inverse prefix', async () => {
  const r = await draftSaveHarness();
  r.draft(1, 0, 0, '🦀');
  r.draft(2, 0, 2, '');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await flush();
  expect(r.save).not.toHaveBeenCalled();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.drafts).toHaveLength(0);
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.history).toHaveLength(1);
  r.draft(3, 0, 1, 'x'.repeat(16_385));
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await flush();
  expect(r.save).not.toHaveBeenCalled();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.error).toContain('staged save');
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.drafts[0].splices[0].text).toHaveLength(16_385);
  vi.unstubAllGlobals();
});

it('uses captured save identity for IO and lost-ACK state despite caller mutation', async () => {
  const r = await draftSaveHarness();
  r.draft(1, 0, 1, 'X');
  const operation = {
    scope: { ...scope },
    baseRevision: 'r:7',
    operationId: 'captured-before-io',
    payloadDigest: 'a'.repeat(64),
    expiresAt: '2099-01-01T00:00:00.000Z',
    splices: r.state().byWorkspaceId['ws-a'].notes.spec.document!.dirty.map((s) => ({ ...s })),
  };
  r.save.mockImplementation(async (sent) => {
    expect(sent).not.toBe(operation);
    expect(sent.operationId).toBe('captured-before-io');
    operation.operationId = 'caller-mutated-id';
    operation.splices[0].text = 'caller-mutated-text';
    expect(sent.splices[0].text).toBe('X');
    throw new Error('acknowledgement lost');
  });
  r.dispatch(a.pageSaveRequested('ws-a', 'spec', operation, 1));
  await vi.waitFor(() =>
    expect(r.state().byWorkspaceId['ws-a'].notes.spec.pending?.status).toBe('unknown'),
  );
  expect(r.save).toHaveBeenCalledOnce();
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.pending?.operation.operationId).toBe(
    'captured-before-io',
  );
  expect(r.state().byWorkspaceId['ws-a'].notes.spec.pending?.document?.generation).toBe(1);
});

it.each([
  'success',
  'status',
  'lateState',
  'effects',
  'later',
  'dirty',
  'loss',
  'selection',
  'releaseRace',
] as const)('composes actual save saga, receipt DATA and atomic adoption (%s)', async (mode) => {
  const r = await draftSaveHarness();
  const current = () => r.state().byWorkspaceId['ws-a']?.notes.spec;
  const held = deferred<void>();
  const ack = deferred<void>();
  let captured: NoteSpliceOperation | undefined;
  const originalRead = r.client.read.bind(r.client);
  vi.spyOn(r.client, 'read').mockImplementation(async (ws, id, q) => {
    const value = await originalRead(ws, id, q);
    return { ...value, sourceRevision: current()?.state?.sourceRevision ?? 'r:7' };
  });
  const commit = async (operation: NoteSpliceOperation) => {
    captured = operation;
    await ack.promise;
    if (mode !== 'lateState')
      r.client.push({ ...tuple, sourceRevision: 'r:8', stateGeneration: '11' });
    return {
      kind: 'noteCommitReceipt',
      outcome: 'committed',
      scope,
      operationId: operation.operationId,
      payloadDigest: operation.payloadDigest,
      beforeRevision: 'r:7',
      afterRevision: 'r:8',
      sourceLength: 3,
      mappingRef: 'map',
      effectsRef: 'effects',
      inverseRef: 'inverse',
      receiptExpiresAt: '2099-01-01T00:00:00Z',
      invalidation: 'all',
    } as const;
  };
  vi.spyOn(r.client, 'applySplices').mockImplementation(async (operation) => {
    captured = operation;
    if (mode === 'status') throw new Error('Lost acknowledgement');
    return commit(operation);
  });
  const status = vi.spyOn(r.client, 'operationStatus').mockImplementation(commit);
  const read = vi.spyOn(r.client, 'readReceipt').mockImplementation(async (receipt, q) => {
    if (q.kind === 'mapping') await held.promise;
    return readNoteReceiptPage(
      async () => ({
        kind: 'noteOperationPage',
        outputKind: q.kind,
        scope,
        operationId: receipt.operationId,
        payloadDigest: receipt.payloadDigest,
        beforeRevision: 'r:7',
        afterRevision: 'r:8',
        sourceLength: 3,
        expiresAt: receipt.receiptExpiresAt,
        nextCursor: null,
        ...(q.kind === 'effects' ? { convertedCount: 0 } : {}),
        items:
          q.kind === 'mapping'
            ? [{ start: 0, end: 1, insertedLength: 1 }]
            : mode === 'effects'
              ? [{ kind: 'sourceEffect', start: 0, end: 1, insertedLength: 1 }]
              : [],
      }),
      receipt,
      q,
    );
  });
  r.draft(1, 0, 1, 'B');
  r.dispatch(a.pageSaveDraftsRequested('ws-a', 'spec'));
  await vi.waitFor(() => expect(captured).toBeDefined());
  const savedCapture = current().pending!.document;
  if (mode === 'selection')
    r.dispatch(
      a.pageDocumentSelectionChanged('ws-a', 'spec', current().generation, current().document!, {
        anchor: 2,
        head: 1,
        anchorAffinity: 1,
        headAffinity: -1,
      }),
    );
  if (mode === 'later') r.draft(2, 1, 1, '!');
  const before = current().document!;
  expect(current().pending!.document).toBe(savedCapture);
  if (mode === 'selection')
    expect(before.selection).toEqual({ anchor: 2, head: 1, anchorAffinity: 1, headAffinity: -1 });
  if (mode === 'status') {
    await vi.waitFor(() => expect(current().pending?.status).toBe('unknown'));
    r.dispatch(a.pageSaveRetryRequested('ws-a', 'spec'));
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    expect(status.mock.calls[0][0]).toBe(captured);
  }
  ack.resolve();
  if (mode === 'lateState') {
    await vi.waitFor(() => expect(current().committedDocumentSave).toBeDefined());
    await flush();
    expect(read).not.toHaveBeenCalled();
    r.client.push({ ...tuple, sourceRevision: 'r:8', stateGeneration: '11' });
  }
  if (mode === 'later') {
    await vi.waitFor(() => expect(current().committedDocumentSave).toBeDefined());
    expect(read).not.toHaveBeenCalled();
    expect(current().needsReconcile).toBe(true);
    expect(current().document).toBe(before);
    expect(current().drafts).toHaveLength(1);
    r.dispatch(workspaceUnmounted('ws-a'));
    await flush();
    return;
  }
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(captured?.splices).toEqual([{ start: 0, end: 1, text: 'B' }]);
  expect(current().needsReconcile).toBe(true);
  expect(r.state().resourceLedger.used.physicalReads).toBeGreaterThan(0);
  if (mode === 'loss') r.dispatch(workspaceUnmounted('ws-a'));
  if (mode === 'dirty') {
    // Explicit hostile payload corruption checks the dirty-operation guard
    // independently of legitimate reducer generation monotonicity.
    before.dirty = [{ start: 0, end: 1, text: 'C' }];
  }
  let observed = false;
  const originalDispatch = r.dispatch;
  // A resource-release transition may invalidate ownership before adoption.
  // Model it using a current-state subscription in the actual harness below.
  const stop =
    mode === 'releaseRace'
      ? r.subscribe(() => {
          if (
            !observed &&
            read.mock.calls.length === 2 &&
            r.state().resourceLedger.used.physicalReads === 0
          ) {
            observed = true;
            originalDispatch(a.pageSessionDiscarded('ws-a', 'spec'));
          }
        })
      : () => {};
  held.resolve();
  if (mode === 'success' || mode === 'status' || mode === 'lateState' || mode === 'selection') {
    await vi.waitFor(() => expect(current().needsReconcile).toBe(false));
    expect(current().document!.baseRevision).toBe('r:8');
    expect(current().document!.dirty).toEqual([]);
    expect(current().document!.history).toBe(before.history);
    expect(current().document!.selection).toBe(before.selection);
    expect(current().history[0]).toMatchObject({ sequence: 1, baseRevision: 'r:8', splices: [] });
    expect(current().committedDocumentSave).toBeUndefined();
  } else {
    await vi.waitFor(() => expect(r.state().resourceLedger.used.physicalReads).toBe(0));
    await flush();
    if (mode === 'releaseRace') expect(observed).toBe(true);
    if (mode === 'effects' || mode === 'dirty') {
      expect(current().needsReconcile).toBe(true);
      expect(current().document).toBe(before);
      expect(current().committedDocumentSave).toBeDefined();
    }
  }
  stop();
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
});

it('grows through the real saga with the prefix retained and ignores stale resize intent', async () => {
  const f = canonicalGrowthFixture({
    scope,
    sourceRevision: page.sourceRevision,
    snapshotId: page.snapshotId,
    expiresAt: page.expiresAt,
  });
  const read = vi.fn(async (_ws, _id, q) => f.page(q));
  const r = run(
    new MockNotePagesClient({ capabilities: { backendId: 'db-a', annotations: false }, read }),
  );
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  // The application's reading surface normally installs this aggregate bound.
  r.dispatch(
    a.pageResourceLimitsConfigured(
      createNoteReadingSurface('ws-a', 'spec', 'p', () => {}).resourceLimits!,
    ),
  );
  clientPush();
  function clientPush() {
    (appClient.notes.pages as MockNotePagesClient).push(tuple);
  }
  await flush();
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  for (let i = 0; i < 12; i++) await flush();
  const n = () => r.state().byWorkspaceId['ws-a'].notes.spec;
  const prior = n().windows.p.value!;
  expect(prior.range).toEqual({ start: 0, end: 16 });
  const generation = n().generation,
    request = n().windows.p.request;
  r.dispatch(a.pageWindowRetained('ws-a', 'spec', 'p', generation, prior, 'visible-prefix'));
  r.dispatch(a.pageWindowGrowthRequested('ws-a', 'spec', 'p', generation, request, 32));
  expect(n().windows.p.value).toBe(prior);
  // An older intent must not cancel the newly accepted assembly.
  r.dispatch(a.pageWindowGrowthRequested('ws-a', 'spec', 'p', generation, request, 48));
  for (let i = 0; i < 20; i++) await flush();
  expect(n().windows.p.value?.range).toEqual({ start: 0, end: 32 });
  expect(n().windows.p.value?.text.startsWith(prior.text)).toBe(true);
  expect(r.state().resourceLedger.owners['visible-prefix']).toBeDefined();
  r.dispatch(a.pageResourcesReleased('visible-prefix'));
  expect(r.state().resourceLedger.owners['visible-prefix']).toBeUndefined();
  expect(Object.keys(r.state().physicalReads)).toHaveLength(0);
});

it('explicit navigation wins over pending growth and late growth cannot replace it', async () => {
  const f = canonicalGrowthFixture({
    scope,
    sourceRevision: page.sourceRevision,
    snapshotId: page.snapshotId,
    expiresAt: page.expiresAt,
  });
  const pending = deferred<Awaited<ReturnType<typeof f.page>>>();
  let hold = false;
  const read = vi.fn(async (_ws, _id, q) =>
    hold && q.kind === 'source' && q.at === 0 ? pending.promise : f.page(q),
  );
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  r.dispatch(
    a.pageResourceLimitsConfigured(
      createNoteReadingSurface('ws-a', 'spec', 'p', () => {}).resourceLimits!,
    ),
  );
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  for (let i = 0; i < 12; i++) await flush();
  const n = () => r.state().byWorkspaceId['ws-a'].notes.spec;
  expect(n().windows.p.value?.range.end).toBe(16);
  hold = true;
  r.dispatch(
    a.pageWindowGrowthRequested('ws-a', 'spec', 'p', n().generation, n().windows.p.request, 32),
  );
  await flush();
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 32));
  for (let i = 0; i < 12; i++) await flush();
  expect(n().windows.p.value?.range).toEqual({ start: 32, end: 48 });
  pending.resolve(
    await f.page({ kind: 'source', at: 0, maxSourceBytes: 4096, maxWireBytes: 8192 }),
  );
  for (let i = 0; i < 12; i++) await flush();
  expect(n().windows.p.value?.range).toEqual({ start: 32, end: 48 });
  expect(Object.keys(r.state().physicalReads)).toHaveLength(0);
  expect(
    Object.keys(r.state().resourceLedger.owners).filter((x) => x.startsWith('assembly:')),
  ).toHaveLength(0);
});

it.each(['shared', 'clone', 'changed-target'])(
  'rejected accepted-growth replay does not cancel the deferred read: %s',
  async (kind) => {
    const f = canonicalGrowthFixture({
      scope,
      sourceRevision: page.sourceRevision,
      snapshotId: page.snapshotId,
      expiresAt: page.expiresAt,
    });
    const pending = deferred<Awaited<ReturnType<typeof f.page>>>();
    let hold = false;
    const read = vi.fn(async (_ws, _id, q) =>
      hold && q.kind === 'source' && q.at === 0 ? pending.promise : f.page(q),
    );
    const client = new MockNotePagesClient({
      capabilities: { backendId: 'db-a', annotations: false },
      read,
    });
    const r = run(client);
    const surface = createNoteReadingSurface('ws-a', 'spec', 'p', () => {});
    r.dispatch(a.pageResourceLimitsConfigured(surface.resourceLimits!));
    r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
    await flush();
    client.push(tuple);
    await flush();
    r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
    for (let i = 0; i < 12; i++) await flush();
    const n = () => r.state().byWorkspaceId['ws-a'].notes.spec;
    const prior = n().windows.p.value!;
    r.dispatch(a.pageWindowRetained('ws-a', 'spec', 'p', n().generation, prior, 'visible-prefix'));
    hold = true;
    r.dispatch(
      a.pageWindowGrowthRequested('ws-a', 'spec', 'p', n().generation, n().windows.p.request, 32),
    );
    await flush();
    const g = n().windows.p.growth!;
    const active = n().windows.p;
    const ledger = r.state().resourceLedger;
    const count = read.mock.calls.length;
    expect(ledger.limit).toEqual(surface.resourceLimits);
    const replay =
      kind === 'shared' ? g : { ...g, minimumEnd: kind === 'changed-target' ? 48 : g.minimumEnd };
    r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0, replay));
    await flush();
    expect(n().windows.p).toBe(active);
    expect(read).toHaveBeenCalledTimes(count);
    expect(r.state().resourceLedger).toBe(ledger);
    hold = false;
    pending.resolve(
      await f.page({ kind: 'source', at: 0, maxSourceBytes: 4096, maxWireBytes: 8192 }),
    );
    for (let i = 0; i < 20; i++) await flush();
    expect(n().windows.p.value?.range).toEqual({ start: 0, end: 32 });
    expect(n().windows.p.value?.text.startsWith(prior.text)).toBe(true);
    expect(r.state().resourceLedger.owners['visible-prefix']).toBeDefined();
    r.dispatch(a.pageResourcesReleased('visible-prefix'));
    r.dispatch(workspaceUnmounted('ws-a'));
    await flush();
    expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
    expect(Object.keys(r.state().physicalReads)).toHaveLength(0);
    surface.dispose();
  },
);

it.each(['intent', 'accepted'])(
  'expired growth %s preserves prefix ownership and allows explicit navigation',
  async (kind) => {
    const f = canonicalGrowthFixture({
      scope,
      sourceRevision: page.sourceRevision,
      snapshotId: page.snapshotId,
      expiresAt: page.expiresAt,
    });
    const read = vi.fn(async (_ws, _id, q) => f.page(q));
    const client = new MockNotePagesClient({
      capabilities: { backendId: 'db-a', annotations: false },
      read,
    });
    const r = run(client);
    const surface = createNoteReadingSurface('ws-a', 'spec', 'p', () => {});
    r.dispatch(a.pageResourceLimitsConfigured(surface.resourceLimits!));
    r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
    await flush();
    client.push(tuple);
    await flush();
    r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
    for (let i = 0; i < 12; i++) await flush();
    const n = () => r.state().byWorkspaceId['ws-a'].notes.spec;
    const prior = n().windows.p.value!;
    const oldOwner = n().windows.p.resourceOwner;
    const request = n().windows.p.request;
    const count = read.mock.calls.length;
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'));
    if (kind === 'intent')
      r.dispatch(a.pageWindowGrowthRequested('ws-a', 'spec', 'p', n().generation, request, 32));
    else
      r.dispatch(
        a.pageWindowRequested('ws-a', 'spec', 'p', 0, {
          generation: n().generation,
          request,
          snapshotId: prior.snapshotId,
          sourceRevision: prior.sourceRevision,
          start: 0,
          end: 16,
          minimumEnd: 32,
        }),
      );
    await flush();
    expect(n().windows.p.value).toBe(prior);
    expect(n().windows.p.resourceOwner).toBe(oldOwner);
    expect(n().windows.p.loading).toBe(false);
    expect(read).toHaveBeenCalledTimes(count);
    const before = n().windows.p.request;
    r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 16));
    expect(n().windows.p.request).toBe(before + 1);
    expect(n().windows.p.at).toBe(16);
    r.dispatch(workspaceUnmounted('ws-a'));
    await flush();
    surface.dispose();
  },
);

async function growthRuntime(
  hold?: (
    q: Parameters<ReturnType<typeof canonicalGrowthFixture>['page']>[0],
  ) => Promise<Awaited<ReturnType<ReturnType<typeof canonicalGrowthFixture>['page']>>> | undefined,
) {
  const f = canonicalGrowthFixture({
    scope,
    sourceRevision: page.sourceRevision,
    snapshotId: page.snapshotId,
    expiresAt: page.expiresAt,
  });
  const read = vi.fn(async (_ws, _id, q) => hold?.(q) ?? f.page(q));
  const client = new MockNotePagesClient({
    capabilities: { backendId: 'db-a', annotations: false },
    read,
  });
  const r = run(client);
  const surface = createNoteReadingSurface('ws-a', 'spec', 'p', () => {});
  r.dispatch(a.pageResourceLimitsConfigured(surface.resourceLimits!));
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  await flush();
  client.push(tuple);
  await flush();
  return { ...r, f, read, surface, n: () => r.state().byWorkspaceId['ws-a'].notes.spec };
}
it('rechecks pinned expiry after queued DATA admission before starting source IO', async () => {
  const r = await growthRuntime();
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  for (let i = 0; i < 12; i++) await flush();
  const prior = r.n().windows.p.value!,
    oldOwner = r.n().windows.p.resourceOwner;
  const { noteAssemblyResources } =
    await import('$features/notes/virtualized/note-assembly-reservation');
  for (const owner of ['held-a', 'held-b'])
    r.dispatch(
      a.pageResourcesRequested(
        owner,
        [noteAssemblyResources({ owner, data: owner + '-data', control: owner + '-control' })[0]],
        12,
      ),
    );
  const calls = r.read.mock.calls.length;
  r.dispatch(
    a.pageWindowGrowthRequested('ws-a', 'spec', 'p', r.n().generation, r.n().windows.p.request, 32),
  );
  await flush();
  expect(r.state().resourceLedger.pending).toHaveLength(1);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'));
  r.dispatch(a.pageResourcesReleased('held-a'));
  for (let i = 0; i < 12; i++) await flush();
  expect(r.read).toHaveBeenCalledTimes(calls);
  expect(r.n().windows.p.loading).toBe(false);
  expect(r.n().windows.p.value).toBe(prior);
  expect(r.n().windows.p.resourceOwner).toBe(oldOwner);
  r.dispatch(a.pageResourcesReleased('held-b'));
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
  r.surface.dispose();
});
it('orders interleaved panel growth, explicit navigation and close bursts without dropping requests', async () => {
  const r = await growthRuntime();
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'q'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'q', 0));
  for (let i = 0; i < 24; i++) await flush();
  expect(r.n().windows.p.value?.range.end).toBe(16);
  expect(r.n().windows.q.value?.range.end).toBe(16);
  r.dispatch(
    a.pageWindowGrowthRequested('ws-a', 'spec', 'p', r.n().generation, r.n().windows.p.request, 32),
  );
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'q', 16));
  r.dispatch(a.pagePanelClosed('ws-a', 'spec', 'p'));
  for (let i = 0; i < 24; i++) await flush();
  expect(r.n().windows.p).toBeUndefined();
  expect(r.n().windows.q.value?.range).toEqual({ start: 16, end: 32 });
  r.dispatch(a.pagePanelOpened('ws-a', 'spec', 'p'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  r.dispatch(a.pagePanelClosed('ws-a', 'spec', 'q'));
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 32));
  for (let i = 0; i < 24; i++) await flush();
  expect(r.n().windows.q).toBeUndefined();
  expect(r.n().windows.p.value?.range).toEqual({ start: 32, end: 48 });
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
  r.surface.dispose();
});
it('cancels the channel owner while a physical read is deferred and releases resources after settlement', async () => {
  const pending = deferred<any>();
  let hold = false;
  const r = await growthRuntime((q) =>
    hold && q.kind === 'source' && q.at === 0 ? pending.promise : undefined,
  );
  hold = true;
  r.dispatch(a.pageWindowRequested('ws-a', 'spec', 'p', 0));
  await flush();
  expect(r.state().resourceLedger.used.physicalReads).toBe(1);
  r.cancelWindowOwner();
  r.dispatch(workspaceUnmounted('ws-a'));
  await flush();
  expect(
    Object.keys(r.state().resourceLedger.owners).filter((x) => x.startsWith('assembly:')),
  ).toHaveLength(0);
  expect(r.state().resourceLedger.used.physicalReads).toBe(1);
  pending.resolve(
    await r.f.page({ kind: 'source', at: 0, maxSourceBytes: 4096, maxWireBytes: 8192 }),
  );
  for (let i = 0; i < 12; i++) await flush();
  expect(r.state().resourceLedger.used.physicalReads).toBe(0);
  expect(r.state().resourceLedger.used.payloadBytes).toBe(0);
  expect(r.state().resourceLedger.pending).toHaveLength(0);
  r.surface.dispose();
});
