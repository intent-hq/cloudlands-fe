import { describe, expect, it } from 'vitest';
import {
  FORCE_VISIBLE_TURN_COUNT,
  LAZY_TURN_THRESHOLD,
  isOlderHistoryPrepend,
  isTurnInRecentWindow,
  shouldVirtualizeTurns,
} from '../chat-turn-virtualization';

describe('chat turn retention policy', () => {
  it('virtualizes only large transcripts', () => {
    expect(shouldVirtualizeTurns(LAZY_TURN_THRESHOLD)).toBe(false);
    expect(shouldVirtualizeTurns(LAZY_TURN_THRESHOLD + 1)).toBe(true);
  });

  it('keeps only the current turn permanently materialized', () => {
    expect(FORCE_VISIBLE_TURN_COUNT).toBe(1);
    expect(isTurnInRecentWindow(998, 1_000)).toBe(false);
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
});
