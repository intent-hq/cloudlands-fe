// Per-entry time budgets for catalog-contract.test.ts, sized from what each
// entry actually renders: its committed DOM snapshot. Render, token and axe
// cost scale with DOM size, and under load (`pnpm test:loaded`) the heavy
// entries measured ~15-50 ms per snapshot line, so 60 ms per line leaves
// headroom while light entries keep the default budget.

/** Budget per committed snapshot line at the local 30s default. */
export const MS_PER_SNAPSHOT_LINE = 60;

/** Budget for an entry whose snapshot has not been written yet, at the local 30s default. */
export const UNSNAPSHOTTED_BUDGET_MS = 180_000;

/**
 * The default budget the per-line rate is calibrated against. A larger default
 * (60s on CI, whose runners starve a fork ~4x) scales the derived budgets by the
 * same factor, so heavy entries get CI's extra headroom too.
 */
const CALIBRATION_DEFAULT_MS = 30_000;

/** The render wait leaves this much of the test budget for snapshot and axe. */
const RENDER_WAIT_RESERVE_MS = 10_000;

/** Never wait for the render marker for less than this. */
export const MIN_RENDER_WAIT_MS = 20_000;

// The closing backtick of an entry is preceded by an even number of
// backslashes (vitest escapes `\` as `\\` and a backtick as `` \` ``).
const ENTRY = /^exports\[`([\s\S]*?) \d+`\] = `([\s\S]*?)(?<=(?:^|[^\\])(?:\\\\)*)`;$/gm;
const TRUNCATION = '…';

/**
 * Maps each `${describeName} > '$key'` title's key (possibly truncated with `…`
 * by vitest) to the line count of its snapshot body. Titles from other
 * describes are ignored.
 */
export function snapshotLineCounts(
  snapshotSource: string,
  describeName: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  const prefix = `${describeName} > '`;
  for (const [, title, body] of snapshotSource.matchAll(ENTRY)) {
    if (!title.startsWith(prefix) || !title.endsWith("'")) continue;
    const key = title.slice(prefix.length, -1);
    const lines = body.split('\n').length;
    counts.set(key, Math.max(lines, counts.get(key) ?? 0));
  }
  return counts;
}

/**
 * The snapshot size for `key`, matching vitest's truncated `$key` titles by
 * prefix. Truncated titles can share a prefix (vitest numbers such snapshots
 * within one title), so the largest wins; a new key that shares a truncated
 * prefix inherits that size rather than the unsnapshotted fallback.
 */
export function snapshotLinesFor(counts: Map<string, number>, key: string): number | undefined {
  let lines: number | undefined;
  for (const [title, count] of counts) {
    const matches =
      title === key ||
      (title.endsWith(TRUNCATION) && key.startsWith(title.slice(0, -TRUNCATION.length)));
    if (matches) lines = Math.max(lines ?? 0, count);
  }
  return lines;
}

/** The test budget for an entry of `lines` snapshot lines, never below `defaultMs`. */
export function catalogContractBudgetMs(lines: number | undefined, defaultMs: number): number {
  const scale = Math.max(1, defaultMs / CALIBRATION_DEFAULT_MS);
  const derived = lines === undefined ? UNSNAPSHOTTED_BUDGET_MS : lines * MS_PER_SNAPSHOT_LINE;
  return Math.max(defaultMs, derived * scale);
}

/**
 * How long to wait for the render marker within a test budget: short of the
 * budget, so a missing marker reports waitFor's DOM diagnostic rather than a
 * bare test timeout.
 */
export function renderWaitMs(budgetMs: number): number {
  return Math.max(MIN_RENDER_WAIT_MS, budgetMs - RENDER_WAIT_RESERVE_MS);
}
