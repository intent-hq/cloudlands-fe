import { fileContentKey } from '../../../../features/file/utils/file-content-key';
import type { FilesState } from '../files/files-types';
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

const emptyFileContentPrunePaths: string[] = [];

/** Canonical open-tab/cache ownership shared by source and desktop hosts. */
export function getFileContentPrunePayload(
  state: { panelLayout: PanelLayoutSliceState; files: FilesState },
  activeWsId: string | null,
  clearLayout = false,
): string[] {
  if (!(
    activeWsId &&
    activeWsId !== 'new' &&
    !activeWsId.startsWith('optimistic-') &&
    activeWsId !== 'undefined'
  )) {
    return emptyFileContentPrunePaths;
  }

  const ws = state.panelLayout.byWorkspaceId[activeWsId];
  const filesWorkspace = state.files.byWorkspaceId[activeWsId];
  if (!filesWorkspace) {
    return emptyFileContentPrunePaths;
  }
  if (!ws) {
    if (!clearLayout) return emptyFileContentPrunePaths;
    return [...filesWorkspace.files.ids].sort((left, right) => left.localeCompare(right));
  }

  const openPaths = new Set<string>();
  for (const panel of Object.values(ws.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'file' && typeof tab.filePath === 'string' && tab.filePath.length > 0) {
        openPaths.add(
          fileContentKey(
            tab.filePath,
            typeof tab.data?.gitRootId === 'string' ? tab.data.gitRootId : undefined,
          ),
        );
      }
    }
  }

  const stalePaths: string[] = [];
  for (const path of filesWorkspace.files.ids) {
    if (!openPaths.has(path)) {
      stalePaths.push(path);
    }
  }

  if (stalePaths.length === 0) {
    return emptyFileContentPrunePaths;
  }

  stalePaths.sort((left, right) => left.localeCompare(right));
  return stalePaths;
}
