// Keep normal conversations fully materialized. Virtualization has a larger
// payoff only after the transcript is long enough to offset placeholder swaps.
export const LAZY_TURN_THRESHOLD = 20;

// Keep a small tail mounted so streaming and short upward reads near the
// bottom do not cross the materialization boundary on every turn.
export const FORCE_VISIBLE_TURN_COUNT = 3;

export function shouldVirtualizeTurns(turnCount: number): boolean {
  return turnCount > LAZY_TURN_THRESHOLD;
}

export function isTurnInRecentWindow(globalIndex: number, totalTurns: number): boolean {
  return globalIndex >= Math.max(0, totalTurns - FORCE_VISIBLE_TURN_COUNT);
}
