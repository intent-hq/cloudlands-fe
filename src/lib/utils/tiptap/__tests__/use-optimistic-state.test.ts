import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import { useOptimisticState } from '../use-optimistic-state.svelte';

describe('useOptimisticState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with empty state', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>();

    expect(optimistic.get('checked')).toBeUndefined();
    expect(optimistic.state).toEqual({});
  });

  it('should set optimistic state', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    optimistic.set({ checked: true, status: 'done' });

    expect(optimistic.get('checked')).toBe(true);
    expect(optimistic.get('status')).toBe('done');
  });

  it('should merge multiple set calls', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string; other: number }>();

    optimistic.set({ checked: true });
    optimistic.set({ status: 'done' });

    expect(optimistic.get('checked')).toBe(true);
    expect(optimistic.get('status')).toBe('done');
  });

  it('should persist optimistic state across time without an auto-clear timer', async () => {
    vi.useFakeTimers();
    try {
      const optimistic = useOptimisticState<{ checked: boolean }>();

      optimistic.set({ checked: true });
      // Advance well past any historic auto-clear window — overlay must
      // persist because reconciliation is BE-driven, not timer-driven.
      vi.advanceTimersByTime(10_000);

      expect(optimistic.get('checked')).toBe(true);
      expect(optimistic.has('checked')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should manually clear state', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>();

    optimistic.set({ checked: true });
    expect(optimistic.get('checked')).toBe(true);

    optimistic.clear();
    expect(optimistic.get('checked')).toBeUndefined();
  });

  it('should check if key has optimistic state', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    expect(optimistic.has('checked')).toBe(false);

    optimistic.set({ checked: true });

    expect(optimistic.has('checked')).toBe(true);
    expect(optimistic.has('status')).toBe(false);
  });

  it('should return entire state object', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    optimistic.set({ checked: true, status: 'done' });

    expect(optimistic.state).toEqual({ checked: true, status: 'done' });
  });

  it('should handle undefined values', () => {
    const optimistic = useOptimisticState<{ checked?: boolean }>();

    optimistic.set({ checked: undefined });

    expect(optimistic.has('checked')).toBe(true);
    expect(optimistic.get('checked')).toBeUndefined();
  });

  it('should handle null values', () => {
    const optimistic = useOptimisticState<{ checked: boolean | null }>();

    optimistic.set({ checked: null });

    expect(optimistic.has('checked')).toBe(true);
    expect(optimistic.get('checked')).toBeNull();
  });

  it('commit() clears only the keys passed', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    optimistic.set({ checked: true, status: 'done' });
    optimistic.commit(['checked']);

    expect(optimistic.has('checked')).toBe(false);
    expect(optimistic.get('status')).toBe('done');
  });

  it('commit() with no args clears all keys', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    optimistic.set({ checked: true, status: 'done' });
    optimistic.commit();

    expect(optimistic.state).toEqual({});
  });

  it('rollback() clears only the keys passed', () => {
    const optimistic = useOptimisticState<{ checked: boolean; status: string }>();

    optimistic.set({ checked: true, status: 'done' });
    optimistic.rollback(['status']);

    expect(optimistic.has('status')).toBe(false);
    expect(optimistic.get('checked')).toBe(true);
  });

  it('rollback() with no args clears all keys', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>();

    optimistic.set({ checked: true });
    optimistic.rollback();

    expect(optimistic.state).toEqual({});
  });
});

/**
 * BE-driven reconciliation: the optimistic overlay must persist until a
 * mock BE response arrives, then commit on success / roll back on error.
 * No timer ever clears it.
 */
describe('useOptimisticState — BE-driven reconciliation', () => {
  type Attrs = { checked: boolean };

  // Minimal deferred used to stand in for a BE mutation response (e.g. an
  // ipc.invoke('note:update', …) promise). Keeping the BE simulation at
  // the Promise layer is sufficient for this unit — the hook itself has
  // no IPC dependency; it's the *caller* that wires the mutation result
  // into commit()/rollback().
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('persists optimistic value until the mock BE response resolves, then commits', async () => {
    const optimistic = useOptimisticState<Attrs>();
    // The actual (BE-owned) attrs the renderer would otherwise read.
    let beAttrs: Attrs = { checked: false };
    const derived = () => optimistic.get('checked') ?? beAttrs.checked;

    const beResponse = deferred<{ ok: true }>();

    // User toggles the checkbox: optimistic overlay flips immediately.
    optimistic.set({ checked: true });
    expect(derived()).toBe(true);

    // BE hasn't responded yet. The overlay must still be present — no
    // amount of microtask flushing should clear it on a timer.
    await Promise.resolve();
    await Promise.resolve();
    expect(optimistic.has('checked')).toBe(true);
    expect(derived()).toBe(true);

    // BE confirms the mutation. The caller mirrors the new BE-owned
    // attrs and commits the overlay; derived value stays `true`, now
    // from the actual BE state rather than the overlay.
    beResponse.resolve({ ok: true });
    await beResponse.promise.then(() => {
      beAttrs = { checked: true };
      optimistic.commit();
    });

    expect(optimistic.has('checked')).toBe(false);
    expect(derived()).toBe(true);
  });

  it('rolls back to the prior BE state when the mock BE response rejects', async () => {
    const optimistic = useOptimisticState<Attrs>();
    let beAttrs: Attrs = { checked: false };
    const derived = () => optimistic.get('checked') ?? beAttrs.checked;

    const beResponse = deferred<{ ok: true }>();

    optimistic.set({ checked: true });
    expect(derived()).toBe(true);

    // BE rejects. Caller rolls back the overlay; derived value falls
    // back to the unchanged BE-owned state.
    beResponse.reject(new Error('be rejected the mutation'));
    await beResponse.promise.catch(() => {
      optimistic.rollback();
    });

    expect(optimistic.has('checked')).toBe(false);
    expect(beAttrs.checked).toBe(false);
    expect(derived()).toBe(false);
  });
});
