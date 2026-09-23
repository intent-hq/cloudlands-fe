/**
 * The pure parts of the text-rebase alignment bench: the clocks a
 * measurement runs under, the timing loop, and the row shape the orchestrator
 * aggregates. Browser-safe on purpose (no Node imports) so it is type-checked
 * and linted with the renderer code it measures; `text-rebase-bench.runner.ts`
 * drives it under vitest and `vitest.text-rebase-bench.config.ts` does the IO.
 */

export const BENCH_CLOCKS = ['natural', 'unbounded'] as const;
export type BenchClock = (typeof BENCH_CLOCKS)[number];
type BenchPhase = 'cold' | 'cached';

/**
 * One row of the document the orchestrator aggregates,
 * `{ tree: "head" | "base", sha, rows: BenchRow[] }`, which
 * `vitest.text-rebase-bench.config.ts` assembles.
 */
export interface BenchRow {
  shape: string;
  clock: BenchClock;
  phase: BenchPhase;
  /** Wall time of one mapper construction plus one `aToB` and one `bToA` call. */
  ms: number;
  /** Under the natural clock, whether the alignment saw its deadline elapse; `null` when unknowable. */
  deadlineHit: boolean | null;
}

/** The alignment's budget, mirrored from `text-rebase.ts` (`ALIGNMENT_BUDGET_MS`). */
const ALIGNMENT_BUDGET_MS = 250;
export const DEFAULT_REPEATS = 5;
/** `Date.now` step under the unbounded clock; see `text-rebase.test.ts` (`DIFF_STEP_MS`). */
export const DIFF_STEP_MS = 0.05;

interface OffsetMapper {
  aToB(offset: number): number;
  bToA(offset: number): number;
}
export type OffsetMapperFactory = (a: string, b: string) => OffsetMapper;

export interface BenchSubject {
  name: string;
  plain: string;
  markdown: string;
}

/** A clock installed on `performance.now` / `Date.now` for the duration of a measurement. */
export interface InstalledClock {
  readonly mode: BenchClock;
  /** The real, unpatched `performance.now`, for timing the measured call. */
  readonly now: () => number;
  /** Forget the reads of the previous measured call. */
  reset(): void;
  /** Whether a read since `reset()` was at or past the first read plus the budget; `null` when unbounded. */
  deadlineHit(): boolean | null;
  restore(): void;
}

/**
 * Natural: `performance.now` passes through to the real clock but its reads
 * are watched, so a read at or past `first + budgetMs` — the only way the
 * alignment ever learns its deadline elapsed — marks the deadline hit.
 * Unbounded: `performance.now` is frozen at 0 so the deadline never elapses,
 * and `Date.now` is stepped `DIFF_STEP_MS` a read so jsdiff (which holds the
 * budget it was handed to `Date.now`) still gives up past 5000 edit lengths
 * instead of never ending — exactly `withoutDeadline` in `text-rebase.test.ts`.
 */
export function installClock(mode: BenchClock, budgetMs = ALIGNMENT_BUDGET_MS): InstalledClock {
  const perf = globalThis.performance;
  const ownNow = Object.prototype.hasOwnProperty.call(perf, 'now');
  const originalNow = perf.now;
  const now = originalNow.bind(perf);
  const originalDateNow = Date.now;
  let first: number | undefined;
  let hit = false;
  if (mode === 'natural') {
    perf.now = () => {
      const t = now();
      if (first === undefined) first = t;
      else if (t - first >= budgetMs) hit = true;
      return t;
    };
  } else {
    let reads = 0;
    perf.now = () => 0;
    Date.now = () => DIFF_STEP_MS * reads++;
  }
  return {
    mode,
    now,
    reset() {
      first = undefined;
      hit = false;
    },
    deadlineHit: () => (mode === 'natural' ? hit : null),
    restore() {
      if (ownNow) perf.now = originalNow;
      else delete (perf as { now?: typeof perf.now }).now;
      Date.now = originalDateNow;
    },
  };
}

/** Wall time of `factory(plain, markdown)` plus one call in each direction, on the real clock. */
export function timeMapping(
  factory: OffsetMapperFactory,
  subject: BenchSubject,
  clock: InstalledClock,
): { ms: number; deadlineHit: boolean | null } {
  clock.reset();
  const start = clock.now();
  const mapper = factory(subject.plain, subject.markdown);
  mapper.aToB(subject.plain.length >> 1);
  mapper.bToA(subject.markdown.length >> 1);
  return { ms: clock.now() - start, deadlineHit: clock.deadlineHit() };
}

/**
 * `text-rebase.ts` memoises the hidden-text mask of the last markdown it saw,
 * so a shape measured twice in a row would find its mask warm. Aligning an
 * unrelated pair first evicts that entry, making the next call cold whatever
 * ran before it (the first call in a process is cold regardless).
 */
function evictAlignmentMemo(factory: OffsetMapperFactory): void {
  factory('bench evict', 'bench *evict*');
}

/** `TEXT_REBASE_BENCH_REPEATS`: the cached sample count, `DEFAULT_REPEATS` when unset. */
export function parseRepeats(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_REPEATS;
  const repeats = Number(raw);
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error(
      `TEXT_REBASE_BENCH_REPEATS must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return repeats;
}

/** `TEXT_REBASE_BENCH_SHAPES`: a comma list narrowing `names`, kept in their order; all of them when unset. */
export function selectShapes(raw: string | undefined, names: readonly string[]): string[] {
  if (raw === undefined || raw.trim() === '') return [...names];
  const wanted = raw.split(',').map((name) => name.trim());
  const unknown = wanted.filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `TEXT_REBASE_BENCH_SHAPES names no shape: ${unknown.join(', ')} (have ${names.join(', ')})`,
    );
  }
  return names.filter((name) => wanted.includes(name));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The cold and cached rows of one shape under one clock: cold is the first
 * call after the memo is evicted; cached is the median of `repeats` further
 * calls, its `deadlineHit` that of the median sample (either middle sample of
 * an even count).
 */
export function benchShape(
  factory: OffsetMapperFactory,
  subject: BenchSubject,
  clock: InstalledClock,
  repeats = DEFAULT_REPEATS,
): [cold: BenchRow, cached: BenchRow] {
  if (!Number.isInteger(repeats) || repeats < 1)
    throw new Error(`repeats must be >= 1: ${repeats}`);
  evictAlignmentMemo(factory);
  const cold = timeMapping(factory, subject, clock);
  const samples: Array<{ ms: number; deadlineHit: boolean | null }> = [];
  for (let i = 0; i < repeats; i += 1) samples.push(timeMapping(factory, subject, clock));
  samples.sort((a, b) => a.ms - b.ms);
  const mid = samples.length >> 1;
  const middle = samples.length % 2 === 1 ? [samples[mid]] : [samples[mid - 1], samples[mid]];
  const row = (phase: BenchPhase, ms: number, deadlineHit: boolean | null): BenchRow => ({
    shape: subject.name,
    clock: clock.mode,
    phase,
    ms,
    deadlineHit,
  });
  return [
    row('cold', cold.ms, cold.deadlineHit),
    row(
      'cached',
      median(samples.map((s) => s.ms)),
      clock.mode === 'natural' ? middle.some((s) => s.deadlineHit === true) : null,
    ),
  ];
}
