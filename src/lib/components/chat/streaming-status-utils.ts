import { m } from '$shared/paraglide/messages.js';
import type { IntentMarkVariant } from '$lib/components/ui/indicators';

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

/**
 * Format a live elapsed duration ("Xs ago" timers) as whole seconds:
 * rounds ms to the nearest second and clamps to a minimum of 1s, then
 * reuses formatDuration for the m/h formatting above 60s. Never produces
 * decimals or "0s" — use formatDuration for completed-event durations
 * where sub-second precision matters.
 */
export function formatElapsed(ms: number): string {
  return formatDuration(Math.max(1000, Math.round(ms / 1000) * 1000));
}

export interface StatusEvent {
  phase: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
}

const PULSE_PHASES = new Set(['launch', 'init', 'session-create', 'session-load', 'prompt']);
const TWIST_PHASES = new Set(['tool-call', 'tool-waiting']);

function getLatestStatusEvent(statusEvents: readonly StatusEvent[]): StatusEvent | null {
  let latest: StatusEvent | null = null;
  for (const event of statusEvents) {
    if (!latest || event.timestamp >= latest.timestamp) latest = event;
  }
  return latest;
}

export function getStatusMarkVariant(phase: string | null | undefined): IntentMarkVariant {
  if (phase && PULSE_PHASES.has(phase)) return 'pulse';
  if (phase && TWIST_PHASES.has(phase)) return 'twist';
  return 'bloom';
}

/** Phase emitted by the daemon when mid-turn silence crosses the stall threshold. */
export const STALLED_PHASE = 'stalled';

/**
 * Select the active `stalled` status event, if any (monorepo#3402). The
 * stalled presentation is active only while the stalled event is still the
 * newest status event — a `resumed` event, a locally appended status (tool
 * call, first-chunk "streaming"), or turn end/failure (which clears the
 * events) all supersede it — and no stream delta arrived after it
 * (`lastChunkTime` is bumped on every `agent:stream:chunk`).
 */
export function getActiveStalledEvent(
  statusEvents: readonly StatusEvent[],
  lastChunkTime: number | null | undefined,
): StatusEvent | null {
  const latest = getLatestStatusEvent(statusEvents);
  if (!latest || latest.phase !== STALLED_PHASE) return null;
  if (typeof lastChunkTime === 'number' && lastChunkTime > latest.timestamp) return null;
  return latest;
}

/**
 * Latest status event for the thinking indicator's lifecycle line. Skips
 * `stalled` events entirely: an active stall renders on its own dedicated
 * warn row, and a superseded one (cleared by a stream delta, which appends
 * no new status event) must not leak its stale "No model activity…" message
 * into the returning thinking indicator.
 */
export function getLatestThinkingStatusEvent(
  statusEvents: readonly StatusEvent[],
): StatusEvent | null {
  let latest: StatusEvent | null = null;
  for (const event of statusEvents) {
    if (event.phase === STALLED_PHASE) continue;
    if (!latest || event.timestamp >= latest.timestamp) latest = event;
  }
  return latest;
}

/** Select the newest non-empty lifecycle message without trusting arrival order. */
export function latestMeaningfulStatusMessage(statusEvents: readonly StatusEvent[]): string | null {
  let latestMessage: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const event of statusEvents) {
    const message = event.message.trim();
    if (!message || !Number.isFinite(event.timestamp)) continue;
    if (event.timestamp < latestTimestamp) continue;

    latestMessage = message;
    latestTimestamp = event.timestamp;
  }

  return latestMessage;
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

/** Copy for the corrupted-session error surface (monorepo#940). */
export const SESSION_CORRUPTED = {
  get title() {
    return m.chat_streamingStatus_sessionCorrupted_title();
  },
  get message() {
    return m.chat_streamingStatus_sessionCorrupted_message();
  },
};

export interface ErrorDisplay {
  corrupted: boolean;
  title: string;
  message: string;
  /** Raw error text demoted to secondary detail when corrupted copy replaces it. */
  detail: string | null;
}

/**
 * Derive the error surface copy from the raw error text and the daemon's
 * derived sessionCorrupted flag (monorepo#940). When the flag is absent/false
 * the result matches the pre-existing rendering exactly (title "Response
 * failed", the raw error as the message); when corrupted, distinct
 * recreate-aware copy is shown and the raw error becomes secondary detail.
 */
export function deriveErrorDisplay(
  error: string | null | undefined,
  sessionCorrupted?: boolean,
): ErrorDisplay | null {
  if (!error) return null;
  if (sessionCorrupted === true) {
    return {
      corrupted: true,
      title: SESSION_CORRUPTED.title,
      message: SESSION_CORRUPTED.message,
      detail: error,
    };
  }
  return {
    corrupted: false,
    title: m.chat_streamingStatus_responseFailed_label(),
    message: error,
    detail: null,
  };
}
