/**
 * Client-side filter predicates for the HUD workspace grid — pure functions
 * over card view-models so they are unit-testable: single-select repo filter
 * plus a multi-select card-state filter (empty selection = all).
 */
import type { HudWorkspaceCard } from '$store/renderer/slices/hud/hud-selectors';
import type { HudCardStateKey, HudGridFilter } from '$store/renderer/slices/hud/hud-types';

export { EMPTY_HUD_GRID_FILTER, type HudGridFilter } from '$store/renderer/slices/hud/hud-types';

/** Distinct repo refs across cards, in first-seen order, with counts. */
export function repoOptions(cards: HudWorkspaceCard[]): Array<{ repo: string; count: number }> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.repoRef, (counts.get(card.repoRef) ?? 0) + 1);
  }
  return [...counts.entries()].map(([repo, count]) => ({ repo, count }));
}

/** Cards per state key (menu row counts). */
export function stateCounts(cards: HudWorkspaceCard[]): Partial<Record<HudCardStateKey, number>> {
  const counts: Partial<Record<HudCardStateKey, number>> = {};
  for (const card of cards) {
    counts[card.stateKey] = (counts[card.stateKey] ?? 0) + 1;
  }
  return counts;
}

/** Toggle one state key in the multi-select. */
export function toggleState(filter: HudGridFilter, state: HudCardStateKey): HudGridFilter {
  return filter.states.includes(state)
    ? { ...filter, states: filter.states.filter((existing) => existing !== state) }
    : { ...filter, states: [...filter.states, state] };
}

/** Apply both filters (AND semantics; empty selections pass everything). */
export function applyHudGridFilter(
  cards: HudWorkspaceCard[],
  filter: HudGridFilter,
): HudWorkspaceCard[] {
  return cards.filter(
    (card) =>
      (filter.repo === null || card.repoRef === filter.repo) &&
      (filter.states.length === 0 || filter.states.includes(card.stateKey)),
  );
}
