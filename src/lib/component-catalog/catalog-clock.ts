/**
 * The catalog's clock: the only place a catalog renderer, fixture or `*.preview.*` file may
 * read the time (enforced by `intent/no-wall-clock-in-catalog-previews`).
 *
 * A preview that builds its timestamps from the real clock renders differently depending on
 * when, and how slowly, it runs: the toast catalog's "18s" attention toast became "20s" on a
 * busy machine and failed its snapshot (2026-10-23). Prefer a fixed ISO date derived from
 * `CATALOG_REFERENCE_NOW` (see `catalogTime`). Use `catalogNow()` only where the product
 * component measures against its own live clock (relative ages, countdowns, uptime), so the
 * live catalog keeps showing "37s ago" rather than an ever-growing age.
 */

/** The instant catalog tests treat as "now"; `catalog-contract.test.ts` pins its formatters here. */
export const CATALOG_REFERENCE_NOW = '2026-09-01T12:00:00.000Z';

const referenceMs = Date.parse(CATALOG_REFERENCE_NOW);

/** A fixed ISO timestamp `offsetMs` from the reference instant (negative is the past). */
export function catalogTime(offsetMs = 0): string {
  return new Date(referenceMs + offsetMs).toISOString();
}

/**
 * "Now" for previews whose component measures against the live clock. Fixed at the reference
 * instant under Vitest, so tests never depend on the host clock; real time in the live catalog.
 */
export function catalogNow(): number {
  return import.meta.env.MODE === 'test' ? referenceMs : Date.now();
}

/** A stopwatch for previews that time their own rendering; returns elapsed milliseconds. */
export function catalogStopwatch(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}
