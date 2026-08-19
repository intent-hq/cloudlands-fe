import { put, take, type SagaGenerator } from 'typed-redux-saga';

import { removeFileContentEntry } from '../../files/files-slice';
import {
  getPanelLayoutActionWorkspaceId,
  isTabRemovalAction,
  PANEL_LAYOUT_STATE_ACTIONS,
} from '../../panel-layout/panel-layout-action-utils';
import {
  selectFileContentPrunePayload,
  selectPanelLayoutWorkspaces,
} from '../../panel-layout/panel-layout-selectors';
import { clearPanelLayout } from '../../panel-layout/panel-layout-slice';
import type { WorkspacePanelLayoutState } from '../../panel-layout/panel-layout-types';

function hasRemovedTab(
  previousLayout: WorkspacePanelLayoutState,
  currentLayout: WorkspacePanelLayoutState,
): boolean {
  const currentTabIds = new Set(
    Object.values(currentLayout.panels).flatMap((panel) => panel.tabs.map((tab) => tab.id)),
  );
  return Object.values(previousLayout.panels).some((panel) =>
    panel.tabs.some((tab) => !currentTabIds.has(tab.id)),
  );
}

function* cleanupClosedFileContentEntries(action: {
  type: string;
  payload?: unknown;
}): SagaGenerator<void> {
  const workspaceId = getPanelLayoutActionWorkspaceId(action);
  if (!workspaceId) return;
  const payload = yield* selectFileContentPrunePayload.effect(
    workspaceId,
    action.type === clearPanelLayout.type,
  );

  for (const path of payload) {
    yield* put(removeFileContentEntry(workspaceId, path));
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* fileContentPruneSaga(): SagaGenerator<void> {
  let previousLayouts = yield* selectPanelLayoutWorkspaces.effect();

  while (true) {
    const action = yield* take(PANEL_LAYOUT_STATE_ACTIONS);
    const currentLayouts = yield* selectPanelLayoutWorkspaces.effect();
    const workspaceId = getPanelLayoutActionWorkspaceId(action);
    if (!workspaceId) {
      previousLayouts = currentLayouts;
      continue;
    }

    const isExplicitClear = action.type === clearPanelLayout.type;
    const previousLayout = previousLayouts[workspaceId];
    const currentLayout = currentLayouts[workspaceId];
    previousLayouts = currentLayouts;

    if (!isTabRemovalAction(action)) continue;
    if (
      !isExplicitClear &&
      (!previousLayout ||
        !currentLayout ||
        previousLayout === currentLayout ||
        !hasRemovedTab(previousLayout, currentLayout))
    ) {
      continue;
    }

    yield* cleanupClosedFileContentEntries(action);
  }
}
