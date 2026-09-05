export type PlaybackMode = 'live' | 'paused' | 'playing';
export type PlaybackSpeed = 1 | 2 | 4 | 8;

export const TARGET_PLAYBACK_DURATION_MS = 60_000;

export function playbackRate(spanMs: number): number {
  return Number.isFinite(spanMs) ? Math.max(1, spanMs / TARGET_PLAYBACK_DURATION_MS) : 1;
}

export function snapPlaybackCursor(eventTimes: readonly number[], cursorMs: number): number {
  let low = 0;
  let high = eventTimes.length - 1;
  let snapped = cursorMs;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (eventTimes[middle] <= cursorMs) {
      snapped = eventTimes[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return snapped;
}

export function advancePlaybackCursor(
  cursorMs: number,
  elapsedMs: number,
  speed: PlaybackSpeed,
  maxTimeMs: number,
  rate = 1,
): { cursorMs: number; reachedEnd: boolean } {
  const nextCursor = Math.min(maxTimeMs, cursorMs + Math.max(0, elapsedMs) * speed * rate);
  return { cursorMs: nextCursor, reachedEnd: nextCursor >= maxTimeMs };
}

export type PlaybackShortcut = 'toggle' | 'previous' | 'next' | 'start' | 'end' | 'live';

export function playbackShortcut(key: string): PlaybackShortcut | null {
  if (key === ' ') return 'toggle';
  if (key === 'ArrowLeft') return 'previous';
  if (key === 'ArrowRight') return 'next';
  if (key === 'Home') return 'start';
  if (key === 'End') return 'end';
  if (key.toLowerCase() === 'l') return 'live';
  return null;
}

export function stepPlaybackEvent(
  eventTimes: readonly number[],
  currentMs: number,
  direction: -1 | 1,
): number {
  const sorted = [...new Set(eventTimes)].sort((a, b) => a - b);
  if (direction < 0) return sorted.toReversed().find((time) => time < currentMs) ?? currentMs;
  return sorted.find((time) => time > currentMs) ?? currentMs;
}
