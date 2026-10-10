import { afterEach, expect, it, vi } from 'vitest';
import {
  createNoteMarkerSourceOperation,
  createNoteSelectionOperation,
} from './note-source-operation';
vi.mock('./live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from './live/backend-transport';
import { LiveNotePagesClient } from './live/live-note-pages-client';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const input = () => ({
  scope,
  operationId: '11111111-1111-4111-8111-111111111111',
  expiresAt: new Date(10000).toISOString(),
  expectedOutput: 'AB',
  header: {
    baseRevision: 'r',
    editorSessionId: 'e',
    localEditSequence: 0,
    liveGeneration: 1,
    selectionGeneration: 1,
    action: 'read' as const,
    output: 'selectionMarkdown' as const,
    selection: 'ranges' as const,
  },
});
const selected = {
  kind: 'range' as const,
  ordinal: 0,
  start: 10,
  end: 68,
  anchorAffinity: 'after' as const,
  headAffinity: 'before' as const,
  direction: 'forward' as const,
};
const projections = () =>
  [
    { role: 'selection-owner' as const, sourceRange: { start: 10, end: 68 } },
    { role: 'inline-span' as const, sourceRange: { start: 10, end: 11 } },
    {
      role: 'marker-occurrence' as const,
      sourceRange: { start: 11, end: 67 },
      canonicalId: 'original-comment',
    },
    { role: 'inline-span' as const, sourceRange: { start: 67, end: 68 } },
  ].map((v, ordinal) => ({
    kind: 'projection' as const,
    ordinal,
    ...v,
    detail: { textId: `descriptor-${ordinal}`, length: 1, utf8Bytes: 1, sha256: 'a'.repeat(64) },
  }));

// Controlled ACKs only: descriptor graph/native output/witness authority belongs
// to the actual producer and Store. This test verifies the dedicated Live route
// and wire admission; a digest-shaped placeholder is not a seal proof.
function fixture() {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  let begin: any, payload: string | undefined;
  let text = 'AB';
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const state = (phase: string) => ({
    kind: 'noteStageState',
    scope,
    operationId: begin.operationId,
    headerDigest: begin.headerDigest,
    baseRevision: 'r',
    expiresAt: begin.expiresAt,
    phase,
    streams: structuredClone(streams),
    ...(phase === 'sealed' ? { payloadDigest: payload, viewLength: 68 } : {}),
  });
  const send = vi.mocked(backendRequest);
  send.mockImplementation(async (method, params: any) => {
    if (method === 'note.operation.begin') {
      begin = structuredClone(params);
      return state('staging');
    }
    if (method === 'note.operation.append') {
      const s = streams.find((s) => s.stream === params.stream)!;
      s.nextSequence++;
      s.lastDigest = params.chunkDigest;
      return {
        kind: 'noteStageAck',
        scope,
        operationId: begin.operationId,
        stream: params.stream,
        sequence: params.sequence,
        nextSequence: s.nextSequence,
        chunkDigest: params.chunkDigest,
      };
    }
    if (method === 'note.operation.seal') {
      payload = params.payloadDigest;
      return state('sealed');
    }
    if (method === 'note.operation.cancel') return state('cancelled');
    if (method === 'note.operation.read')
      return {
        kind: 'noteOperationPage',
        outputKind: 'selectionMarkdown',
        scope,
        operationId: begin.operationId,
        headerDigest: begin.headerDigest,
        payloadDigest: payload,
        viewId: 'view',
        expiresAt: begin.expiresAt,
        sourceLength: 68,
        items: [{ offset: 0, text }],
        nextCursor: null,
      };
    throw new Error('Unexpected test method');
  });
  const operation = new LiveNotePagesClient().createMarkerSelectionOperation(input(), () => true);
  return {
    operation,
    send,
    text(value: string) {
      text = value;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('routes exact four-record marker selection through Live, validates native output and cancels', async () => {
  const f = fixture(),
    consumed = vi.fn(async () => {});
  await f.operation.begin();
  await f.operation.append('selection', [selected]);
  await f.operation.append('live', projections().slice(0, 2));
  await f.operation.append('live', projections().slice(2));
  await f.operation.seal();
  await f.operation.read(consumed);
  await f.operation.cancel();
  expect(consumed).toHaveBeenCalledExactlyOnceWith('AB');
  const read = f.send.mock.calls.find(([m]) => m === 'note.operation.read')?.[1];
  expect(read).toMatchObject({
    kind: 'selectionMarkdown',
    maxSourceBytes: 1024,
    maxWireBytes: 8192,
    maxItems: 64,
  });
  expect(read).not.toHaveProperty('payloadDigest');
  expect(f.send.mock.calls.filter(([m]) => m === 'note.operation.cancel')).toHaveLength(1);
});

it.each(['wrong-role', 'missing-id', 'text-id', 'fifth', 'reordered'] as const)(
  'rejects %s marker closure before sending the invalid chunk',
  async (mode) => {
    const f = fixture();
    await f.operation.begin();
    const records: any[] = projections();
    if (mode === 'wrong-role') records[2].role = 'inline-span';
    if (mode === 'missing-id') delete records[2].canonicalId;
    if (mode === 'text-id') records[1].canonicalId = 'foreign';
    if (mode === 'fifth') records.push({ ...records[3], ordinal: 4 });
    if (mode === 'reordered') [records[1], records[2]] = [records[2], records[1]];
    await expect(f.operation.append('live', records)).rejects.toThrow();
    expect(f.send.mock.calls.filter(([m]) => m === 'note.operation.append')).toHaveLength(0);
    await f.operation.cancel();
  },
);

it.each(['missing-range', 'partial-live'] as const)('refuses %s before seal RPC', async (mode) => {
  const f = fixture();
  await f.operation.begin();
  if (mode !== 'missing-range') await f.operation.append('selection', [selected]);
  await f.operation.append(
    'live',
    mode === 'partial-live' ? projections().slice(0, 3) : projections(),
  );
  await expect(f.operation.seal()).rejects.toThrow();
  expect(f.send.mock.calls.filter(([m]) => m === 'note.operation.seal')).toHaveLength(0);
  await f.operation.cancel();
});

it('refuses raw source-marker text before delivering any output', async () => {
  const f = fixture(),
    consumed = vi.fn(async () => {});
  await f.operation.begin();
  await f.operation.append('selection', [selected]);
  await f.operation.append('live', projections());
  await f.operation.seal();
  f.text('A<!--anchor:original-comment:point-->B');
  await expect(f.operation.read(consumed)).rejects.toThrow(
    'Selection output differs from native serializer',
  );
  expect(consumed).not.toHaveBeenCalled();
  await f.operation.cancel();
});

it('does not widen ordinary selection or marker source cardinality', async () => {
  const f = fixture();
  for (const operation of [
    createNoteSelectionOperation(
      (m, p) => backendRequest(m, p),
      input(),
      () => true,
    ),
    createNoteMarkerSourceOperation(
      (m, p) => backendRequest(m, p),
      {
        ...input(),
        header: { ...input().header, output: 'source', selection: 'all' },
      },
      () => true,
    ),
  ]) {
    await operation.begin();
    await expect(operation.append('live', projections())).rejects.toThrow();
    await operation.cancel();
  }
  expect(f.send.mock.calls.filter(([m]) => m === 'note.operation.append')).toHaveLength(0);
});
