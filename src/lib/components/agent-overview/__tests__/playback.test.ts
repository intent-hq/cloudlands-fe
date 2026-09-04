import { describe, expect, it } from 'vitest';
import {
  advancePlaybackCursor,
  MAX_PLAYBACK_GAP_MS,
  playbackRate,
  playbackShortcut,
  snapPlaybackCursor,
  stepPlaybackEvent,
  TARGET_PLAYBACK_DURATION_MS,
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

  it('bounds dense multi-hour stories to one minute at 1x', () => {
    const eventTimes = Array.from({ length: 181 }, (_, index) => index * 60_000);
    const rate = playbackRate(eventTimes);
    let cursorMs = eventTimes[0];
    let reachedEnd = false;

    for (let elapsed = 0; elapsed < TARGET_PLAYBACK_DURATION_MS; elapsed += 1_000) {
      ({ cursorMs, reachedEnd } = advancePlaybackCursor(
        cursorMs,
        1_000,
        1,
        eventTimes,
        eventTimes.at(-1)!,
        rate,
      ));
    }

    expect(rate).toBe(180);
    expect(cursorMs).toBeGreaterThanOrEqual(90_000);
    expect(reachedEnd).toBe(true);
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
