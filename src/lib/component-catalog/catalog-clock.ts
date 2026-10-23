/**
 * The catalog's clock: the only place a catalog renderer, fixture or `*.preview.*` file may
 * read the time (enforced by `intent/no-wall-clock-in-catalog-previews`).
 *
 * A preview that stamps a fixture from the real clock while the component measures that
 * stamp against the real clock again renders differently depending on how slowly it runs:
 * the toast catalog's "18s" attention toast became "20s" on a busy machine and failed its
 * snapshot (2026-10-23). Snapshot suites therefore freeze `Date` at `CATALOG_REFERENCE_NOW`
 * (`vi.setSystemTime`, Date only), so the fixture stamp and the component's own clock read
 * the same instant. Prefer a fixed ISO date from `catalogTime()`; use `catalogNow()` only
 * where the component measures against its live clock (relative ages, countdowns, uptime).
 */

/** The instant catalog snapshot suites freeze `Date` at (see catalog-contract.test.ts). */
export const CATALOG_REFERENCE_NOW = '2026-09-01T12:00:00.000Z';

const referenceMs = Date.parse(CATALOG_REFERENCE_NOW);

/** A fixed ISO timestamp `offsetMs` from the reference instant (negative is the past). */
export function catalogTime(offsetMs = 0): string {
  return new Date(referenceMs + offsetMs).toISOString();
}

/**
 * "Now" for previews whose component measures against the live clock. Always the system
 * clock, so the fixture and the component agree: live in the catalog, frozen in a suite
 * that pins `Date`.
 */
export function catalogNow(): number {
  return Date.now();
}

/** A stopwatch for previews that time their own rendering; returns elapsed milliseconds. */
export function catalogStopwatch(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}
