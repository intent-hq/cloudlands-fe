/**
 * Pure helpers for the infinite-scrollback transcript (ChatPanel): compose
 * the hydrated history segment with the live tail into date groups, expose
 * where the gap affordance renders, and guard the older-history scroll
 * trigger. Keep this module dependency-light (no stores, no side effects).
 */
import type { AgentMessage } from '$shared/types';
import { groupMessagesByDate, type MessageGroup } from '$lib/utils/timeFormatting';

export interface ComposedTranscriptGroup extends MessageGroup<AgentMessage> {
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
 * scroll-up/scroll-down cycles).
 */
function dropTailResidentRows(history: AgentMessage[], tail: AgentMessage[]): AgentMessage[] {
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

export interface OlderHistoryTriggerParams {
  /** Current scrollTop of the transcript scroll container. */
  scrollTop: number;
  /** Distance from the top (px) inside which the trigger fires. */
  threshold: number;
  /** Container is actually scrollable (scrollHeight > clientHeight). */
  canScroll: boolean;
  /** An older-history page fetch is already in flight. */
  fetching: boolean;
  /** The conversation's true first message is already hydrated. */
  exhausted: boolean;
  /** Number of hydrated history rows. */
  historyCount: number;
  /** Number of resident tail rows (post client-side cap pruning). */
  tailCount: number;
  /** Daemon `truncated` flag: older rows exist beyond the tail snapshot. */
  tailTruncated: boolean;
  /**
   * Snapshot `totalMessages`: the conversation's full row count. Catches
   * client-pruned rows the `truncated` flag cannot see — when the client cap
   * is smaller than the daemon's snapshot page, rows are pruned locally
   * while `truncated` stays false.
   */
  totalMessages: number;
  /**
   * Height (px) of the virtual scrollback spacer currently rendered above
   * the resident rows (see `estimateVirtualSpacerHeight`). The near-top
   * threshold extends by this amount so any viewport position INSIDE the
   * estimated region — reached by dragging the scrollbar thumb up — drives
   * the same paging walk as scrolling to the resident top. Omitted/0 keeps
   * the resident-only behavior.
   */
  spacerAbove?: number;
}

/**
 * Whether scrolling near the top should dispatch `olderHistoryPageRequested`.
 * Never fires for short conversations (all rows resident) or before the
 * transcript is tall enough to scroll. Older rows exist when the daemon says
 * the tail snapshot was truncated OR the snapshot's total row count exceeds
 * the resident rows (tail + history) — the latter covers rows the client
 * pruned locally under its own cap.
 */
export function shouldRequestOlderHistory(params: OlderHistoryTriggerParams): boolean {
  const {
    scrollTop,
    threshold,
    canScroll,
    fetching,
    exhausted,
    historyCount,
    tailCount,
    tailTruncated,
    totalMessages,
    spacerAbove = 0,
  } = params;
  if (!canScroll || scrollTop > threshold + spacerAbove) return false;
  if (fetching || exhausted) return false;
  return historyCount > 0 || tailTruncated || totalMessages > tailCount + historyCount;
}

/**
 * Whether an older-history page settle should CHAIN into the next request.
 * The scroll listener is edge-triggered: a prepend + anchor restore produces
 * no scroll event, so without this re-evaluation the walk strands after one
 * page even while the viewport is held near the top. `settled` is the
 * fetching flag's true→false transition; the trigger guard then re-runs
 * against the POST-RESTORE scrollTop, so the chain stops on its own when the
 * restore moved the viewport past the threshold, the walk is exhausted, or
 * everything is resident — the same stop conditions as the scroll trigger.
 */
export function shouldChainOlderHistoryOnSettle(
  settled: boolean,
  params: OlderHistoryTriggerParams,
): boolean {
  return settled && shouldRequestOlderHistory(params);
}

export interface VirtualSpacerParams {
  /** Snapshot `totalMessages` (0 when no snapshot has arrived yet). */
  totalMessages: number;
  /** Resident rows: hydrated history + live tail. */
  residentCount: number;
  /** The older walk hydrated the conversation's true first row. */
  exhausted: boolean;
  /**
   * Measured pixel height of the RESIDENT rows (the scroll content minus any
   * currently applied spacer). Used to derive the average resident row
   * height that scales the unloaded extent.
   */
  residentContentHeight: number;
}

/**
 * Bounds on the per-row height estimate. Guard degenerate measurements (a
 * zero-height container mid-layout, or one enormous turn skewing the mean)
 * from collapsing the spacer or exploding the scrollbar.
 */
export const VIRTUAL_ROW_HEIGHT_MIN_PX = 24;
export const VIRTUAL_ROW_HEIGHT_MAX_PX = 320;

/**
 * Height of the virtual spacer rendered ABOVE the resident rows so the
 * scrollbar represents the estimated FULL conversation instead of only the
 * resident window: (rows above the resident window) x (average resident row
 * height, clamped). As pages land, `residentCount`/`residentContentHeight`
 * grow while the unloaded row count shrinks, so total scrollHeight stays
 * roughly stable — the scrollbar does not grow as the walk progresses.
 *
 * Returns 0 (today's behavior, no spacer) when the walk is exhausted, when
 * `totalMessages` is unknown, when nothing is resident yet to average over,
 * or when every row is already resident. Never negative.
 */
export function estimateVirtualSpacerHeight(params: VirtualSpacerParams): number {
  const { totalMessages, residentCount, exhausted, residentContentHeight } = params;
  if (exhausted || totalMessages <= 0 || residentCount <= 0) return 0;
  const unloadedAbove = totalMessages - residentCount;
  if (unloadedAbove <= 0) return 0;
  const average = residentContentHeight / residentCount;
  const clamped = Number.isFinite(average)
    ? Math.min(VIRTUAL_ROW_HEIGHT_MAX_PX, Math.max(VIRTUAL_ROW_HEIGHT_MIN_PX, average))
    : VIRTUAL_ROW_HEIGHT_MIN_PX;
  return Math.round(unloadedAbove * clamped);
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
