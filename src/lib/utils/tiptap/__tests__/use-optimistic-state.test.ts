import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOptimisticState } from '../use-optimistic-state.svelte';

describe('useOptimisticState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

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

  it('should auto-clear after delay', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>(50);

    optimistic.set({ checked: true });
    expect(optimistic.get('checked')).toBe(true);

    // Fast-forward time
    vi.advanceTimersByTime(50);

    expect(optimistic.get('checked')).toBeUndefined();
    expect(optimistic.state).toEqual({});
  });

  it('should use custom clear delay', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>(100);

    optimistic.set({ checked: true });

    // Should not clear after 50ms
    vi.advanceTimersByTime(50);
    expect(optimistic.get('checked')).toBe(true);

    // Should clear after 100ms
    vi.advanceTimersByTime(50);
    expect(optimistic.get('checked')).toBeUndefined();
  });

  it('should reset timer on subsequent set calls', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>(50);

    optimistic.set({ checked: true });

    // Advance 40ms
    vi.advanceTimersByTime(40);

    // Set again - should reset timer
    optimistic.set({ checked: false });

    // Advance 40ms more (total 80ms from first set, but only 40ms from second)
    vi.advanceTimersByTime(40);

    // Should still have state (timer was reset)
    expect(optimistic.get('checked')).toBe(false);

    // Advance 10ms more to complete the 50ms from second set
    vi.advanceTimersByTime(10);
    expect(optimistic.get('checked')).toBeUndefined();
  });

  it('should manually clear state', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>();

    optimistic.set({ checked: true });
    expect(optimistic.get('checked')).toBe(true);

    optimistic.clear();
    expect(optimistic.get('checked')).toBeUndefined();
  });

  it('should cancel timer when manually cleared', () => {
    const optimistic = useOptimisticState<{ checked: boolean }>(50);

    optimistic.set({ checked: true });
    optimistic.clear();

    // Advance time - should not auto-clear since we manually cleared
    vi.advanceTimersByTime(50);

    // State should still be empty (from manual clear)
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
});
