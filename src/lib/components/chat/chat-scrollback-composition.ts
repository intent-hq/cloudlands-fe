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
  return Math.round(unloadedAbove * clampRowHeight(residentContentHeight / residentCount));
}

function clampRowHeight(value: number): number {
  return Number.isFinite(value)
    ? Math.min(VIRTUAL_ROW_HEIGHT_MAX_PX, Math.max(VIRTUAL_ROW_HEIGHT_MIN_PX, value))
    : VIRTUAL_ROW_HEIGHT_MIN_PX;
}

/**
 * EMA smoothing factor for the per-row height estimate. Small on purpose:
 * one page of unusually tall/short messages moves the estimate by at most
 * alpha x (its deviation), so the spacer target drifts slowly instead of
 * churning as every page lands.
 */
export const VIRTUAL_ROW_EMA_ALPHA = 0.2;

/**
 * Relative drift below which a reconciled spacer target is NOT applied
 * (hysteresis) — the residual error is absorbed at the boundaries instead
 * (walk exhausted → spacer 0 exactly).
 */
export const VIRTUAL_SPACER_HYSTERESIS_RATIO = 0.12;

/**
 * Slow-moving per-row height estimator: seeds from the first (clamped)
 * sample, then folds later samples in via EMA with `VIRTUAL_ROW_EMA_ALPHA`.
 * Samples are clamped to [MIN, MAX] BEFORE mixing, so a degenerate
 * measurement cannot drag the estimate outside the bounds either.
 */
export function smoothRowHeightEstimate(
  previous: number | null,
  sample: number,
  alpha: number = VIRTUAL_ROW_EMA_ALPHA,
): number {
  const clamped = clampRowHeight(sample);
  if (previous === null || !Number.isFinite(previous)) return clamped;
  return previous + alpha * (clamped - previous);
}

/**
 * Frozen-phase restatement: while a scroll gesture / paging chain is active
 * the row-height EMA is LOCKED, and every history-segment change restates
 * both spacers COUNT-derived — the unloaded above/below split x the frozen
 * EMA — instead of absorbing measured height deltas. Measured absorption is
 * blind to cap pruning: once the segment sits at its cap, a prepend prunes
 * as many rows as it adds (net measured height ~0), which left the above
 * spacer frozen at a stale height while the true above-row count shrank
 * with every page — the viewport walked into blank spacer territory
 * mid-chain and the deferred correction landed as a single thumb snap at
 * the exhaustion boundary. Counts see pruning exactly, the split's
 * boundaries are exact (`exhausted` zeroes above, a closed gap zeroes
 * below), and the frozen EMA keeps the restatement stable across a rapid
 * landing chain. The estimate itself is only re-derived at reconcile
 * points (`reconcileVirtualSpacer`) or boundaries.
 */
export function restateFrozenSpacers(
  split: { above: number; below: number },
  frozenRowHeightEma: number | null,
): { above: number; below: number } {
  const rowHeight = clampRowHeight(frozenRowHeightEma ?? Number.NaN);
  return {
    above: Math.round(Math.max(0, split.above) * rowHeight),
    below: Math.round(Math.max(0, split.below) * rowHeight),
  };
}

export interface VirtualSpacerReconcileParams extends VirtualSpacerParams {
  /** Spacer height currently applied (possibly locked through a chain). */
  currentSpacerHeight: number;
  /** Current smoothed per-row estimate; `null` before the first seed. */
  rowHeightEma: number | null;
  /** Container clientHeight — the absolute hysteresis threshold. */
  viewportHeight: number;
  /**
   * Explicit unloaded-row count for THIS spacer (dual-spacer mode: the
   * above/below split from `splitUnloadedRows`). When omitted, the legacy
   * single-spacer derivation `totalMessages - residentCount` applies.
   */
  unloadedRows?: number;
}

export interface VirtualSpacerReconcileResult {
  /** Spacer height to render (unchanged when `applied` is false). */
  spacerHeight: number;
  /** Updated smoothed estimate — carry into the next reconcile. */
  rowHeightEma: number | null;
  /** The target drifted enough (or hit a boundary) to be applied. */
  applied: boolean;
  /**
   * Same-frame scrollTop compensation for an applied change: shifting
   * scrollTop by this delta keeps the resident content at the same viewport
   * offset AND the apparent thumb position stable (content above the
   * viewport changed by exactly this amount).
   */
  scrollTopDelta: number;
}

/**
 * Quiet-point reconcile for the virtual spacer (run only when the
 * transcript has settled: no scroll events and no fetch in flight):
 *
 * 1. Fold the current measured average row height into the EMA.
 * 2. Derive the spacer target from the SMOOTHED estimate.
 * 3. Hysteresis: keep the current height unless the target drifts more
 *    than `VIRTUAL_SPACER_HYSTERESIS_RATIO` of it or more than one
 *    viewport. Boundaries are exact and bypass hysteresis: exhaustion /
 *    all-resident / unknown total zero the spacer, and a first-ever spacer
 *    (current 0) applies immediately.
 */
