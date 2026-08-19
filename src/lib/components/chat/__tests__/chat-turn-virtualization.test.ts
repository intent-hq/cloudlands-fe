import { describe, expect, it } from 'vitest';
import {
  FORCE_VISIBLE_TURN_COUNT,
  INITIAL_LAZY_MODE_TRACKER,
  LAZY_TURN_THRESHOLD,
  isOlderHistoryPrepend,
  isTurnInRecentWindow,
  nextLazyMode,
  shouldVirtualizeTurns,
} from '../chat-turn-virtualization';

describe('chat turn retention policy', () => {
  it('virtualizes only large transcripts', () => {
    expect(LAZY_TURN_THRESHOLD).toBe(20);
    expect(shouldVirtualizeTurns(LAZY_TURN_THRESHOLD)).toBe(false);
    expect(shouldVirtualizeTurns(LAZY_TURN_THRESHOLD + 1)).toBe(true);
  });

  it('keeps a short trailing window permanently materialized', () => {
    expect(FORCE_VISIBLE_TURN_COUNT).toBe(3);
    expect(isTurnInRecentWindow(996, 1_000)).toBe(false);
    expect(isTurnInRecentWindow(997, 1_000)).toBe(true);
    expect(isTurnInRecentWindow(999, 1_000)).toBe(true);
  });
});

describe('older-history prepend detection', () => {
  it('detects a pure prepend: the list grew but the newest row is unchanged', () => {
    expect(isOlderHistoryPrepend(2, 'm-newest', 5, 'm-newest')).toBe(true);
  });

  it('does not flag appended messages (newest row changed)', () => {
    expect(isOlderHistoryPrepend(2, 'm-newest', 3, 'm-appended')).toBe(false);
  });

  it('does not flag the initial hydration (previously empty transcript)', () => {
    expect(isOlderHistoryPrepend(0, undefined, 50, 'm-newest')).toBe(false);
  });

  it('does not flag unchanged or shrunk lists', () => {
    expect(isOlderHistoryPrepend(3, 'm-newest', 3, 'm-newest')).toBe(false);
    expect(isOlderHistoryPrepend(3, 'm-newest', 2, 'm-newest')).toBe(false);
  });

  it('does not flag a transition to an empty list', () => {
    expect(isOlderHistoryPrepend(3, 'm-newest', 0, undefined)).toBe(false);
  });

  it('intentionally matches interior insertions (growth with unchanged newest row)', () => {
    // e.g. a late-arriving row with an older timestamp sorting mid-list, or the
    // near-simultaneous-send ordering repair — these stay scroll-neutral too.
    expect(isOlderHistoryPrepend(3, 'm-newest', 4, 'm-newest')).toBe(true);
  });
});

describe('latched lazy-mode decision', () => {
  const over = LAZY_TURN_THRESHOLD + 5;

  it('virtualizes an already-large transcript on initial mount', () => {
    const next = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 100, 'm-100', over);
    expect(next.mode).toBe(true);
  });

  it('keeps a small transcript unvirtualized on initial mount', () => {
    const next = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 4, 'm-4', 2);
    expect(next.mode).toBe(false);
  });

  it('latches the reveal-time mode across an older-history prepend past the threshold', () => {
    const revealed = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 8, 'm-8', 4);
    expect(revealed.mode).toBe(false);
    const prepended = nextLazyMode(revealed, 490, 'm-8', over);
    expect(prepended.mode).toBe(false);
  });

  it('flips at the threshold on a genuine append after a latched prepend', () => {
    const revealed = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 8, 'm-8', 4);
    const prepended = nextLazyMode(revealed, 490, 'm-8', over);
    const appended = nextLazyMode(prepended, 491, 'm-appended', over + 1);
    expect(appended.mode).toBe(true);
  });

  it('re-evaluation with unchanged inputs is idempotent', () => {
    const first = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 100, 'm-100', over);
    const second = nextLazyMode(first, 100, 'm-100', over);
    expect(second).toEqual(first);
  });

  it('fails open when a prepend coalesces with an append (newest row changed)', () => {
    const revealed = nextLazyMode(INITIAL_LAZY_MODE_TRACKER, 8, 'm-8', 4);
    const coalesced = nextLazyMode(revealed, 491, 'm-appended', over);
    expect(coalesced.mode).toBe(true);
  });
});
