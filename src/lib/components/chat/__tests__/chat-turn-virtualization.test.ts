import { describe, expect, it } from 'vitest';
import {
  FORCE_VISIBLE_TURN_COUNT,
  LAZY_TURN_THRESHOLD,
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
