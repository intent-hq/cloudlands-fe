export const LAZY_TURN_THRESHOLD = 10;
export const FORCE_VISIBLE_TURN_COUNT = 1;

export function shouldVirtualizeTurns(turnCount: number): boolean {
  return turnCount > LAZY_TURN_THRESHOLD;
}

export function isTurnInRecentWindow(globalIndex: number, totalTurns: number): boolean {
  return globalIndex >= Math.max(0, totalTurns - FORCE_VISIBLE_TURN_COUNT);
}
