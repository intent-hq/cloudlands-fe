import { put, take, type SagaGenerator } from 'typed-redux-saga';
import { fileSaveOperationSettled } from '../../files/files-slice';
import type { FileSaveOperation } from '../../files/files-types';

import { removeFileContentEntry } from '../../files/files-slice';
import {
  getPanelLayoutActionWorkspaceId,
  isTabRemovalAction,
  PANEL_LAYOUT_STATE_ACTIONS,
} from '../../panel-layout/panel-layout-action-utils';
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

export function createFileContentPruneSaga({
  selectFileContentPrunePayload,
  selectPanelLayoutWorkspaces,
  retainUnsettled,
}: {
  selectFileContentPrunePayload: {
    effect(workspaceId: string, clearLayout?: boolean): SagaGenerator<string[]>;
  };
  selectPanelLayoutWorkspaces: {
    effect(): SagaGenerator<Record<string, WorkspacePanelLayoutState>>;
  };
  retainUnsettled?: {
    selectCanPrune: { effect(workspaceId: string, path: string): SagaGenerator<boolean> };
    selectSaveOperation: {
      effect(requestId: string): SagaGenerator<FileSaveOperation | undefined>;
    };
  };
}) {
  function* cleanup(workspaceId: string, cleared = false): SagaGenerator<void> {
    const paths = yield* selectFileContentPrunePayload.effect(workspaceId, cleared);
    for (const path of paths) {
      if (!retainUnsettled || (yield* retainUnsettled.selectCanPrune.effect(workspaceId, path))) {
        yield* put(removeFileContentEntry(workspaceId, path));
      }
    }
  }
  return function* fileContentPruneSaga(): SagaGenerator<void> {
    let previousLayouts = yield* selectPanelLayoutWorkspaces.effect();
    while (true) {
      const action = yield* take(
        retainUnsettled
          ? [...PANEL_LAYOUT_STATE_ACTIONS, fileSaveOperationSettled]
          : PANEL_LAYOUT_STATE_ACTIONS,
      );
      if (retainUnsettled && action.type === fileSaveOperationSettled.type) {
        const operation = yield* retainUnsettled.selectSaveOperation.effect(
          (action.payload as [string])[0],
        );
        if (operation) yield* cleanup(operation.workspaceId, true);
        continue;
      }
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
      )
        continue;
      yield* cleanup(workspaceId, isExplicitClear);
    }
  };
}
