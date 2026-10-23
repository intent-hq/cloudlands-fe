/**
 * Merge-queue position and time-to-merge estimate for a queued PR — the
 * additive, presence-detected `mergeQueue` the daemon serves on
 * `github.pulls.get` (§5.27) and the PR monitor checklist (§5.42). Shared by
 * the link hover card, the chat monitored-PR row and the sidebar PR tooltip.
 */
import { m } from '$shared/paraglide/messages.js';

/** Wire `MergeQueueEntry`: every key but `position` may be absent. */
export interface MergeQueueEntry {
  /** 1-based place in the queue; 1 is next to merge. */
  position: number;
  /** Entries currently in the queue, this one included. */
  queueSize?: number;
  /** The host's raw entry state, lowercased (e.g. `queued`, `awaiting_checks`). */
  state?: string;
  /** RFC 3339 time the PR entered the queue. */
  enqueuedAt?: string;
  /** The host's estimate, in seconds, of how long until the entry merges. */
  estimatedTimeToMerge?: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The queue entry when it is usable (a positive integer position), else
 * `null` — older daemons and malformed payloads fall back to the plain
 * "Queued" wording.
 */
export function usableMergeQueueEntry(entry: unknown): MergeQueueEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Partial<MergeQueueEntry>;
  return isCount(candidate.position) ? (candidate as MergeQueueEntry) : null;
}

/** "#2 of 3 in queue", or "#2 in queue" when the size is unknown or inconsistent. */
export function formatMergeQueuePosition(entry: MergeQueueEntry): string {
  const { position, queueSize } = entry;
  return isCount(queueSize) && queueSize >= position
    ? m.shared_mergeQueue_positionOfTotal_label({ position, total: queueSize })
    : m.shared_mergeQueue_position_label({ position });
}

/**
 * "~38 min to merge" / "~1 h 5 min to merge", rounded up to whole minutes
 * (never "~0 min"); `null` when the host gave no usable estimate.
 */
export function formatMergeQueueEta(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (totalMinutes < 60) return m.shared_mergeQueue_etaMinutes_label({ minutes: totalMinutes });
  return m.shared_mergeQueue_etaHours_label({
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  });
}

/**
 * "#2 of 3 in queue · ~38 min to merge" (the estimate only when present), or
 * `null` when there is no usable entry.
 */
export function formatMergeQueueSummary(entry: unknown): string | null {
  const usable = usableMergeQueueEntry(entry);
  if (!usable) return null;
  const eta = formatMergeQueueEta(usable.estimatedTimeToMerge);
  const position = formatMergeQueuePosition(usable);
  // i18n-ignore (list separator glyph)
  return eta ? `${position} · ${eta}` : position;
}
