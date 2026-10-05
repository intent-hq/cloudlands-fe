import { afterEach, expect, it, vi } from 'vitest';
import { prepareNoteSave } from './note-edit-plan';
import { readNoteLocalReceiptResult } from './note-receipt-local-result';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { readNoteReceiptPage, type NoteReceiptReadRequest } from '$lib/client/note-receipt-reader';
import type { NoteCommitReceipt } from '$lib/client/note-pages';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
  const operation = await prepareNoteSave(
    {
      scope,
      sourceLength: 5,
      baseRevision: 'r1',
      operationId: '11111111-1111-1111-1111-111111111111',
      expiresAt: '2099-01-01T00:00:00.000Z',
      splices: [
        { start: 1, end: 1, text: '🦀' },
        { start: 4, end: 5, text: 'Z' },
      ],
    },
    Date.parse('2098-12-31T23:00:00Z'),
  );
  const receipt: NoteCommitReceipt = {
    kind: 'noteCommitReceipt',
    outcome: 'committed',
    scope,
    operationId: operation.operationId,
    payloadDigest: operation.payloadDigest,
    beforeRevision: 'r1',
    afterRevision: 'r2',
    sourceLength: 7,
    mappingRef: 'm',
    effectsRef: 'e',
    inverseRef: 'i',
    receiptExpiresAt: '2099-01-02T00:00:00Z',
    invalidation: 'all',
  };
  let state = a.initialNotePagesState,
    current = true;
  const listeners = new Set<() => void>();
  const port = {
    read: () => state,
    dispatch(action: Parameters<typeof a.notePagesReducer>[1]) {
      state = a.notePagesReducer(state, action);
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  port.dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 1_000_000,
      stringUnits: 1_000_000,
      objectNodes: 1_000_000,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  const mapping = [
    { start: 1, end: 1, insertedLength: 2 },
    { start: 4, end: 5, insertedLength: 1 },
  ];
  const effects: unknown[] = [
    {
      kind: 'annotationInvalidation',
      sourceRevision: 'r2',
      attributionGeneration: 'a2',
      commentRevision: 'c2',
    },
  ];
  const page = (q: NoteReceiptReadRequest, items: unknown[], nextCursor: string | null = null) => ({
    kind: 'noteOperationPage',
    outputKind: q.kind,
    scope,
    operationId: operation.operationId,
    payloadDigest: operation.payloadDigest,
    beforeRevision: 'r1',
    afterRevision: 'r2',
    sourceLength: 5,
    expiresAt: receipt.receiptExpiresAt,
    items,
    nextCursor,
    ...(q.kind === 'effects' ? { convertedCount: 0 } : {}),
  });
  const response = vi.fn(async (q: NoteReceiptReadRequest): Promise<unknown> =>
    page(q, q.kind === 'mapping' ? mapping : effects),
  );
  const readReceipt = vi.fn((r: NoteCommitReceipt, q: NoteReceiptReadRequest) => {
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    return readNoteReceiptPage(() => response(q), r, q);
  });
  const run = () =>
    readNoteLocalReceiptResult(port, { readReceipt }, receipt, operation, 5, () => current);
  const clean = () => {
    expect(state.resourceLedger.used.physicalReads).toBe(0);
    expect(state.resourceLedger.used.payloadBytes).toBe(0);
    expect(listeners.size).toBe(0);
  };
  return {
    operation,
    receipt,
    port,
    mapping,
    effects,
    response,
    readReceipt,
    page,
    run,
    clean,
    restore() {
      current = true;
      for (const fn of [...listeners]) fn();
    },
    revoke() {
      current = false;
      for (const fn of [...listeners]) fn();
    },
  };
}
it('exhausts both decoded roots and validates exact Unicode mapping, digest and length', async () => {
  const f = await fixture();
  const result = await f.run();
  expect(result).toEqual({
    receipt: f.receipt,
    baseLength: 5,
    sourceLength: 7,
    exactLocalResult: true,
  });
  expect(f.readReceipt.mock.calls.map((c) => c[1].kind)).toEqual(['mapping', 'effects']);
  f.clean();
});
it('drains over 96 effects pages with constant semantic state before returning success', async () => {
  const f = await fixture();
  let effects = 0;
  f.response.mockImplementation(async (q) => {
    if (q.kind === 'mapping') return f.page(q, f.mapping);
    expect(q.cursor).toBe(effects === 0 ? undefined : `e:${effects}`);
    effects++;
    return f.page(q, f.effects, effects === 130 ? null : `e:${effects}`);
  });
  expect((await f.run()).exactLocalResult).toBe(true);
  expect(effects).toBe(130);
  f.clean();
});
it.each(['missing', 'duplicate', 'reordered', 'wrong-length'] as const)(
  'refuses %s mapping without consuming it as a complete map',
  async (mode) => {
    const f = await fixture();
    if (mode === 'missing') f.mapping.pop();
    if (mode === 'duplicate') f.mapping.splice(1, 0, { ...f.mapping[0] });
    if (mode === 'reordered') f.mapping.reverse();
    if (mode === 'wrong-length') f.mapping[0].insertedLength = 1;
    await expect(f.run()).rejects.toThrow(/mapping/);
    expect(f.readReceipt).toHaveBeenCalledOnce();
    f.clean();
  },
);
it.each(['sourceEffect', 'warning', 'unknown'])(
  'refuses %s even when the final source length matches',
  async (kind) => {
    const f = await fixture();
    f.effects.push({
      kind,
      reason: 'anchor-repair',
      range: { start: 0, end: 1 },
      insertedLength: 1,
    });
    await expect(f.run()).rejects.toThrow('canonical reconciliation');
    f.clean();
  },
);
it('rejects a long-cycle empty-page effects transcript using constant cursor state', async () => {
  const f = await fixture();
  let count = 0;
  f.response.mockImplementation(async (q) =>
    q.kind === 'mapping' ? f.page(q, f.mapping) : f.page(q, [], ['a', 'b', 'c'][count++ % 3]),
  );
  await expect(f.run()).rejects.toThrow('Cyclic');
  expect(count).toBeLessThan(12);
  f.clean();
});
it('refuses matching receipt and operation digests that do not authenticate the captured text', async () => {
  const f = await fixture();
  const bad = { ...f.operation, payloadDigest: 'a'.repeat(64) };
  await expect(
    readNoteLocalReceiptResult(
      f.port,
      { readReceipt: f.readReceipt },
      { ...f.receipt, payloadDigest: bad.payloadDigest },
      bad,
      5,
      () => true,
    ),
  ).rejects.toThrow('digest mismatch');
  expect(f.readReceipt).not.toHaveBeenCalled();
  f.clean();
});
it('does not return a proof when ownership changes while the final page is in flight', async () => {
  const f = await fixture();
  f.response.mockImplementation(async (q) => {
    if (q.kind === 'effects') f.revoke();
    return f.page(q, q.kind === 'mapping' ? f.mapping : f.effects);
  });
  await expect(f.run()).rejects.toThrow('superseded');
  f.clean();
});
it('refuses changed annotation identity across effects pages', async () => {
  const f = await fixture();
  let index = 0;
  f.response.mockImplementation(async (q) =>
    q.kind === 'mapping'
      ? f.page(q, f.mapping)
      : f.page(
          q,
          [{ ...(f.effects[0] as object), commentRevision: `c${index++}` }],
          index === 1 ? 'next' : null,
        ),
  );
  await expect(f.run()).rejects.toThrow('annotation identity');
  f.clean();
});

it.each([false, true])(
  'validates mapping prefix across page boundaries (duplicate=%s)',
  async (duplicate) => {
    const f = await fixture();
    let index = 0;
    f.response.mockImplementation(async (q) => {
      if (q.kind === 'effects') return f.page(q, f.effects);
      expect(q.cursor).toBe(index === 0 ? undefined : 'mapping:1');
      const selected = duplicate ? 0 : index;
      return f.page(q, [f.mapping[selected]], index++ === 0 ? 'mapping:1' : null);
    });
    if (duplicate) await expect(f.run()).rejects.toThrow('mapping differs');
    else expect((await f.run()).exactLocalResult).toBe(true);
    f.clean();
  },
);
it('refuses nonzero aggregate even with empty effects items', async () => {
  const f = await fixture();
  f.response.mockImplementation(async (q) =>
    q.kind === 'mapping' ? f.page(q, f.mapping) : { ...f.page(q, []), convertedCount: 1 },
  );
  await expect(f.run()).rejects.toThrow('canonical reconciliation');
  f.clean();
});

it('retains DATA through held digest and refuses owner loss then revival before any RPC', async () => {
  const f = await fixture();
  let finish!: (value: ArrayBuffer) => void;
  const held = new Promise<ArrayBuffer>((resolve) => {
    finish = resolve;
  });
  const digest = vi.spyOn(crypto.subtle, 'digest').mockReturnValue(held);
  const pending = f.run();
  await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
  expect(f.readReceipt).not.toHaveBeenCalled();
  f.revoke();
  f.restore();
  expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
  const observed = expect(pending).rejects.toThrow('owner changed');
  finish(
    Uint8Array.from(f.operation.payloadDigest.match(/../g)!, (part) => parseInt(part, 16)).buffer,
  );
  await observed;
  expect(f.readReceipt).not.toHaveBeenCalled();
  f.clean();
});
it('rechecks latched ownership after awaited release before returning a local-result proof', async () => {
  const f = await fixture();
  const dispatch = f.port.dispatch;
  f.port.dispatch = (action) => {
    if (action.type === a.pageResourcesReleased.type) {
      f.revoke();
      f.restore();
    }
    dispatch(action);
  };
  await expect(f.run()).rejects.toThrow('during retirement');
  expect(f.readReceipt).toHaveBeenCalledTimes(2);
  f.clean();
});
it('rechecks original expiry after resource retirement', async () => {
  const f = await fixture();
  const dispatch = f.port.dispatch;
  f.port.dispatch = (action) => {
    if (action.type === a.pageResourcesReleased.type)
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(f.receipt.receiptExpiresAt));
    dispatch(action);
  };
  await expect(f.run()).rejects.toThrow('during retirement');
  f.clean();
});
