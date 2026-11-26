import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeldLease } from './held-lease';

describe('createHeldLease', () => {
  const acquire = vi.fn();
  const release = vi.fn();
  const lease = () => createHeldLease({ acquire, release, holdMs: 1_000 });

  beforeEach(() => {
    vi.useFakeTimers();
    acquire.mockClear();
    release.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('acquires on the first hold and releases once the hold time passes', () => {
    const drop = lease().hold();
    expect(acquire).toHaveBeenCalledTimes(1);
    drop();
    vi.advanceTimersByTime(999);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the lease when a new holder arrives within the hold time', () => {
    const held = lease();
    held.hold()();
    vi.advanceTimersByTime(500);
    const drop = held.hold();
    vi.advanceTimersByTime(5_000);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    drop();
    vi.advanceTimersByTime(1_000);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('acquires again after an expired hold', () => {
    const held = lease();
    held.hold()();
    vi.advanceTimersByTime(1_000);
    held.hold();
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('waits for every holder and ignores a repeated drop', () => {
    const held = lease();
    const first = held.hold();
    const second = held.hold();
    first();
    first();
    vi.advanceTimersByTime(5_000);
    expect(release).not.toHaveBeenCalled();
    second();
    vi.advanceTimersByTime(1_000);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
