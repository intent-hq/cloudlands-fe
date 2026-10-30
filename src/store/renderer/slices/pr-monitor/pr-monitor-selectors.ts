/**
 * PR Monitor Selectors (PROTOCOL §6.9)
 */

import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  isLegacyMonitorPresentation,
  type ReviewMonitorRow,
  type ReviewMonitoringSupport,
} from '$shared/types/pr-monitor';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type { PrMonitorSnapshotStatus } from './pr-monitor-slice';

/** All live-subscribed monitors for a workspace (active + completed), in seed order. */
export const selectReviewMonitors = store.createSelector(
  (state, workspaceId: string): ReviewMonitorRow[] => {
    // Optional chain: cross-slice consumers (workspace-selectors) run
    // against partial test states without this slice.
    const ws = state.prMonitor?.byWorkspaceId?.[workspaceId];
    if (!ws) return [];
    return getItems(ws.monitors);
  },
);

/** Legacy consumers remain isolated until every UI path supports qualified facts. */
export const selectPrMonitors = store.createSelector((state, workspaceId: string): PrMonitorRow[] =>
  selectReviewMonitors.select(state, workspaceId).filter(isLegacyMonitorPresentation),
);
export const selectReviewMonitoringSupport = store.createSelector(
  (state, workspaceId: string): ReviewMonitoringSupport =>
    state.prMonitor?.byWorkspaceId?.[workspaceId]?.support ?? 'unsupported',
);

export const selectPrMonitorsSnapshotStatus = store.createSelector(
  (state, workspaceId: string): PrMonitorSnapshotStatus =>
    state.prMonitor?.byWorkspaceId?.[workspaceId]?.snapshotStatus ?? 'loading',
);

/** Qualified consumers preserve provider identity and nullable facts. */
export const selectActiveReviewMonitors = store.createSelector(
  (state, workspaceId: string): ReviewMonitorRow[] =>
    selectReviewMonitors.select(state, workspaceId).filter((row) => row.state === 'active'),
);
export const selectAgentReviewMonitors = store.createSelector(
  (state, workspaceId: string, agentId: string): ReviewMonitorRow[] =>
    selectReviewMonitors.select(state, workspaceId).filter((row) => row.agentId === agentId),
);
