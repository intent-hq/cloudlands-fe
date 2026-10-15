import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { emptyWorkspaceState, isRecentlyClosedPanelColumnRestorable } from './panel-layout-slice';
import type {
  PanelLayoutSliceState,
  PanelState,
  RecentlyClosedPanelColumn,
} from './panel-layout-types';

export const getPanels = (
  state: { panelLayout: PanelLayoutSliceState },
  wsId: string,
): Record<string, PanelState> =>
  (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels;

export const getPanelLayoutWorkspace = (
  state: { panelLayout: PanelLayoutSliceState },
  wsId: string,
) => state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState;

export const getPanelColumnCount = (state: { panelLayout: PanelLayoutSliceState }, wsId: string) =>
  getPanelLayoutWorkspace(state, wsId).columnCount;

export const getRecentlyClosed = (state: { panelLayout: PanelLayoutSliceState }, wsId: string) =>
  getPanelLayoutWorkspace(state, wsId).recentlyClosed;

/** Shared source/React history order; reopening a column and a tab are distinct actions. */
export function getLastPanelClose(
  state: { panelLayout: PanelLayoutSliceState },
  wsId: string,
): { kind: 'column' | 'tab'; closedAt: number } | null {
  const workspace = getPanelLayoutWorkspace(state, wsId);
  const tab = getRecentlyClosed(state, wsId)[0] ?? null;
  const column =
    getItems(
      workspace.recentlyClosedColumns ??
        createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
    ).find((closed) => isRecentlyClosedPanelColumnRestorable(workspace, closed)) ?? null;
  return column && (!tab || column.closedAt >= tab.closedAt)
    ? { kind: 'column', closedAt: column.closedAt }
    : tab
      ? { kind: 'tab', closedAt: tab.closedAt }
      : null;
}