export function reconcileVirtualSpacer(
  params: VirtualSpacerReconcileParams,
): VirtualSpacerReconcileResult {
  const {
    totalMessages,
    residentCount,
    exhausted,
    residentContentHeight,
    currentSpacerHeight,
    viewportHeight,
  } = params;
  let rowHeightEma = params.rowHeightEma;
  if (residentCount > 0 && residentContentHeight > 0) {
    rowHeightEma = smoothRowHeightEstimate(rowHeightEma, residentContentHeight / residentCount);
  }
  const unloadedRows = params.unloadedRows ?? totalMessages - residentCount;
  const atBoundary =
    exhausted || totalMessages <= 0 || residentCount <= 0 || unloadedRows <= 0;
  const target =
    atBoundary || rowHeightEma === null ? 0 : Math.round(unloadedRows * rowHeightEma);
  const drift = Math.abs(target - currentSpacerHeight);
  if (drift === 0) {
    return { spacerHeight: currentSpacerHeight, rowHeightEma, applied: false, scrollTopDelta: 0 };
  }
  const meaningful =
    target === 0 ||
    currentSpacerHeight === 0 ||
    drift > currentSpacerHeight * VIRTUAL_SPACER_HYSTERESIS_RATIO ||
    (viewportHeight > 0 && drift > viewportHeight);
  if (!meaningful) {
    return { spacerHeight: currentSpacerHeight, rowHeightEma, applied: false, scrollTopDelta: 0 };
  }
  return {
    spacerHeight: target,
    rowHeightEma,
    applied: true,
    scrollTopDelta: target - currentSpacerHeight,
  };
}

// ── Far-flick seek (aroundIndex) helpers ─────────────────────────────────

/**
 * Rows per scrollback page (mirrors the saga's request limit). Used by the
 * gesture classifier to convert "pages of serial walking" into rows.
 */
export const SCROLLBACK_PAGE_ROWS = 200;

/**
 * A scroll position within this many PAGES of the resident segment's top
 * edge keeps today's serial chaining; deeper positions switch to seek mode.
 */
export const SCROLLBACK_SEEK_NEAR_PAGES = 2;

export interface ScrollbackGestureParams {
  /** Current scrollTop of the transcript scroll container. */
  scrollTop: number;
  /** Height (px) of the virtual spacer above the resident rows. */
  spacerAboveHeight: number;
  /** Smoothed per-row height estimate; null before the first seed. */
  rowHeightEstimate: number | null;
  /** Rows per scrollback page (defaults to SCROLLBACK_PAGE_ROWS). */
  pageSize?: number;
  /** Near threshold in pages (defaults to SCROLLBACK_SEEK_NEAR_PAGES). */
  nearPages?: number;
}

/**
 * Classify a scroll position against the resident segment's top edge:
 *
 * - `'serial'` — the viewport is inside the resident rows, or inside the
 *   spacer but within `nearPages` pages of the segment start: today's
 *   one-page-at-a-time chaining reaches it quickly.
 * - `'seek'` — the viewport is deeper inside the spacer than the serial
 *   walk can reasonably cover: jump directly with one `aroundIndex` fetch.
 *
 * The row distance between the viewport top and the segment start is
 * `(spacerAboveHeight - scrollTop) / rowHeight` — the same estimate the
 * spacer itself was derived from, so classification and extent agree.
 */
export function classifyScrollbackGesture(params: ScrollbackGestureParams): 'serial' | 'seek' {
  const {
    scrollTop,
    spacerAboveHeight,
    rowHeightEstimate,
    pageSize = SCROLLBACK_PAGE_ROWS,
    nearPages = SCROLLBACK_SEEK_NEAR_PAGES,
  } = params;
  if (spacerAboveHeight <= 0 || scrollTop >= spacerAboveHeight) return 'serial';
  const rowHeight = clampRowHeight(rowHeightEstimate ?? Number.NaN);
  const rowsAboveSegmentStart = (spacerAboveHeight - Math.max(0, scrollTop)) / rowHeight;
  return rowsAboveSegmentStart > nearPages * pageSize ? 'seek' : 'serial';
}

export interface ScrollToOrdinalParams {
  /** Current scrollTop of the transcript scroll container. */
  scrollTop: number;
  /** Height (px) of the virtual spacer above the resident rows. */
  spacerAboveHeight: number;
  /**
   * Estimated number of unloaded rows the above-spacer represents. These
   * are conversation ordinals `[0, unloadedRowsAbove)` — 0-based from the
   * OLDEST message, matching the daemon's `aroundIndex` coordinate.
   */
  unloadedRowsAbove: number;
}

/**
 * Map a scroll position inside the above-spacer to the target conversation
 * ordinal (0-based from oldest): the position's fraction into the spacer
 * times the unloaded row count, clamped into `[0, unloadedRowsAbove - 1]`.
 * The daemon clamps `aroundIndex` again server-side, so an estimate drifted
 * past the true total still lands on a valid page.
 */
