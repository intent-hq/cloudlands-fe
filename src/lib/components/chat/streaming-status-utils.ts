/**
 * Format duration with human-readable units:
 * - Under 10s: 'Xs' or 'X.Xs' (skip .0)
 * - 10s-59s: 'Xs'
 * - 60s+: '1m 20s'
 * - 3600s+: '1h 2m 20s'
 */
export function formatDuration(ms: number): string {
  ms = Math.max(0, ms); // Clamp to non-negative (clock skew between processes)
  const totalSeconds = Math.floor(ms / 1000);

  // Under 10 seconds: show decimal
  if (totalSeconds < 10) {
    const seconds = ms / 1000;
    const fixed = seconds.toFixed(1);
    return fixed.endsWith('.0') ? `${Math.round(seconds)}s` : `${fixed}s`;
  }

  // Under 60 seconds: just seconds
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // 1 hour or more
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // 1 minute or more (but less than 1 hour)
  return `${minutes}m ${seconds}s`;
}

export interface StatusEvent {
  phase: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
}

export interface CompletedEvent {
  event: StatusEvent;
  duration: string;
}

/**
 * Compute completed events with durations from a status events array.
 * @param statusEvents - all status events
 * @param includeLatest - if true, include the latest event (post-chunk mode); if false, exclude it (pre-chunk mode)
 * @param fallbackEndTime - timestamp to use for the last event's duration when includeLatest is true
 * @returns completed events with duration strings, in reverse order (newest first)
 */
export function computeCompletedEvents(
  statusEvents: StatusEvent[],
  includeLatest: boolean,
  fallbackEndTime: number,
): CompletedEvent[] {
  const events = includeLatest ? statusEvents : statusEvents.slice(0, -1);
  if (events.length === 0) return [];

  const completed: CompletedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const nextTimestamp =
      i < statusEvents.length - 1 ? statusEvents[i + 1].timestamp : fallbackEndTime;
    const durationMs = nextTimestamp - event.timestamp;
    completed.push({ event, duration: formatDuration(durationMs) });
  }
  return completed.reverse();
}

/**
 * Determine whether to append a "Streaming response…" status event on chunk receipt.
 * Used by canonical agent stream update chunk handling for testability.
 *
 * Returns false when:
 * - receivedFirstChunk is already true (not the first chunk)
 * - statusEvents is empty (nothing to close off)
 * - latest event is already 'streaming' (consecutive dedup)
 */
export function shouldAppendStreamingEvent(
  receivedFirstChunk: boolean,
  statusEvents: StatusEvent[],
): boolean {
  // Not first chunk — skip
  if (receivedFirstChunk) return false;
  // No status events to close off — skip
  if (statusEvents.length === 0) return false;
  // Dedup: don't add if the latest event is already 'streaming'
  const latestPhase = statusEvents[statusEvents.length - 1].phase;
  if (latestPhase === 'streaming') return false;
  return true;
}

