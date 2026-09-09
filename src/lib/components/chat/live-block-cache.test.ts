import { describe, expect, it, vi } from 'vitest';
import { LiveBlockCache } from './live-block-cache';

describe('LiveBlockCache', () => {
  it('retains only the current long-stream inputs through completion and teardown', () => {
    const cache = new LiveBlockCache<string, string, string>();
    const compute = vi.fn((input: string) => input);
    let text = '';

    for (let update = 0; update < 200; update++) {
      text += 'stream payload '.padEnd(1024, 'x');
      cache.reconcile([{ key: 'text-1', input: text, context: 'workspace-1' }], compute);
    }

    expect(cache.size).toBe(1);
    expect(cache.retainedInputSize).toBe(text.length);
    expect(compute).toHaveBeenCalledTimes(200);

    cache.reconcile([{ key: 'text-1', input: text, context: 'workspace-1' }], compute);
    expect(compute).toHaveBeenCalledTimes(200);
    expect(cache.retainedInputSize).toBe(text.length);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.retainedInputSize).toBe(0);
  });

  it('reuses stable siblings and invalidates changes, removal, reorder, and context', () => {
    const cache = new LiveBlockCache<string, string, { input: string; sequence: number }>();
    let sequence = 0;
    const compute = vi.fn((input: string) => ({ input, sequence: ++sequence }));
    const reconcile = (items: Array<{ key: string; input: string; context?: string }>) =>
      cache.reconcile(
        items.map((item) => ({ ...item, context: item.context ?? 'workspace-1' })),
        compute,
      );

    const initial = reconcile([
      { key: 'a', input: 'same text' },
      { key: 'b', input: 'same text' },
    ]);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(initial.get('a')).not.toBe(initial.get('b'));

    const reordered = reconcile([
      { key: 'b', input: 'same text' },
      { key: 'a', input: 'same text' },
    ]);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(reordered.get('a')).toBe(initial.get('a'));
    expect(reordered.get('b')).toBe(initial.get('b'));

    reconcile([
      { key: 'b', input: 'changed text' },
      { key: 'a', input: 'same text' },
    ]);
    expect(compute).toHaveBeenCalledTimes(3);

    reconcile([{ key: 'b', input: 'changed text' }]);
    expect(cache.size).toBe(1);

    reconcile([{ key: 'b', input: 'changed text', context: 'workspace-2' }]);
    expect(compute).toHaveBeenCalledTimes(4);
  });
});
