export type PlaybackMode = 'live' | 'paused' | 'playing';
export type PlaybackSpeed = 1 | 2 | 4 | 8;

export const MAX_PLAYBACK_GAP_MS = 30_000;
export const TARGET_PLAYBACK_DURATION_MS = 60_000;

function sortedEventTimes(eventTimes: readonly number[]): number[] {
  return [...new Set(eventTimes.filter(Number.isFinite))].sort((a, b) => a - b);
}

export function playbackRate(eventTimes: readonly number[]): number {
  const sorted = sortedEventTimes(eventTimes);
  const storyDuration = (sorted.at(-1) ?? 0) - (sorted[0] ?? 0);
  return Math.max(1, storyDuration / TARGET_PLAYBACK_DURATION_MS);
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

function nextPlaybackEvent(eventTimes: readonly number[], cursorMs: number): number | undefined {
  let low = 0;
  let high = eventTimes.length - 1;
  let next: number | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (eventTimes[middle] > cursorMs) {
      next = eventTimes[middle];
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return next;
}

export function advancePlaybackCursor(
  cursorMs: number,
  elapsedMs: number,
  speed: PlaybackSpeed,
  eventTimes: readonly number[],
  maxTimeMs: number,
  rate = playbackRate(eventTimes),
): { cursorMs: number; reachedEnd: boolean } {
  let nextCursor = Math.min(maxTimeMs, cursorMs + Math.max(0, elapsedMs) * speed * rate);
  const nextEvent = nextPlaybackEvent(eventTimes, cursorMs);
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
