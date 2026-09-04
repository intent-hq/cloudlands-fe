export type PlaybackMode = 'live' | 'paused' | 'playing';
export type PlaybackSpeed = 1 | 2 | 4 | 8;

export const MAX_PLAYBACK_GAP_MS = 30_000;

export function advancePlaybackCursor(
  cursorMs: number,
  elapsedMs: number,
  speed: PlaybackSpeed,
  eventTimes: readonly number[],
  maxTimeMs: number,
): { cursorMs: number; reachedEnd: boolean } {
  let nextCursor = Math.min(maxTimeMs, cursorMs + Math.max(0, elapsedMs) * speed);
  const nextEvent = eventTimes.find((time) => time > cursorMs);
  if (nextEvent !== undefined && nextEvent - nextCursor > MAX_PLAYBACK_GAP_MS) {
    nextCursor = nextEvent - MAX_PLAYBACK_GAP_MS;
  }
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
