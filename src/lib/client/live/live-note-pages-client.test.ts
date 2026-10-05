import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
import { backendRequest } from './backend-transport';
import { LiveNotePagesClient } from './live-note-pages-client';
const rpc = vi.mocked(backendRequest);
const scope = { backendId: 'db-a', workspaceId: 'ws-a', noteId: 'spec', noteInstanceId: 'inc-a' };
const page = {
  kind: 'noteSourcePage',
  scope,
  sourceRevision: 'r:7',
  snapshotId: 'snap-a',
  expiresAt: '2099-01-01T00:00:00.000Z',
  sourceLength: 8,
  range: { start: 0, end: 3 },
  text: 'A😀',
  nextCursor: 'next',
  previousCursor: null,
  contextRef: 'ctx',
  metadataRef: 'meta',
};
beforeEach(() => vi.clearAllMocks());
it('requires the actual complete daemon capability and backend identity', async () => {
  const client = new LiveNotePagesClient();
  rpc.mockResolvedValueOnce({
    server: { capabilities: { notePaging: 1, notePagingBackendId: 'db-a' } },
  });
  expect(await client.capabilities()).toEqual({ backendId: 'db-a', annotations: false });
  rpc.mockResolvedValueOnce({ server: { capabilities: { notePaging: 1 } } });
  expect(await client.capabilities()).toBeNull();
  rpc.mockResolvedValueOnce({
    server: { capabilities: { notePaging: true, notePagingBackendId: 'db-a' } },
  });
  expect(await client.capabilities()).toBeNull();
});
it('sends bounded source params and retains exact Unicode and scope', async () => {
  const client = new LiveNotePagesClient();
  rpc.mockResolvedValueOnce(page);
  expect(await client.read('ws-a', 'spec', { kind: 'source', at: 0, maxSourceBytes: 5 })).toEqual(
    page,
  );
  expect(rpc).toHaveBeenCalledWith('note.get', {
    workspaceId: 'ws-a',
    noteId: 'spec',
    page: { kind: 'source', at: 0, maxSourceBytes: 5 },
  });
});
it.each([
  { note: { content: 'complete' } },
  { ...page, scope: { ...scope, workspaceId: 'other' } },
  { ...page, text: 'A' },
  { ...page, range: { start: 0, end: 9 } },
])('rejects incompatible or misrouted page results', async (result) => {
  rpc.mockResolvedValueOnce(result);
  await expect(
    new LiveNotePagesClient().read('ws-a', 'spec', { kind: 'source' }),
  ).rejects.toThrow();
});

// Approved monorepo vectors drive the production transport decoder, not a parallel model.
import vectors from '../mock/fixtures/note-pages-contract.json';
import type { NotePageRequest, NoteSpliceOperation } from '../note-pages';
it('sends the approved inline mutation and status vectors without legacy success folding', async () => {
  const wire = vectors.requests[2].params;
  const op = {
    scope: vectors.scope,
    baseRevision: wire.baseRevision,
    operationId: wire.operationId,
    expiresAt: wire.expiresAt,
    splices: wire.splices,
    payloadDigest: wire.payloadDigest,
  } as NoteSpliceOperation;
  const receipt = {
    kind: 'noteCommitReceipt',
    outcome: 'committed',
    scope: vectors.scope,
    operationId: op.operationId,
    payloadDigest: op.payloadDigest,
    beforeRevision: op.baseRevision,
    afterRevision: 'r:8',
    sourceLength: 12,
    mappingRef: 'mapping',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    receiptExpiresAt: '2099-01-01T00:00:00.000Z',
    invalidation: 'all',
  };
  const client = new LiveNotePagesClient();
  rpc.mockResolvedValueOnce(receipt);
  expect(await client.applySplices(op)).toEqual(receipt);
  expect(rpc).toHaveBeenLastCalledWith('note.applySplices', wire);
  rpc.mockResolvedValueOnce({ ...receipt, kind: 'noteOperationStatus', outcome: 'unknown' });
  expect(await client.operationStatus(op)).toMatchObject({ outcome: 'unknown' });
  expect(rpc).toHaveBeenLastCalledWith('note.operationStatus', vectors.requests[3].params);
  rpc.mockResolvedValueOnce({ ok: true });
  await expect(client.applySplices(op)).rejects.toThrow();
});
it('decodes approved structural and metadata vectors with their scoped references', async () => {
  const client = new LiveNotePagesClient();
  for (const p of vectors.contextPages) {
    rpc.mockResolvedValueOnce(p);
    expect(
      await client.read('ws-a', 'spec', { kind: 'context', contextRef: 'opaque-context' }),
    ).toEqual(p);
  }
  for (const p of vectors.metadataPages) {
    rpc.mockResolvedValueOnce(p);
    expect(await client.read('ws-a', 'spec', { kind: 'metadata', ref: 'metadata' })).toEqual(p);
  }
  const request = vectors.requests[0];
  rpc.mockResolvedValueOnce({
    ...page,
    range: { start: 1, end: 3 },
    text: '😀',
    previousCursor: 'previous',
  });
  await client.read('ws-a', 'spec', request.params.page as NotePageRequest);
  expect(rpc).toHaveBeenLastCalledWith(request.method, request.params);
});

