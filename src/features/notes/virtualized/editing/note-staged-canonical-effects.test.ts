import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import type { NoteCommitReceipt } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';
import { validateNoteStagedCanonicalEffects } from './note-staged-canonical-effects';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const rpc = vi.mocked(backendRequest);
const receipt: NoteCommitReceipt = {
  kind: 'noteCommitReceipt',
  outcome: 'committed',
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  operationId: 'op',
  headerDigest: 'a'.repeat(64),
  payloadDigest: 'b'.repeat(64),
  viewId: 'v',
  beforeRevision: 'r1',
  afterRevision: 'r2',
  sourceLength: 2099,
  mappingRef: 'mapping',
  effectsRef: 'effects',
  inverseRef: 'inverse',
  receiptExpiresAt: '2099-01-01T00:00:00Z',
  invalidation: 'all',
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  let state = a.initialNotePagesState,
    present = true;
  const listeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const f of [...listeners]) f();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  const port = {
    read: () => state,
    dispatch,
    subscribe(f: () => void) {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  const removed = 'a'.repeat(1100) + '😀',
    inserted = 'Z'.repeat(1200) + '😀';
  const values = [
    {
      inputState: 'phase:in',
      outputState: 'phase:out',
      range: { start: 5, end: 1107 },
      removed,
      inserted,
    },
    {
      inputState: 'phase:in',
      outputState: 'phase:out',
      range: { start: 1500, end: 1501 },
      removed: 'x',
      inserted: '',
    },
  ];
  const effects: Record<string, unknown>[] = values.map((v, i) => ({
    kind: 'sourceEffect',
    reason: 'phantom-scrub',
    inputState: v.inputState,
    outputState: v.outputState,
    range: v.range,
    insertedLength: v.inserted.length,
    beforeDigest: hash(v.removed),
    afterDigest: hash(v.inserted),
    detailRef: `detail:${i}`,
  }));
  const pages = new Map<string, unknown[]>();
  // Independent metadata-tree fixture encoder, with scalar continuations; this
  // controlled oracle is separate from unchanged real Store producer fixtures.
  const encode = (value: unknown, id: string, parentId: string | null, key?: string): unknown => {
    const base = { id, parentId, ...(key === undefined ? {} : { key }) };
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) <= 1024) return { ...base, type: 'string', value };
      const valueRef = `${id}:value`;
      let offset = 0,
        text = '';
      const chunks: string[] = [];
      for (const scalar of value) {
        if (Buffer.byteLength(text + scalar) > 1024) {
          chunks.push(text);
          text = '';
        }
        text += scalar;
      }
      chunks.push(text);
      for (let i = 0; i < chunks.length; i++) {
        const ref = i === 0 ? valueRef : `${valueRef}@${offset}`;
        const next = offset + chunks[i].length;
        pages.set(ref, [
          {
            kind: 'fragment',
            id,
            field: key,
            offset,
            text: chunks[i],
            nextRef: i + 1 === chunks.length ? null : `${valueRef}@${next}`,
          },
        ]);
        offset = next;
      }
      return { ...base, type: 'string', valueRef };
    }
    if (typeof value === 'number') return { ...base, type: 'number', value };
    const childrenRef = `${id}:children`;
    pages.set(
      childrenRef,
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => encode(v, `${id}:${k}`, id, k)),
    );
    return { ...base, type: 'object', childrenRef };
  };
  values.forEach((v, i) => pages.set(`detail:${i}`, [encode(v, `root:${i}`, null)]));
  const frame = (kind: string, items: unknown[], cursor: string | null = null) => ({
    kind: 'noteOperationPage',
    scope: receipt.scope,
    operationId: receipt.operationId,
    headerDigest: receipt.headerDigest,
    payloadDigest: receipt.payloadDigest,
    viewId: receipt.viewId,
    sourceLength: 1900,
    expiresAt: receipt.receiptExpiresAt,
    outputKind: kind,
    items,
    nextCursor: cursor,
    ...(kind === 'effects' ? { convertedCount: 0 } : {}),
  });
  const transport = async (_method: string, raw: unknown) => {
    const q = raw as Record<string, unknown>;
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(2_000_000);
    expect(q).not.toHaveProperty('payloadDigest');
    expect(q.headerDigest).toBe(receipt.headerDigest);
    expect(q.maxWireBytes).toBe(8192);
    if (q.kind === 'effects') return frame('effects', effects);
    expect(q.kind).toBe('detail');
    expect(q.maxItems).toBe(16);
    const items = pages.get(String(q.ref));
    if (!items) throw new Error('Foreign detail ref');
    const index = q.cursor === undefined ? 0 : Number(String(q.cursor).slice(1));
    return frame(
      'detail',
      items.slice(index, index + 2),
      index + 2 < items.length ? `c${index + 2}` : null,
    );
  };
  rpc.mockReset();
  rpc.mockImplementation(transport);
  const client = new LiveNotePagesClient();
  const abort = new AbortController();
  const run = async () => {
    const lease = reserveNoteReceiptTranscript(
      port,
      client,
      receipt,
      1900,
      () => present,
      abort.signal,
      Date.now,
      262144,
    );
    try {
      const ready = await lease.ready;
      return await validateNoteStagedCanonicalEffects(client, receipt, 1900, 2000, ready, () => {
        if (!ready.current()) throw new Error('Lost owner');
      });
    } finally {
      await lease.release();
    }
  };
  return {
    run,
    abort,
    port,
    pages,
    effects,
    values,
    frame,
    transport,
    listeners,
    lose() {
      present = false;
      for (const f of [...listeners]) f();
      present = true;
      for (const f of [...listeners]) f();
    },
    clean() {
      expect(state.resourceLedger.used.payloadBytes).toBe(0);
      expect(state.resourceLedger.used.physicalReads).toBe(0);
      expect(listeners.size).toBe(0);
    },
  };
}

