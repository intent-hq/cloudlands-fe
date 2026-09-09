import { describe, expect, it } from 'vitest';
import {
  advancePlaybackCursor,
  playbackRate,
  playbackShortcut,
  snapPlaybackCursor,
  stepPlaybackEvent,
  TARGET_PLAYBACK_DURATION_MS,
} from '../playback';

describe('timeline playback', () => {
  it('advances uniformly through quiet stretches', () => {
    const result = advancePlaybackCursor(1_000, 250, 4, 60_000, 3);
    expect(result.cursorMs).toBe(4_000);
    expect(result.reachedEnd).toBe(false);
  });

  it('reports the end and steps across distinct event timestamps', () => {
    expect(advancePlaybackCursor(900, 100, 1, 1_000)).toEqual({
      cursorMs: 1_000,
      reachedEnd: true,
    });
    expect(stepPlaybackEvent([100, 200, 200, 300], 200, -1)).toBe(100);
    expect(stepPlaybackEvent([100, 200, 200, 300], 200, 1)).toBe(300);
  });

  it('bounds dense multi-hour stories to one minute at 1x', () => {
    const span = 180 * 60_000;
    const rate = playbackRate(span);
    let cursorMs = 0;
    let reachedEnd = false;

    for (let elapsed = 0; elapsed < TARGET_PLAYBACK_DURATION_MS; elapsed += 1_000) {
      ({ cursorMs, reachedEnd } = advancePlaybackCursor(cursorMs, 1_000, 1, span, rate));
    }

    expect(rate).toBe(180);
    expect(cursorMs).toBe(span);
    expect(reachedEnd).toBe(true);
  });

  it('keeps short spans at realtime speed', () => {
    expect(playbackRate(30_000)).toBe(1);
  });

  it('snaps graph updates to the latest crossed event timestamp', () => {
    const eventTimes = [100, 200, 300];
    expect([100, 150, 199].map((cursor) => snapPlaybackCursor(eventTimes, cursor))).toEqual([
      100, 100, 100,
    ]);
    expect(snapPlaybackCursor(eventTimes, 200)).toBe(200);
    expect(snapPlaybackCursor(eventTimes, 250)).toBe(200);
  });

  it('maps the documented keyboard shortcuts', () => {
    expect([' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'l', 'L'].map(playbackShortcut)).toEqual(
      ['toggle', 'previous', 'next', 'start', 'end', 'live', 'live'],
    );
    expect(playbackShortcut('Escape')).toBeNull();
  });
});
