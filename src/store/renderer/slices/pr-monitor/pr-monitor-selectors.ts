/**
 * PR Monitor Selectors (PROTOCOL §6.9)
 */

import { store } from "../../store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import type { PrMonitorRow } from "$features/pr-monitor/pr-monitor-service";

/** All live-subscribed monitors for a workspace (active + completed), in seed order. */
export const selectPrMonitors = store.createSelector(
  (state, workspaceId: string): PrMonitorRow[] => {
    const ws = state.prMonitor.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.monitors);
  },
);

/** Active monitors only — the "View PR" fallback and card "+N" sources. */
export const selectActivePrMonitors = store.createSelector(
  (state, workspaceId: string): PrMonitorRow[] =>
    selectPrMonitors.select(state, workspaceId).filter((m) => m.state === "active"),
);

/** One agent's monitors (active + completed) for the chat chip row. */
export const selectAgentPrMonitors = store.createSelector(
  (state, workspaceId: string, agentId: string): PrMonitorRow[] =>
    selectPrMonitors.select(state, workspaceId).filter((m) => m.agentId === agentId),
);
