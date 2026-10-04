import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import type { NotePageState, NoteSourcePage, NotePagingCapabilities } from '$lib/client/note-pages';
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
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: state }) },
    notePagesSaga,
  );
  tasks.push(task);
  return { dispatch, state: () => state, task };
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