export function mapScrollTopToOrdinal(params: ScrollToOrdinalParams): number {
  const { scrollTop, spacerAboveHeight, unloadedRowsAbove } = params;
  if (unloadedRowsAbove <= 0 || spacerAboveHeight <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, scrollTop / spacerAboveHeight));
  return Math.min(unloadedRowsAbove - 1, Math.max(0, Math.floor(fraction * unloadedRowsAbove)));
}

export interface UnloadedRowsSplitParams {
  /** Snapshot `totalMessages` (0 when no snapshot has arrived yet). */
  totalMessages: number;
  /** Resident rows: hydrated history + live tail. */
  residentCount: number;
  /** The older walk hydrated the conversation's true first row. */
  exhausted: boolean;
  /**
   * Estimated conversation ordinal of the history segment's FIRST row, or
   * null for segments grown by the serial walk (which are split by
   * `holeRowsEstimate` instead).
   */
  startOrdinalEstimate: number | null;
  /** A hole is open between the history segment and the live tail. */
  gapToTail: boolean;
  /**
   * Reducer-tracked estimate of the rows inside the open history→tail hole
   * (rows cap-pruned off the segment's newest side, minus gap refills).
   * Splits SERIAL-walk segments, whose hole rows sit BELOW the viewport and
   * must not inflate the above extent (they used to be attributed all-above,
   * which overestimated the extent by up to 2x mid-walk and snapped the
   * thumb at the exhaustion boundary). Ignored when `startOrdinalEstimate`
   * anchors the split; null/omitted falls back to 0 (legacy all-above).
   */
  holeRowsEstimate?: number | null;
}

/**
 * Split the estimated unloaded row count into the portion ABOVE the history
 * segment (rows older than its first row) and the portion BELOW it (rows in
 * the open history→tail hole). A seeded segment (seek landing) carries a
 * `startOrdinalEstimate` that anchors the split; a serial-walk segment is
 * split by the reducer-tracked `holeRowsEstimate` (rows its cap pruning
 * moved into the hole). `exhausted` zeroes the above side exactly; a closed
 * gap zeroes the below side exactly.
 */
export function splitUnloadedRows(params: UnloadedRowsSplitParams): {
  above: number;
  below: number;
} {
  const { totalMessages, residentCount, exhausted, startOrdinalEstimate, gapToTail } = params;
  const unloaded = Math.max(0, totalMessages - residentCount);
  if (unloaded === 0) return { above: 0, below: 0 };
  if (!gapToTail) {
    return { above: exhausted ? 0 : unloaded, below: 0 };
  }
  if (exhausted) return { above: 0, below: unloaded };
  if (startOrdinalEstimate !== null) {
    const above = Math.min(unloaded, Math.max(0, Math.round(startOrdinalEstimate)));
    return { above, below: unloaded - above };
  }
  const below = Math.min(unloaded, Math.max(0, Math.round(params.holeRowsEstimate ?? 0)));
  return { above: unloaded - below, below };
}

/**
 * Estimate the conversation ordinal of a seek landing page's FIRST row.
 * Mirrors the daemon's `page_window_around`: half the page budget goes to
 * rows older than the (clamped) target, clamped at either edge so the page
 * stays full. An estimate only — boundaries stay exact via `oldestReached`
 * (nextToken null ⇒ start is 0) and the gap-close overlap detection.
 */
export function estimateSeekLandingStartOrdinal(
  targetOrdinal: number,
  pageLimit: number,
  totalMessages: number,
): number {
  if (totalMessages <= 0) return 0;
  const target = Math.min(totalMessages - 1, Math.max(0, Math.floor(targetOrdinal)));
  const start = target - Math.floor(pageLimit / 2);
  return Math.min(Math.max(0, totalMessages - pageLimit), Math.max(0, start));
}

export interface SeekLandingScrollTopParams {
  /** Above-spacer height (px) applied for the seeded segment. */
  spacerAboveHeight: number;
  /** The ordinal the user aimed at (the seek target). */
  targetOrdinal: number;
  /** Estimated ordinal of the seeded segment's first row. */
  startOrdinal: number;
  /** Per-row height estimate (px). */
  rowHeight: number;
  /** Container clientHeight (px). */
  viewportHeight: number;
}

/**
 * ScrollTop that puts the seek target row roughly mid-viewport after a
 * landing: the segment starts at `spacerAboveHeight`, the target sits
 * `(targetOrdinal - startOrdinal)` rows into it. Floor 0.
 */
export function seekLandingScrollTop(params: SeekLandingScrollTopParams): number {
  const { spacerAboveHeight, targetOrdinal, startOrdinal, rowHeight, viewportHeight } = params;
  const rowsIntoSegment = Math.max(0, targetOrdinal - startOrdinal);
  return Math.max(
    0,
    Math.round(spacerAboveHeight + rowsIntoSegment * rowHeight - viewportHeight / 2),
  );
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
