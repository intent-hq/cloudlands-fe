import { describe, expect, it } from 'vitest';
import type { HudWorkspaceCard } from '$store/renderer/slices/hud/hud-selectors';
import { formatCardTokens } from './hud-card-meta';
import {
  applyHudGridFilter,
  EMPTY_HUD_GRID_FILTER,
  repoOptions,
  stateCounts,
  toggleState,
} from './hud-grid-filter';

function makeCard(overrides: Partial<HudWorkspaceCard>): HudWorkspaceCard {
  return {
    workspaceId: 'ws-1',
    title: 'Workspace',
    repoRef: 'intent-hq/intentd',
    stateKey: 'in_progress',
    attention: null,
    statusMessage: null,
    prNumber: null,
    tasks: { total: 0, completed: 0, inProgress: 0 },
    tokens: 0,
    agents: [],
    ...overrides,
  };
}

describe('hud-grid-filter', () => {
  const cards = [
    makeCard({ workspaceId: 'ws-1', repoRef: 'intent-hq/intentd', stateKey: 'in_progress' }),
    makeCard({ workspaceId: 'ws-2', repoRef: 'intent-hq/intentd', stateKey: 'pr_open' }),
    makeCard({ workspaceId: 'ws-3', repoRef: 'intent-hq/cloudlands-fe', stateKey: 'wait' }),
  ];

  it('repoOptions returns distinct repos with counts in first-seen order', () => {
    expect(repoOptions(cards)).toEqual([
      { repo: 'intent-hq/intentd', count: 2 },
      { repo: 'intent-hq/cloudlands-fe', count: 1 },
    ]);
  });

  it('stateCounts tallies cards per state key', () => {
    expect(stateCounts(cards)).toEqual({ in_progress: 1, pr_open: 1, wait: 1 });
  });

  it('toggleState adds then removes a state key', () => {
    const on = toggleState(EMPTY_HUD_GRID_FILTER, 'wait');
    expect(on.states).toEqual(['wait']);
    expect(toggleState(on, 'wait').states).toEqual([]);
  });

  it('empty filter passes everything; repo and states AND together', () => {
    expect(applyHudGridFilter(cards, EMPTY_HUD_GRID_FILTER)).toHaveLength(3);
    expect(
      applyHudGridFilter(cards, { repo: 'intent-hq/intentd', states: [] }).map(
        (card) => card.workspaceId,
      ),
    ).toEqual(['ws-1', 'ws-2']);
    expect(
      applyHudGridFilter(cards, { repo: 'intent-hq/intentd', states: ['pr_open'] }).map(
        (card) => card.workspaceId,
      ),
    ).toEqual(['ws-2']);
    expect(applyHudGridFilter(cards, { repo: null, states: ['wait', 'pr_open'] })).toHaveLength(2);
  });
});

describe('formatCardTokens', () => {
  it('formats plain, k, and M magnitudes like the mock kTok', () => {
    expect(formatCardTokens(0)).toBe('0');
    expect(formatCardTokens(999)).toBe('999');
    expect(formatCardTokens(88_400)).toBe('88.4k');
    expect(formatCardTokens(1_260_000)).toBe('1.3M');
  });

  it('clamps negatives and non-finite input to 0', () => {
    expect(formatCardTokens(-5)).toBe('0');
    expect(formatCardTokens(Number.NaN)).toBe('0');
  });
});
