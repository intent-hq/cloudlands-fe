/**
 * Behavioral tests for the width-validated LazyTurn height cache
 * (lazy-turn-height-cache.ts).
 *
 * Cached turn heights are only valid at the wrap width they were measured
 * at — stale-width entries are what fabricate phantom space at the bottom
 * of the chat. Entries carry their measurement width and reads validate it,
 * which stays correct across panel remounts (the global cache outlives any
 * scroller element) and across multiple panels at different stable widths —
 * the failure modes of the earlier clear-on-width-change stamp.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTurnHeightCache,
  readCachedHeight,
  writeCachedHeight,
  WIDTH_TOLERANCE_PX,
  type TurnHeightCache,
} from '../lazy-turn-height-cache';

describe('LazyTurn width-validated height cache', () => {
  let cache: TurnHeightCache;

  beforeEach(() => {
    cache = new Map();
  });

  it('returns a height only at (or within tolerance of) its measurement width', () => {
    writeCachedHeight(cache, 'turn-1', 480, 800);
    expect(readCachedHeight(cache, 'turn-1', 800)).toBe(480);
    // Sub-pixel wobble from zoom / display scaling is the same wrap width.
    expect(readCachedHeight(cache, 'turn-1', 800 + WIDTH_TOLERANCE_PX)).toBe(480);
    expect(readCachedHeight(cache, 'turn-1', 800 - WIDTH_TOLERANCE_PX)).toBe(480);
  });

  it('rejects a stale-width entry instead of fabricating phantom space', () => {
    // Measured wide (long lines, short turn), read narrow (re-wrapped,
    // taller turn): the 480px entry is now an underestimate — and the
    // opposite direction an overestimate, the phantom-space source.
    writeCachedHeight(cache, 'turn-1', 480, 800);
    expect(readCachedHeight(cache, 'turn-1', 500)).toBeNull();
    expect(readCachedHeight(cache, 'turn-1', 800 + WIDTH_TOLERANCE_PX + 0.5)).toBeNull();
  });

  it('validates per entry, so panels at different stable widths coexist in the one cache', () => {
    // Same transcript rendered in two panels: each panel's turns are cached
    // at that panel's width, and each panel only ever reads back entries
    // matching its own width — no cross-panel pollution, no churn.
    writeCachedHeight(cache, 'turn-1', 480, 800); // panel A
    writeCachedHeight(cache, 'turn-2', 720, 500); // panel B
    expect(readCachedHeight(cache, 'turn-1', 800)).toBe(480);
    expect(readCachedHeight(cache, 'turn-1', 500)).toBeNull();
    expect(readCachedHeight(cache, 'turn-2', 500)).toBe(720);
    expect(readCachedHeight(cache, 'turn-2', 800)).toBeNull();
  });

  it('catches a width change that happened while no scroller was mounted (remount gap)', () => {
    // The cache is global and outlives the panel. A window resize while the
    // panel is unmounted leaves no observer to see the change — validation
    // at read time catches it anyway.
    writeCachedHeight(cache, 'turn-1', 480, 800);
    // ... panel unmounts, window resizes, panel remounts at 640 ...
    expect(readCachedHeight(cache, 'turn-1', 640)).toBeNull();
  });

  it('re-measuring at the new width replaces the stale entry', () => {
    writeCachedHeight(cache, 'turn-1', 480, 800);
    writeCachedHeight(cache, 'turn-1', 640, 500);
    expect(readCachedHeight(cache, 'turn-1', 500)).toBe(640);
    expect(readCachedHeight(cache, 'turn-1', 800)).toBeNull();
  });

  it('returns an entry unvalidated for a null width (init-time read, no DOM yet)', () => {
    writeCachedHeight(cache, 'turn-1', 480, 800);
    expect(readCachedHeight(cache, 'turn-1', null)).toBe(480);
    expect(readCachedHeight(cache, 'missing', null)).toBeNull();
  });

  it('getTurnHeightCache returns one stable global instance', () => {
    const a = getTurnHeightCache();
    const b = getTurnHeightCache();
    expect(a).toBe(b);
  });
});