it('validates a bounded phase through header-only Live receipt reads without adoption authority', async () => {
  const f = fixture();
  const result = await f.run();
  expect(result).toEqual({
    kind: 'validatedCanonicalEffects',
    sourceEffects: 2,
    convertedCount: 0,
    createdTasks: 0,
    inputLength: 2000,
    outputLength: 2099,
  });
  expect(result).not.toHaveProperty('exactLocalResult');
  expect(Object.isFrozen(result)).toBe(true);
  expect(rpc).toHaveBeenCalledWith('note.operation.read', {
    ...receipt.scope,
    operationId: 'op',
    headerDigest: receipt.headerDigest,
    kind: 'effects',
    ref: 'effects',
    maxItems: 64,
    maxWireBytes: 8192,
  });
  expect(rpc.mock.calls.some(([, p]) => String((p as { ref: string }).ref).includes('@'))).toBe(
    true,
  );
  f.clean();
});
it.each([
  'phase',
  'range',
  'beforeDigest',
  'afterDigest',
  'budget',
  'foreign',
  'scalar',
  'fragmentId',
  'fragmentOffset',
  'extraField',
  'missingField',
  'cyclicRef',
])('refuses invalid canonical %s and releases all receipt debt', async (kind) => {
  const f = fixture();
  if (kind === 'phase') f.effects[1].inputState = 'other';
  if (kind === 'range') f.effects[1].range = { start: 0, end: 1 };
  if (kind === 'beforeDigest') f.effects[0].beforeDigest = '0'.repeat(64);
  if (kind === 'afterDigest') f.effects[0].afterDigest = '0'.repeat(64);
  if (kind === 'budget') f.effects[0].insertedLength = 32769;
  if (kind === 'foreign') f.effects[0].detailRef = 'foreign';
  const fragment = f.pages.get('root:0:inserted:value')![0] as Record<string, unknown>;
  if (kind === 'scalar') fragment.text = '\ud800';
  if (kind === 'fragmentId') fragment.id = 'foreign';
  if (kind === 'fragmentOffset') fragment.offset = 1;
  if (kind === 'cyclicRef') fragment.nextRef = 'root:0:inserted:value';
  if (kind === 'extraField') (f.pages.get('detail:0')![0] as Record<string, unknown>).extra = true;
  if (kind === 'missingField') f.pages.get('root:0:children')!.pop();
  await expect(f.run()).rejects.toThrow();
  f.clean();
});
it.each(['scope', 'viewId', 'headerDigest', 'expiresAt'])(
  'rejects foreign %s envelopes using the actual receipt reader',
  async (key) => {
    const f = fixture();
    rpc.mockImplementation(async (m, q) => ({
      ...(await f.transport(m, q)),
      [key]: key === 'scope' ? { ...receipt.scope, noteId: 'foreign' } : 'foreign',
    }));
    await expect(f.run()).rejects.toThrow('receipt page');
    f.clean();
  },
);
it.each(['cancel', 'loss'])(
  'retains physical detail IO through %s until settlement',
  async (mode) => {
    const f = fixture(),
      io = deferred<unknown>(),
      entered = deferred<void>();
    rpc.mockImplementation(async (m, q) => {
      const page = await f.transport(m, q);
      if ((q as { kind: string }).kind === 'detail') {
        entered.resolve();
        return io.promise;
      }
      return page;
    });
    const run = f.run(),
      observed = expect(run).rejects.toThrow();
    await entered.promise;
    if (mode === 'cancel') f.abort.abort();
    else f.lose();
    expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
    expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    io.resolve(f.frame('detail', f.pages.get('detail:0')!));
    await observed;
    f.clean();
    expect(
      rpc.mock.calls.filter(([, q]) => (q as { kind: string }).kind === 'detail'),
    ).toHaveLength(1);
  },
);
it('denied admission performs no transport', async () => {
  const f = fixture();
  f.port.dispatch(
    a.pageResourceLimitsConfigured({ ...f.port.read().resourceLedger.limit, physicalReads: 0 }),
  );
  await expect(f.run()).rejects.toThrow('admission denied');
  expect(rpc).not.toHaveBeenCalled();
  f.clean();
});
it('expiry during a retained detail read refuses the page without early debt release', async () => {
  const f = fixture(),
    io = deferred<unknown>(),
    entered = deferred<void>();
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2098-12-31T23:59:59Z'));
  rpc.mockImplementation(async (m, q) => {
    const page = await f.transport(m, q);
    if ((q as { kind: string }).kind === 'detail') {
      entered.resolve();
      return io.promise;
    }
    return page;
  });
  const run = f.run(),
    observed = expect(run).rejects.toThrow();
  try {
    await entered.promise;
    now.mockReturnValue(Date.parse(receipt.receiptExpiresAt));
    expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
    io.resolve(f.frame('detail', f.pages.get('detail:0')!));
    await observed;
    f.clean();
  } finally {
    now.mockRestore();
  }
});

it('resolves phase-state valueRefs as well as inline strings', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    for (const key of ['inputState', 'outputState']) {
      const entry = f.pages
        .get(`root:${i}:children`)!
        .find((v) => (v as { key: string }).key === key) as Record<string, unknown>;
      const value = entry.value;
      delete entry.value;
      entry.valueRef = `${entry.id}:state`;
      f.pages.set(String(entry.valueRef), [
        { kind: 'fragment', id: entry.id, field: key, offset: 0, text: value, nextRef: null },
      ]);
    }
  }
  await expect(f.run()).resolves.toMatchObject({ sourceEffects: 2 });
  f.clean();
});
it.each(['removed', 'inserted'])(
  'refuses oversized inline %s despite correct length and digest',
  async (key) => {
    const f = fixture();
    const entry = f.pages
      .get('root:0:children')!
      .find((v) => (v as { key: string }).key === key) as Record<string, unknown>;
    delete entry.valueRef;
    entry.value = f.values[0][key as 'removed' | 'inserted'];
    await expect(f.run()).rejects.toThrow('Unsupported canonical receipt detail');
    f.clean();
  },
);
