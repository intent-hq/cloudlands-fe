import { describe, expect, it } from 'vitest';
import {
  createOperationalRowWindow,
  operationalRowKey,
  type OperationalRowDescriptor,
} from '../operational-row-window';

function rows(count: number, scopeId = 'message', start = 0): OperationalRowDescriptor[] {
  return Array.from({ length: count }, (_, offset) => ({
    key: operationalRowKey(scopeId, `block-${start + offset}`, 'summary'),
    scopeId,
    kind: 'tool',
    estimatedHeight: 10,
  }));
}

function settle(policy: ReturnType<typeof createOperationalRowWindow>, firstFrame = 1) {
  let frame = firstFrame;
  while (policy.snapshot().pendingKeys.length) {
    const pending = policy.snapshot().pendingKeys.length;
    expect(policy.advanceFrame(frame++)).toHaveLength(Math.min(4, pending));
    if (frame > firstFrame + 1000) throw new Error('Admission failed to settle');
  }
  return frame;
}

describe('panel-wide operational row window', () => {
  it.each([100, 10000])('bounds one huge message of %i children', (count) => {
    const policy = createOperationalRowWindow();
    const entries = rows(count);
    policy.setEntries(entries);
    policy.setViewport({ top: 400, bottom: 450 });
    expect(policy.snapshot().mountedKeys).toEqual([]);
    expect(policy.snapshot().visibleKeys).toEqual(entries.slice(40, 45).map((r) => r.key));
    expect(policy.advanceFrame(1)).toEqual(entries.slice(40, 44).map((r) => r.key));
    settle(policy, 2);
    expect(policy.snapshot().mountedKeys).toHaveLength(5 + 24);
    expect(policy.snapshot().segments.filter((s) => s.type === 'spacer')).toHaveLength(2);
  });

  it('shares overscan and admissions across many messages and nested group children', () => {
    const policy = createOperationalRowWindow();
    const entries = Array.from({ length: 100 }, (_, i) => rows(20, `message-${i}`)).flat();
    entries[100].kind = 'group';
    policy.setEntries(entries);
    policy.setViewport({ top: 1000, bottom: 1010 });
    expect(policy.advanceFrame(1)).toContain(entries[100].key);
    expect(policy.advanceFrame(1)).toEqual([]);
    settle(policy, 2);
    expect(policy.snapshot().mountedKeys).toHaveLength(25);
    expect(policy.snapshot().mountedKeys).not.toContain(entries[119].key);
  });

  it('counts each emitted reasoning title as a separate admission', () => {
    const policy = createOperationalRowWindow();
    // The adapter emits individual title rows, including titles sharing one source block.
    const entries = rows(80).map((row, i) => ({
      ...row,
      key: operationalRowKey('message', 'one-thinking-block', `title-${i}`),
      kind: 'reasoning' as const,
    }));
    policy.setEntries(entries);
    policy.setViewport({ top: 0, bottom: 50 });
    expect(policy.advanceFrame(1)).toHaveLength(4);
    settle(policy, 2);
    expect(policy.snapshot().mountedKeys).toHaveLength(17);
  });

  it('scales with a large viewport rather than imposing a fixed total cap', () => {
    const policy = createOperationalRowWindow();
    policy.setEntries(rows(1000));
    policy.setViewport({ top: 1000, bottom: 6000 });
    settle(policy);
    expect(policy.snapshot().visibleKeys).toHaveLength(500);
    expect(policy.snapshot().mountedKeys).toHaveLength(524);
  });

  it('evicts stale candidates immediately and prioritizes new visible rows', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(1000);
    policy.setEntries(entries);
    policy.setViewport({ top: 0, bottom: 50 });
    policy.advanceFrame(100);
    policy.setViewport({ top: 5000, bottom: 5050 });
    expect(policy.snapshot().mountedKeys).toEqual([]);
    expect(policy.advanceFrame(100)).toEqual([]);
    expect(policy.advanceFrame(99)).toEqual([]);
    expect(policy.advanceFrame(101)).toEqual(entries.slice(500, 504).map((r) => r.key));
  });

  it('does not renew the same-frame allowance after entries, pins or scopes change', () => {
    const policy = createOperationalRowWindow();
    policy.setEntries(rows(2, 'old'));
    policy.setViewport({ top: 0, bottom: 100 });
    expect(policy.advanceFrame(1)).toHaveLength(2);
    policy.releaseScope('old');
    const next = rows(100, 'new');
    policy.setEntries(next);
    policy.setPins(next.slice(90).map((r) => r.key));
    expect(policy.advanceFrame(1)).toHaveLength(2);
    expect(policy.advanceFrame(1)).toEqual([]);
  });

  it('caps offscreen pins, deduplicates them, and evicts released pins', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(1000);
    policy.setEntries(entries);
    policy.setViewport({ top: 400, bottom: 450 });
    policy.setPins([
      entries[40].key,
      entries[900].key,
      entries[900].key,
      entries[901].key,
      entries[902].key,
    ]);
    expect(policy.advanceFrame(1)).toEqual(entries.slice(40, 44).map((r) => r.key));
    settle(policy, 2);
    expect(policy.snapshot().pinnedKeys).toEqual([entries[900].key, entries[901].key]);
    expect(policy.snapshot().mountedKeys).toHaveLength(31);
    expect(policy.snapshot().mountedKeys).not.toContain(entries[902].key);
    policy.setPins([]);
    expect(policy.snapshot().mountedKeys).toHaveLength(29);
    expect(policy.snapshot().mountedKeys).not.toContain(entries[900].key);
  });

  it('preserves measured heights and mounted identity through prepend, append and regrouping', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(100);
    policy.setEntries(entries);
    policy.measure([{ key: entries[40].key, height: 30 }]);
    policy.setViewport({ top: 400, bottom: 430 });
    settle(policy);
    const before = policy.snapshot().mountedKeys;
    policy.setEntries(
      [...rows(10, 'older'), ...entries.map((r) => ({ ...r })), ...rows(100, 'tail')],
      { top: 500, bottom: 530 },
    );
    expect(policy.snapshot().visibleKeys).toEqual([entries[40].key]);
    expect(policy.snapshot().mountedKeys).toEqual(before);
    expect(policy.snapshot().totalHeight).toBe(2120);
    expect(policy.locate(entries[40].key)).toEqual({ index: 50, top: 500, height: 30 });
  });

  it('accounts for content gaps without spending operational admissions on prose', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(50);
    policy.setEntries([
      ...entries.slice(0, 25),
      { key: 'prose', scopeId: 'message', kind: 'content', estimatedHeight: 5000 },
      ...entries.slice(25),
    ]);
    policy.setViewport({ top: 2000, bottom: 2100 });
    settle(policy);
    expect(policy.snapshot().visibleKeys).toEqual([]);
    expect(policy.snapshot().mountedKeys).toHaveLength(24);
    expect(policy.snapshot().segments.some((s) => s.type === 'content' && s.key === 'prose')).toBe(
      true,
    );
    expect(policy.snapshot().totalHeight).toBe(5500);
  });

  it('coalesces all unmounted contiguous rows and conserves height including pending rows', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(1000);
    policy.setEntries(entries);
    policy.setViewport({ top: 400, bottom: 450 });
    expect(policy.snapshot().segments).toEqual([
      expect.objectContaining({ type: 'spacer', start: 0, end: 1000, height: 10000 }),
    ]);
    policy.advanceFrame(1);
    const snapshot = policy.snapshot();
    expect(snapshot.segments).toHaveLength(6);
    expect(snapshot.segments.reduce((sum, segment) => sum + segment.height, 0)).toBe(10000);
    expect(snapshot.segments.filter((s) => s.type === 'row').map((s) => s.key)).toEqual(
      entries.slice(40, 44).map((r) => r.key),
    );
  });

  it('uses collision-safe identities independent of parent group or mutable tool data', () => {
    expect(operationalRowKey('a:b', 'c', 'd')).not.toBe(operationalRowKey('a', 'b:c', 'd'));
    const policy = createOperationalRowWindow();
    const entries = rows(1);
    expect(() => policy.setEntries([...entries, ...entries])).toThrow(/duplicate/i);
    policy.setEntries(entries);
    policy.setViewport({ top: 0, bottom: 10 });
    policy.advanceFrame(1);
    const header = { ...rows(1, 'group')[0], kind: 'group' as const };
    policy.setEntries([header, { ...entries[0], estimatedHeight: 50 }]);
    expect(policy.snapshot().mountedKeys).toEqual([entries[0].key]);
    expect(policy.advanceFrame(1)).toEqual([header.key]);
    expect(policy.locate(entries[0].key)).toEqual({ index: 1, top: 10, height: 50 });
  });

  it('releases scope metadata, heights and pins, and permanently disposes the panel', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(50, 'removed');
    policy.setEntries(entries);
    policy.setViewport({ top: 0, bottom: 20 });
    policy.measure([{ key: entries[0].key, height: 50 }]);
    policy.setPins([entries[49].key]);
    policy.advanceFrame(1);
    policy.releaseScope('removed');
    expect(policy.snapshot().totalHeight).toBe(0);
    expect(policy.snapshot().mountedKeys).toEqual([]);
    expect(policy.snapshot().pinnedKeys).toEqual([]);
    expect(policy.locate(entries[0].key)).toBeUndefined();
    policy.setEntries(entries);
    expect(policy.snapshot().totalHeight).toBe(500);
    policy.dispose();
    policy.setEntries(entries);
    policy.setViewport({ top: 0, bottom: 100 });
    policy.setPins([entries[0].key]);
    expect(policy.advanceFrame(2)).toEqual([]);
    expect(policy.snapshot().segments).toEqual([]);
  });

  it('matches a brute-force variable-height viewport oracle while scrolling both directions', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(300).map((row, i) => ({ ...row, estimatedHeight: 7 + ((i * 17) % 53) }));
    let top = 0;
    const geometry = entries.map((row) => {
      const box = { key: row.key, top, bottom: top + row.estimatedHeight };
      top = box.bottom;
      return box;
    });
    policy.setEntries(entries);
    let frame = 1;
    for (const position of [0, 1, 7, 43, 801, 2000, top - 350, top, top + 100, 1200, 0]) {
      const viewport = { top: position, bottom: position + 311 };
      policy.setViewport(viewport);
      const visible = geometry.filter(
        (box) => box.bottom > viewport.top && box.top < viewport.bottom,
      );
      const before = geometry.filter((box) => box.bottom <= viewport.top).slice(-12);
      const after = geometry.filter((box) => box.top >= viewport.bottom).slice(0, 12);
      expect(policy.snapshot().visibleKeys).toEqual(visible.map((box) => box.key));
      frame = settle(policy, frame);
      expect(new Set(policy.snapshot().mountedKeys)).toEqual(
        new Set([...before, ...visible, ...after].map((box) => box.key)),
      );
      expect(policy.snapshot().segments.reduce((sum, segment) => sum + segment.height, 0)).toBe(
        top,
      );
    }
  });

  it('reclassifies visibility after batched row resizing without granting new admissions', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(100);
    policy.setEntries(entries);
    policy.setViewport({ top: 400, bottom: 450 });
    policy.advanceFrame(1);
    policy.measure([
      { key: entries[0].key, height: 1000 },
      { key: 'stale', height: 9000 },
    ]);
    expect(policy.snapshot().visibleKeys).toEqual([entries[0].key]);
    expect(policy.snapshot().mountedKeys).toEqual([]);
    expect(policy.advanceFrame(1)).toEqual([]);
    expect(policy.advanceFrame(2)[0]).toBe(entries[0].key);
    expect(policy.snapshot().totalHeight).toBe(1990);
  });

  it('ignores stale removed-row measurements before validating a live resize batch', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(2);
    policy.setEntries(entries);
    policy.setEntries(entries.slice(0, 1));
    expect(() =>
      policy.measure([
        { key: entries[0].key, height: 25 },
        { key: entries[1].key, height: 0 },
        { key: 'stale', height: NaN },
      ]),
    ).not.toThrow();
    expect(policy.locate(entries[0].key)?.height).toBe(25);
    expect(policy.snapshot().totalHeight).toBe(25);
  });

  it('charges outer-renderer remounts again while retaining descriptors and measured geometry', () => {
    const policy = createOperationalRowWindow();
    const entries = rows(4);
    const keys = entries.map((entry) => entry.key);
    policy.setEntries(entries);
    policy.measure([{ key: keys[0], height: 35 }]);
    policy.setViewport({ top: 0, bottom: 100 });
    expect(policy.advanceFrame(1)).toEqual(keys);
    policy.invalidateMounts(keys);
    policy.invalidateMounts(keys);
    expect(policy.snapshot().mountedKeys).toEqual([]);
    expect(policy.snapshot().pendingKeys).toEqual(keys);
    expect(policy.snapshot().totalHeight).toBe(65);
    expect(policy.locate(keys[0])?.height).toBe(35);
    expect(policy.advanceFrame(1)).toEqual([]);
    expect(policy.advanceFrame(2)).toEqual(keys);
    policy.invalidateMounts([keys[0], 'unknown']);
    expect(policy.advanceFrame(2)).toEqual([]);
    expect(policy.advanceFrame(3)).toEqual([keys[0]]);
    expect(policy.snapshot().mountedKeys).toEqual(keys);
  });

  it('rejects invalid geometry instead of allowing NaN to erase bounds', () => {
    const policy = createOperationalRowWindow();
    expect(() => policy.setEntries([{ ...rows(1)[0], estimatedHeight: 0 }])).toThrow();
    policy.setEntries(rows(10));
    expect(() => policy.measure([{ key: rows(1)[0].key, height: NaN }])).toThrow();
    expect(() => policy.setViewport({ top: 0, bottom: Infinity })).toThrow();
    expect(() => policy.advanceFrame(NaN)).toThrow();
    policy.setViewport({ top: 10, bottom: 10 });
    expect(policy.snapshot().pendingKeys).toEqual([]);
  });
});
