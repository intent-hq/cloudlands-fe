/**
 * PR Monitor Selectors (PROTOCOL §6.9)
 */

import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';

/** All live-subscribed monitors for a workspace (active + completed), in seed order. */
export const selectPrMonitors = store.createSelector(
  (state, workspaceId: string): PrMonitorRow[] => {
    // Optional chain: cross-slice consumers (workspace-selectors) run
    // against partial test states without this slice.
    const ws = state.prMonitor?.byWorkspaceId?.[workspaceId];
    if (!ws) return [];
    return getItems(ws.monitors);
  },
);

/** Active monitors only — the "View PR" fallback and card "+N" sources. */
export const selectActivePrMonitors = store.createSelector(
  (state, workspaceId: string): PrMonitorRow[] =>
    selectPrMonitors.select(state, workspaceId).filter((m) => m.state === 'active'),
);

/** Monitor pool backing the workspace card/row PR pill fallback: active
 * monitors when any exist, otherwise completed monitors whose last snapshot
 * ended merged (case-insensitive), sorted `updatedAt` desc (PR number desc as
 * tiebreak) so index 0 is the last merged PR. Completed-but-closed monitors
 * never resurrect a pill. */
export const selectDisplayPrMonitors = store.createSelector(
  (state, workspaceId: string): PrMonitorRow[] => {
    const monitors = selectPrMonitors.select(state, workspaceId);
    const active = monitors.filter((m) => m.state === 'active');
    if (active.length > 0) return active;
    return monitors
      .filter(
        (m) => m.state === 'completed' && m.lastSnapshot?.state?.toLowerCase() === 'merged',
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.prNumber - a.prNumber);
  },
);

/** One agent's monitors (active + completed) for the chat chip row. */
export const selectAgentPrMonitors = store.createSelector(
  (state, workspaceId: string, agentId: string): PrMonitorRow[] =>
    selectPrMonitors.select(state, workspaceId).filter((m) => m.agentId === agentId),
);
