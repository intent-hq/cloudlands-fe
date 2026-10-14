/** Canonical bounded history/tail presentation, independent of navigation and auth. */
import type { AgentMessage } from '$shared/types';
import { groupMessagesByDate, type MessageGroup } from '$lib/utils/timeFormatting';
interface ComposedTranscriptGroup extends MessageGroup<AgentMessage> {
  /**
   * Stable turn-key base consumed by `indexConversationTurns` for orphan-turn
   * keys. Present only when history rows are rendered: keyed by origin + day
   * so tail turn keys survive history prepends (a positional groupIndex
   * would shift on every prepended page and churn LazyTurn height caches).
   * Absent for the tail-only transcript so keys match the historical
   * `group-${groupIndex}` scheme exactly.
   */
  groupKey?: string;
}

export interface ComposedTranscript {
  groups: ComposedTranscriptGroup[];
  /**
   * Index of the first tail group when the history→tail hole is open — the
   * gap affordance renders immediately before this group. `null` when there
   * is no gap (no history, or history is contiguous with the tail).
   */
  gapBeforeGroupIndex: number | null;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Attach stable `groupKey`s. Keys are `${prefix}-${localDay}` with an
 * occurrence suffix for the (out-of-order timestamp) case where
 * `groupMessagesByDate` emits the same day twice.
 */
function withStableGroupKeys(
  groups: MessageGroup<AgentMessage>[],
  prefix: string,
): ComposedTranscriptGroup[] {
  const seen = new Map<string, number>();
  return groups.map((group) => {
    const base = `${prefix}-${dayKey(group.date)}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { ...group, groupKey: occurrence === 1 ? base : `${base}-${occurrence}` };
  });
}

/**
 * Drop history rows the tail also holds (identity by `id` / `appMessageId`,
 * the same keys the store dedup uses). The history reducer already dedups
 * against the tail AT MERGE TIME, but the tail keeps moving afterwards: the
 * chat-read older-history fetch tops the tail back up to the cap on every
 * rehydration and a seq-0 snapshot replaces it wholesale, so a row paged
 * into history can later re-enter the tail. Without this render-time guard
 * each such row renders twice (duplicate sections after repeated
 * scroll-up/scroll-down cycles). Exported so the regenerate saga resolves
 * its source against the same composed list the transcript renders.
 */
export function dropTailResidentRows(
  history: AgentMessage[],
  tail: AgentMessage[],
): AgentMessage[] {
  if (history.length === 0 || tail.length === 0) return history;
  const tailIds = new Set(tail.map((message) => message.id));
  const tailAppMessageIds = new Set(
    tail
      .map((message) => message.appMessageId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const filtered = history.filter(
    (message) =>
      !tailIds.has(message.id) &&
      !(
        typeof message.appMessageId === 'string' &&
        message.appMessageId.length > 0 &&
        tailAppMessageIds.has(message.appMessageId)
      ),
  );
  return filtered.length === history.length ? history : filtered;
}

/**
 * Compose the rendered transcript from the scrollback history segment and
 * the live tail. History rows the tail re-acquired since the segment merge
 * are dropped from the history side first (see `dropTailResidentRows`).
 *
 * - No history hydrated → the tail-only grouping used today (no group keys,
 *   no gap): the default path is byte-identical to the pre-scrollback UI.
 * - History contiguous with the tail (`gapToTail` false) → one seamless
 *   list; a turn MAY stitch across the junction (same-day rows merge into
 *   one group, exactly as if the transcript had never been windowed).
 * - Gap open → history groups then tail groups, kept as SEPARATE groups
 *   even on the same day. `groupIntoTurns` runs per group, so the gap is a
 *   hard turn boundary — no turn is stitched across the hole — and the gap
 *   affordance renders before `gapBeforeGroupIndex`.
 */
export function composeTranscript(
  history: AgentMessage[],
  tail: AgentMessage[],
  gapToTail: boolean,
): ComposedTranscript {
  history = dropTailResidentRows(history, tail);
  if (history.length === 0) {
    return { groups: groupMessagesByDate(tail), gapBeforeGroupIndex: null };
  }
  if (!gapToTail) {
    return {
      groups: withStableGroupKeys(groupMessagesByDate([...history, ...tail]), 'd'),
      gapBeforeGroupIndex: null,
    };
  }
  const historyGroups = withStableGroupKeys(groupMessagesByDate(history), 'h');
  const tailGroups = withStableGroupKeys(groupMessagesByDate(tail), 't');
  return {
    groups: [...historyGroups, ...tailGroups],
    gapBeforeGroupIndex: historyGroups.length,
  };
}

export interface ConversationStartLoadedParams {
  /** The older scrollback walk hydrated the conversation's true first row. */
  exhausted: boolean;
  /** Number of hydrated history rows. */
  historyCount: number;
  /** Number of resident tail rows (post client-side cap pruning). */
  tailCount: number;
  /** Daemon `truncated` flag: older rows exist beyond the tail snapshot. */
  tailTruncated: boolean;
  /** Snapshot `totalMessages` (0 when no snapshot has arrived yet). */
  totalMessages: number;
}

/**
 * Whether the conversation's TRUE START is resident — gates top-of-transcript
 * chrome (the workspace-setup intro card) that would otherwise falsely signal
 * "you've reached the beginning" while older rows still exist above the
 * resident window:
 *
 * - History exhausted (`oldestReached`) → the walk hydrated the first row.
 * - No history segment and the tail holds the whole conversation (not
 *   truncated, snapshot total within the resident tail) → nothing older
 *   exists. A hydrated-but-not-exhausted history segment means the walk is
 *   mid-history — the start is NOT loaded even if the counts happen to line
 *   up (cap-pruned rows above the segment are invisible to them).
 */
export function isConversationStartLoaded(params: ConversationStartLoadedParams): boolean {
  const { exhausted, historyCount, tailCount, tailTruncated, totalMessages } = params;
  if (exhausted) return true;
  if (historyCount > 0) return false;
  return !tailTruncated && totalMessages <= tailCount;
}
