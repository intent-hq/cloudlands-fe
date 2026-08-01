/**
 * Queued-message delivery info.
 *
 * intentd stamps every drained queue entry with structured metadata —
 * `metadata.queueInfo = { queuedAt: <ISO string>, waitedMs: <integer> }`
 * (PROTOCOL.md §5.5 "Dequeue-wait annotation") — alongside the deterministic
 * `[SYSTEM NOTE]` line it appends to the delivered content. This util extracts
 * that metadata-first with graceful fallback: absent or malformed metadata
 * (wrong types, unparseable timestamp) returns `null` so messages render
 * exactly as before (old transcripts keep showing the raw note, no chip).
 */

export interface QueueInfo {
  /** ISO timestamp the message entered the queue (same string as the queue entry). */
  queuedAt: string;
  /** Milliseconds the message waited before delivery (clamped to >= 0). */
  waitedMs: number;
}

/**
 * Extract queued-delivery info from an opaque message metadata object.
 * Returns `null` unless `metadata.queueInfo` carries a parseable `queuedAt`
 * string and a finite numeric `waitedMs`.
 */
export function getQueueInfo(metadata: unknown): QueueInfo | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const queueInfo = (metadata as Record<string, unknown>).queueInfo;
  if (!queueInfo || typeof queueInfo !== 'object') return null;
  const { queuedAt, waitedMs } = queueInfo as Record<string, unknown>;
  if (typeof queuedAt !== 'string' || !queuedAt.trim()) return null;
  if (typeof waitedMs !== 'number' || !Number.isFinite(waitedMs)) return null;
  if (Number.isNaN(new Date(queuedAt).getTime())) return null;
  return { queuedAt, waitedMs: Math.max(0, waitedMs) };
}

/**
 * The deterministic dequeue-wait note intentd appends to drained queue
 * entries: `\n\n[SYSTEM NOTE] This message was queued at <ISO> and waited
 * <duration> before delivery.` Deliberately does NOT match the #576
 * stale-redrive note ("[SYSTEM NOTE] This message was queued before you
 * completed…"), which has a distinct prefix and must stay visible.
 */
const DEQUEUE_WAIT_NOTE_RE =
  /\n*\[SYSTEM NOTE\] This message was queued at [^\n]+ and waited [^\n]+ before delivery\.(?=\n|$)/;

/**
 * Remove the dequeue-wait `[SYSTEM NOTE]` line (and its blank-line separator)
 * from message text for display. Only call when `getQueueInfo` returned
 * non-null — the note stays in the wire/persisted content for the agent; the
 * chip replaces it visually. Text without the note is returned unchanged.
 */
export function stripDequeueWaitNote(text: string): string {
  return text.replace(DEQUEUE_WAIT_NOTE_RE, '');
}
