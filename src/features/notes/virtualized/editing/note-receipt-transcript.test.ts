import { expect, it, vi } from 'vitest';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteCommitReceipt } from '$lib/client/note-pages';
import {
  readNoteReceiptPage,
  type NoteReceiptPage,
  type NoteReceiptReadRequest,
} from '$lib/client/note-receipt-reader';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';
import { noteAssemblyResources } from '../note-assembly-reservation';
const receipt: NoteCommitReceipt = {
  kind: 'noteCommitReceipt',
  outcome: 'committed',
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  operationId: 'operation',
  payloadDigest: 'a'.repeat(64),
  beforeRevision: 'r1',
  afterRevision: 'r2',
  sourceLength: 4,
  mappingRef: 'mapping',
  effectsRef: 'effects',
  inverseRef: 'inverse',
  receiptExpiresAt: '2099-01-01T00:00:00Z',
  invalidation: 'all',
};
function page(
  kind: 'mapping' | 'effects' = 'mapping',
  nextCursor: string | null = null,
): NoteReceiptPage {
  const common = {
    kind: 'noteOperationPage' as const,
    scope: receipt.scope,
    operationId: receipt.operationId,
    payloadDigest: receipt.payloadDigest,
    beforeRevision: 'r1',
    afterRevision: 'r2',
    sourceLength: 3,
    items: [],
    nextCursor,
    expiresAt: receipt.receiptExpiresAt,
  };
  return kind === 'effects'
    ? { ...common, outputKind: kind, convertedCount: 0 }
    : { ...common, outputKind: kind };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(physicalReads = 1) {
  let state = a.initialNotePagesState,
    current = true;
  const listeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const fn of [...listeners]) fn();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 0,
      physicalReads,
      assemblies: 2,
    }),
  );
  const port = {
    read: () => state,
    dispatch,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    port,
    listeners,
    read: () => state,
    ownerCurrent: () => current,
    transition(value: boolean) {
      current = value;
      for (const fn of [...listeners]) fn();
    },
  };
}
it('admits DATA before dispatch and retains it through a held consumer and exact release', async () => {
  const f = fixture(),
    sink = deferred<void>(),
    entered = deferred<void>();
  const send = vi.fn(async () => {
    expect(f.read().resourceLedger.used.physicalReads).toBe(1);
    expect(f.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    return page();
  });
  const readReceipt = vi.fn((r: NoteCommitReceipt, q: NoteReceiptReadRequest) =>
    readNoteReceiptPage(send, r, q),
  );
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  const ready = await lease.ready;
  const pending = ready.consumeNext('mapping', async () => {
    entered.resolve(undefined);
    await sink.promise;
  });
  await entered.promise;
  await expect(ready.consumeNext('effects', () => {})).rejects.toThrow('read unavailable');
  expect(ready.current()).toBe(true);
  expect(readReceipt).toHaveBeenCalledOnce();
  const observed = expect(pending).rejects.toThrow('superseded');
  const released = lease.release();
  expect(lease.release()).toBe(released);
  expect(ready.current()).toBe(false);
  await expect(ready.consumeNext('effects', () => {})).rejects.toThrow();
  expect(readReceipt).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  sink.resolve(undefined);
  await observed;
  await released;
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('keeps actual pending transport credit after abort and discards its late page', async () => {
  const f = fixture(),
    io = deferred<NoteReceiptPage>(),
    abort = new AbortController();
  const readReceipt = vi.fn(() => io.promise),
    sink = vi.fn();
  const lease = reserveNoteReceiptTranscript(
    f.port,
    { readReceipt },
    receipt,
    3,
    f.ownerCurrent,
    abort.signal,
  );
  const ready = await lease.ready,
    pending = ready.consumeNext('mapping', sink);
  expect(readReceipt).toHaveBeenCalledOnce();
  const observed = expect(pending).rejects.toThrow();
  abort.abort();
  let retired = false;
  const release = lease.release().then(() => {
    retired = true;
  });
  await Promise.resolve(undefined);
  expect(retired).toBe(false);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  io.resolve(page());
  await observed;
  await release;
  expect(sink).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});
it('cannot revive after an observed owner loss even if it returns before polling', async () => {
  const f = fixture(),
    readReceipt = vi.fn(async () => page());
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  const ready = await lease.ready;
  f.transition(false);
  f.transition(true);
  expect(ready.current()).toBe(false);
  await expect(ready.consumeNext('mapping', () => {})).rejects.toThrow();
  expect(readReceipt).not.toHaveBeenCalled();
  await lease.release();
});
it('refuses denied admission without dispatch and cleans listeners', async () => {
  const f = fixture(0),
    readReceipt = vi.fn(async () => page());
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  await expect(lease.ready).rejects.toThrow('admission denied');
  expect(readReceipt).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0);
  expect(f.read().resourceLedger.pending).toHaveLength(0);
});
it('advances each root independently and rejects repeated cursor before delivering a page', async () => {
  const f = fixture();
  const readReceipt = vi.fn(async (_r: NoteCommitReceipt, q: NoteReceiptReadRequest) =>
    page(q.kind, q.kind === 'mapping' ? 'next' : null),
  );
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  const ready = await lease.ready;
  expect(
    await ready.consumeNext('mapping', (p) => {
      p.nextCursor = 'consumer mutation';
    }),
  ).toBe(false);
  expect(await ready.consumeNext('effects', () => {})).toBe(true);
  const sink = vi.fn();
  await expect(ready.consumeNext('mapping', sink)).rejects.toThrow('cursor');
  expect(readReceipt.mock.calls[2][1].cursor).toBe('next');
  expect(sink).not.toHaveBeenCalled();
  expect(ready.current()).toBe(false);
  await lease.release();
});
it('drains 300 pages across both roots without a total-page ceiling or growing resident credit', async () => {
  const f = fixture();
  const expected = { ...receipt, sourceLength: 450 };
  const original = { ...expected, scope: { ...expected.scope } };
  const sent = { mapping: 0, effects: 0 },
    seen = { mapping: 0, effects: 0 };
  let resident: unknown;
  const readReceipt = vi.fn(async (r: NoteCommitReceipt, q: NoteReceiptReadRequest) => {
    expect(r).toEqual(expected);
    const index = sent[q.kind]++;
    expect(q.cursor).toBe(index === 0 ? undefined : `${q.kind}:${index}`);
    expect(q.maxItems).toBe(64);
    expect(q.maxWireBytes).toBe(8192);
    expect(f.read().resourceLedger.used).toEqual(resident);
    return readNoteReceiptPage(
      async (params) => {
        expect(params.ref).toBe(q.kind === 'mapping' ? expected.mappingRef : expected.effectsRef);
        expect(params.cursor).toBe(q.cursor);
        return {
          ...page(q.kind, index === 149 ? null : `${q.kind}:${index + 1}`),
          sourceLength: 300,
          items: [
            q.kind === 'mapping'
              ? { start: index * 2, end: index * 2, insertedLength: 1 }
              : {
                  kind: 'sourceEffect',
                  reason: 'anchor-repair',
                  inputState: 'callerResult',
                  outputState: 'final',
                  range: { start: index * 2, end: index * 2 },
                  insertedLength: 1,
                  beforeDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                  afterDigest: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
                  detailRef: `effect:${index}`,
                },
          ],
        };
      },
      r,
      q,
    );
  });
  const lease = reserveNoteReceiptTranscript(
    f.port,
    { readReceipt },
    original,
    300,
    f.ownerCurrent,
  );
  try {
    const ready = await lease.ready;
    resident = { ...f.read().resourceLedger.used };
    for (let index = 0; index < 150; index++) {
      for (const kind of ['mapping', 'effects'] as const) {
        const done = await ready.consumeNext(kind, async (p) => {
          const index = seen[kind]++;
          if (kind === 'mapping') {
            expect(p.items[0]).toEqual({ start: index * 2, end: index * 2, insertedLength: 1 });
          } else {
            expect(p.items[0]).toMatchObject({
              kind: 'sourceEffect',
              range: { start: index * 2, end: index * 2 },
              detailRef: `effect:${index}`,
            });
          }
          await Promise.resolve();
          expect(f.read().resourceLedger.used).toEqual(resident);
        });
        expect(done).toBe(index === 149);
      }
      if (index === 99) {
        original.scope.backendId = 'changed';
        original.receiptExpiresAt = '2100-01-01T00:00:00Z';
      }
    }
    expect(seen).toEqual({ mapping: 150, effects: 150 });
    expect(readReceipt).toHaveBeenCalledTimes(300);
    await expect(ready.consumeNext('mapping', () => {})).rejects.toThrow('read unavailable');
  } finally {
    await lease.release();
  }
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('rejects immediate reentrant release from a consumer and permits outer-finally retirement', async () => {
  const f = fixture(),
    readReceipt = vi.fn(async () => page());
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  const ready = await lease.ready;
  try {
    await expect(
      ready.consumeNext('mapping', async () => {
        await lease.release();
      }),
    ).rejects.toThrow('outside consume');
    expect(ready.current()).toBe(false);
    expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  } finally {
    await lease.release();
  }
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
});
it('refuses inconsistent effects aggregate across pages and keeps error ownership until release', async () => {
  const f = fixture();
  let count = 0;
  const readReceipt = vi.fn(async () => ({
    ...page('effects', `next-${count}`),
    outputKind: 'effects' as const,
    convertedCount: count++,
  }));
  const lease = reserveNoteReceiptTranscript(f.port, { readReceipt }, receipt, 3, f.ownerCurrent);
  const ready = await lease.ready;
  await ready.consumeNext('effects', () => {});
  await expect(ready.consumeNext('effects', () => {})).rejects.toThrow('aggregate changed');
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  await lease.release();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});
it('refuses expiry while a sink is held without refunding its retained data', async () => {
  const f = fixture(),
    sink = deferred<void>(),
    entered = deferred<void>();
  let now = 1000;
  const r = { ...receipt, receiptExpiresAt: '1970-01-01T00:00:01.000000001Z' };
  const readReceipt = vi.fn(async () => ({ ...page(), expiresAt: r.receiptExpiresAt }));
  const lease = reserveNoteReceiptTranscript(
    f.port,
    { readReceipt },
    r,
    3,
    f.ownerCurrent,
    undefined,
    () => now,
  );
  const ready = await lease.ready,
    pending = ready.consumeNext('mapping', async () => {
      entered.resolve(undefined);
      await sink.promise;
    });
  await entered.promise;
  const observed = expect(pending).rejects.toThrow();
  now = 1001;
  expect(ready.current()).toBe(false);
  expect(f.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  sink.resolve(undefined);
  await observed;
  await lease.release();
  expect(f.listeners.size).toBe(0);
});

it('cancels queued admission without dispatch or releasing another owner', async () => {
  const f = fixture(),
    abort = new AbortController();
  const block = { owner: 'block', data: 'block-data', control: 'block-control' };
  f.port.dispatch(a.pageResourcesRequested(block.owner, noteAssemblyResources(block), 1));
  const readReceipt = vi.fn(async () => page());
  const lease = reserveNoteReceiptTranscript(
    f.port,
    { readReceipt },
    receipt,
    3,
    f.ownerCurrent,
    abort.signal,
  );
  const observed = expect(lease.ready).rejects.toThrow('superseded');
  expect(f.read().resourceLedger.pending).toHaveLength(1);
  expect(readReceipt).not.toHaveBeenCalled();
  abort.abort();
  await observed;
  await lease.release();
  expect(f.read().resourceLedger.pending).toHaveLength(0);
  expect(Object.keys(f.read().resourceLedger.owners)).toEqual(['block']);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  expect(f.listeners.size).toBe(0);
  f.port.dispatch(a.pageResourcesReleased(block.owner));
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
});

it('cancels a long drained prefix without renewing identity or retiring its next in-flight page', async () => {
  const f = fixture(),
    abort = new AbortController(),
    io = deferred<NoteReceiptPage>();
  let consumed = 0;
  const readReceipt = vi.fn(async (r: NoteCommitReceipt, q: NoteReceiptReadRequest) => {
    expect(r).toEqual(receipt);
    expect(q.cursor).toBe(consumed === 0 ? undefined : `next:${consumed}`);
    if (consumed === 120) return io.promise;
    return { ...page('mapping', `next:${consumed + 1}`), items: [{ ordinal: consumed }] };
  });
  const lease = reserveNoteReceiptTranscript(
    f.port,
    { readReceipt },
    receipt,
    3,
    f.ownerCurrent,
    abort.signal,
  );
  const ready = await lease.ready;
  for (let i = 0; i < 120; i++) {
    expect(
      await ready.consumeNext('mapping', (p) => {
        expect((p.items[0] as { ordinal: number }).ordinal).toBe(consumed++);
      }),
    ).toBe(false);
  }
  const sink = vi.fn(),
    pending = ready.consumeNext('mapping', sink);
  expect(readReceipt).toHaveBeenCalledTimes(121);
  const observed = expect(pending).rejects.toThrow();
  abort.abort();
  const releasing = lease.release();
  expect(lease.release()).toBe(releasing);
  expect(ready.current()).toBe(false);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  io.resolve(page());
  await observed;
  await releasing;
  expect(sink).not.toHaveBeenCalled();
  expect(consumed).toBe(120);
  await expect(ready.consumeNext('mapping', sink)).rejects.toThrow();
  expect(readReceipt).toHaveBeenCalledTimes(121);
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  expect(f.listeners.size).toBe(0);
});
