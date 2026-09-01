import { describe, expect, it } from 'vitest';
import { agentAvatarGeometry } from '../avatar-size';
import {
  computeAdaptiveVisibleCount,
  createDeferredWidthApplier,
  type AvatarStackFitOptions,
} from '../avatar-stack-fit';

// card-stack geometry: surface 24, overlap 6 → step 18.
const geometry = agentAvatarGeometry['card-stack'];

function fit(overrides: Partial<AvatarStackFitOptions>): number {
  return computeAdaptiveVisibleCount({
    itemCount: 5,
    maxVisible: 3,
    availableWidth: 200,
    surface: geometry.surface,
    overlap: geometry.overlap,
    overflowOverlap: geometry.overlap,
    measureOverflowText: () => 20,
    ...overrides,
  });
}

describe('computeAdaptiveVisibleCount', () => {
  it('shows every item when all fit within the cap and width', () => {
    // 3 avatars = 24 + 2*18 = 60
    expect(fit({ itemCount: 3, availableWidth: 60 })).toBe(3);
    expect(fit({ itemCount: 1, availableWidth: 24 })).toBe(1);
    expect(fit({ itemCount: 0, availableWidth: 100 })).toBe(0);
  });

  it('caps at maxVisible and reserves room for the overlapping overflow tile', () => {
    // 3 avatars (60) + tile (20) - overlap (6) = 74
    expect(fit({ availableWidth: 74 })).toBe(3);
    expect(fit({ availableWidth: 73 })).toBe(2);
  });

  it('drops avatars until avatars plus overflow label fit', () => {
    // 2 avatars (42) + tile (20) - overlap (6) = 56
    expect(fit({ availableWidth: 56 })).toBe(2);
    // 1 avatar (24) + tile (20) - overlap (6) = 38
    expect(fit({ availableWidth: 38 })).toBe(1);
  });

  it('omits overflow overlap when only the tile fits', () => {
    // 0 avatars + tile (20), no overlap
    expect(fit({ availableWidth: 20 })).toBe(0);
    expect(fit({ availableWidth: 5 })).toBe(0);
  });

  it('returns zero for non-positive widths', () => {
    expect(fit({ availableWidth: 0 })).toBe(0);
    expect(fit({ availableWidth: -10 })).toBe(0);
  });

  it('clamps a negative maxVisible to zero visible avatars', () => {
    expect(fit({ maxVisible: -1, availableWidth: 200 })).toBe(0);
  });

  it('uses the measured overflow text width', () => {
    // 2 avatars (42) + tile (60) - overlap (6) = 96 > 95 → drop to 1.
    expect(fit({ availableWidth: 95, measureOverflowText: () => 60 })).toBe(1);
  });

  it('measures the actual remaining count', () => {
    const seen: number[] = [];
    fit({
      itemCount: 10,
      maxVisible: 3,
      availableWidth: 38,
      measureOverflowText: (remaining) => {
        seen.push(remaining);
        return 20;
      },
    });
    // cap=3 → remaining 7, then 8, then 9 as the count shrinks to the 1-avatar floor.
    expect(seen).toEqual([7, 8, 9]);
  });
});

function createFakeFrameScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    schedule: (callback: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    unschedule: (handle: number) => {
      pending.delete(handle);
    },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

describe('createDeferredWidthApplier', () => {
  it('never applies in the delivering frame — only when the next frame runs', () => {
    const frames = createFakeFrameScheduler();
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      frames.schedule,
      frames.unschedule,
    );
    applier.set(120);
    expect(applied).toEqual([]);
    frames.flush();
    expect(applied).toEqual([120]);
  });

  it('coalesces multiple deliveries into one apply with the latest width', () => {
    const frames = createFakeFrameScheduler();
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      frames.schedule,
      frames.unschedule,
    );
    applier.set(120);
    applier.set(90);
    applier.set(64);
    expect(frames.pendingCount).toBe(1);
    frames.flush();
    expect(applied).toEqual([64]);
  });

  it('schedules a fresh frame for deliveries after an apply', () => {
    const frames = createFakeFrameScheduler();
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      frames.schedule,
      frames.unschedule,
    );
    applier.set(120);
    frames.flush();
    applier.set(80);
    expect(frames.pendingCount).toBe(1);
    frames.flush();
    expect(applied).toEqual([120, 80]);
  });

  it('cancel drops the pending apply', () => {
    const frames = createFakeFrameScheduler();
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      frames.schedule,
      frames.unschedule,
    );
    applier.set(120);
    applier.cancel();
    expect(frames.pendingCount).toBe(0);
    frames.flush();
    expect(applied).toEqual([]);
  });

  it('accepts new deliveries after cancel', () => {
    const frames = createFakeFrameScheduler();
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      frames.schedule,
      frames.unschedule,
    );
    applier.set(120);
    applier.cancel();
    applier.set(48);
    frames.flush();
    expect(applied).toEqual([48]);
  });

  it('does not wedge under a synchronously-invoking scheduler', () => {
    const applied: number[] = [];
    const applier = createDeferredWidthApplier(
      (w) => applied.push(w),
      (callback) => {
        callback();
        return 1;
      },
      () => {},
    );
    applier.set(120);
    applier.set(80);
    expect(applied).toEqual([120, 80]);
  });
});
