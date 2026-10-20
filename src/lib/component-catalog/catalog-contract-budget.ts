// Per-entry time budgets for catalog-contract.test.ts, sized from what each
// entry actually renders: its committed DOM snapshot. Render, token and axe
// cost scale with DOM size, and under load (`pnpm test:loaded`) the heavy
// entries measured ~15-26 ms per snapshot line, so 60 ms per line leaves ~2.5x
// headroom while light entries keep the default budget.

/** Budget per committed snapshot line. */
export const MS_PER_SNAPSHOT_LINE = 60;

/** Budget for an entry whose snapshot has not been written yet. */
export const UNSNAPSHOTTED_BUDGET_MS = 180_000;

const ENTRY = /^exports\[`([\s\S]*?) \d+`\] = `([\s\S]*?)(?<!\\)`;$/gm;
const TRUNCATION = '…';

/**
 * Maps each test title's final quoted segment (the `$key` an `it.each` case
 * renders, possibly truncated with `…`) to the line count of its snapshot body.
 */
export function snapshotLineCounts(snapshotSource: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, title, body] of snapshotSource.matchAll(ENTRY)) {
    const key = /'([^']*)'$/.exec(title)?.[1];
    if (key === undefined) continue;
    const lines = body.split('\n').length;
    counts.set(key, Math.max(lines, counts.get(key) ?? 0));
  }
  return counts;
}

/**
 * The snapshot size for `key`, matching vitest's truncated `$key` titles by
 * prefix. Several truncated titles can share a prefix, so the largest wins.
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

/** The budget for an entry of `lines` snapshot lines, never below `defaultMs`. */
export function catalogContractBudgetMs(lines: number | undefined, defaultMs: number): number {
  if (lines === undefined) return Math.max(defaultMs, UNSNAPSHOTTED_BUDGET_MS);
  return Math.max(defaultMs, lines * MS_PER_SNAPSHOT_LINE);
}
