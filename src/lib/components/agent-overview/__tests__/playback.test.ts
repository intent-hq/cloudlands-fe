import { describe, expect, it } from 'vitest';
import {
  advancePlaybackCursor,
  MAX_PLAYBACK_GAP_MS,
  playbackShortcut,
  stepPlaybackEvent,
} from '../playback';

describe('timeline playback', () => {
  it('skips idle stretches while preserving thirty seconds before the next event', () => {
    const nextEvent = 10 * 60_000;
    const result = advancePlaybackCursor(0, 16, 4, [0, nextEvent], nextEvent);
    expect(result.cursorMs).toBe(nextEvent - MAX_PLAYBACK_GAP_MS);
    expect(result.reachedEnd).toBe(false);
  });

  it('reports the end and steps across distinct event timestamps', () => {
    expect(advancePlaybackCursor(900, 100, 1, [0, 500, 1_000], 1_000)).toEqual({
      cursorMs: 1_000,
      reachedEnd: true,
    });
    expect(stepPlaybackEvent([100, 200, 200, 300], 200, -1)).toBe(100);
    expect(stepPlaybackEvent([100, 200, 200, 300], 200, 1)).toBe(300);
  });

  it('maps the documented keyboard shortcuts', () => {
    expect([' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'l', 'L'].map(playbackShortcut)).toEqual(
      ['toggle', 'previous', 'next', 'start', 'end', 'live', 'live'],
    );
    expect(playbackShortcut('Escape')).toBeNull();
  });
});