import { onBackendNotification, onBackendReconnected } from './backend-transport';
it('buffers pre-ack snapshots, resubscribes on gaps/reconnect and disposes late acknowledgements', async () => {
  let notify!: (n: { method: string; params?: unknown }) => void;
  let reconnect!: () => void;
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    notify = fn;
    return vi.fn();
  });
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnect = fn;
    return vi.fn();
  });
  let ack!: (v: { subscriptionId: string }) => void;
  rpc.mockImplementation((method) =>
    method === 'note.subscribe'
      ? new Promise((r) => {
          ack = r as typeof ack;
        })
      : Promise.resolve({}),
  );
  const state = vi.fn(),
    reset = vi.fn();
  const dispose = new LiveNotePagesClient().subscribe('ws-a', 'spec', state, reset);
  notify(vectors.events[0]);
  ack({ subscriptionId: 'sub-a' });
  await Promise.resolve();
  await Promise.resolve();
  expect(state).toHaveBeenCalledWith(vectors.events[0].params.snapshot);
  notify(vectors.events[2]);
  expect(reset).toHaveBeenLastCalledWith('Note state sequence gap');
  expect(rpc.mock.calls.filter(([m]) => m === 'note.subscribe')).toHaveLength(2);
  ack({ subscriptionId: 'sub-b' });
  await Promise.resolve();
  await Promise.resolve();
  reconnect();
  dispose();
  ack({ subscriptionId: 'sub-c' });
  await Promise.resolve();
  await Promise.resolve();
  expect(rpc).toHaveBeenCalledWith('note.unsubscribe', {
    workspaceId: 'ws-a',
    subscriptionId: 'sub-c',
  });
  expect(rpc.mock.calls.filter(([m]) => m === 'note.get' || m === 'comment.list')).toEqual([]);
});

it('decodes the exact far-cell and repeated-table address frames from protocol 9b39c3de', async () => {
  const client = new LiveNotePagesClient();
  const v = vectors.tablePositions;
  for (const frame of [v.cellFrame, v.rowFrame, v.tableFrame, v.headerFrame, v.secondTableFrame]) {
    rpc.mockResolvedValueOnce(frame.result);
    expect(
      await client.read('ws-a', 'spec', { kind: 'context', contextRef: 'scoped-ref' }),
    ).toEqual(frame.result);
  }
  expect(v.cellFrame.result.items[0].tablePosition).toEqual({
    tableRef: 'first-table-ref',
    rowIndex: 100001,
    columnIndex: 2,
    alignment: 'right',
  });
});

it.each([
  undefined,
  { tableRef: 'table', rowIndex: 1, columnIndex: -1, alignment: 'left' },
  { tableRef: 'table', rowIndex: 1, columnIndex: 2, alignment: 'diagonal' },
  { tableRef: '', rowIndex: 1, columnIndex: 2, alignment: 'left' },
  { tableRef: 'table', rowIndex: 1.5, columnIndex: 2, alignment: 'left' },
])('rejects invalid table addresses without hydrating earlier cells: %j', async (tablePosition) => {
  const frame = structuredClone(vectors.tablePositions.cellFrame.result);
  const malformed = { ...frame, items: [{ ...frame.items[0], tablePosition }] };
  rpc.mockResolvedValueOnce(malformed);
  await expect(
    new LiveNotePagesClient().read('ws-a', 'spec', {
      kind: 'context',
      contextRef: 'far-cell-context',
    }),
  ).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('routes inline receipt pages through note.operation.read without staged or legacy fields', async () => {
  const receipt = {
    kind: 'noteCommitReceipt' as const,
    outcome: 'committed' as const,
    scope,
    operationId: 'op',
    payloadDigest: 'digest',
    beforeRevision: 'r1',
    afterRevision: 'r2',
    sourceLength: 5,
    mappingRef: 'mapping',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    receiptExpiresAt: '2099-01-01T00:00:00Z',
    invalidation: 'all' as const,
  };
  rpc.mockResolvedValueOnce({
    kind: 'noteOperationPage',
    scope,
    operationId: 'op',
    payloadDigest: 'digest',
    beforeRevision: 'r1',
    afterRevision: 'r2',
    outputKind: 'effects',
    sourceLength: 3,
    items: [],
    nextCursor: null,
    expiresAt: receipt.receiptExpiresAt,
  });
  await new LiveNotePagesClient().readReceipt(receipt, {
    kind: 'effects',
    baseLength: 3,
    maxItems: 1,
    maxWireBytes: 4096,
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('note.operation.read', {
    ...scope,
    operationId: 'op',
    payloadDigest: 'digest',
    kind: 'effects',
    ref: 'effects',
    maxItems: 1,
    maxWireBytes: 4096,
  });
});
