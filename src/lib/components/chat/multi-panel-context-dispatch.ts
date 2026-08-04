import type { PanelContextItem } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';

export type MultiPanelContextDispatchState = {
  workspaceId: string | null;
  panelsSignature: string | null;
};

export type MultiPanelContextDispatchPlan = {
  nextState: MultiPanelContextDispatchState;
  shouldSetWorkspace: boolean;
  shouldUpdatePanels: boolean;
};

const emptyDispatchState: MultiPanelContextDispatchState = {
  workspaceId: null,
  panelsSignature: null,
};

function getPanelContextSignature(panels: readonly PanelContextItem[]): string {
  return JSON.stringify(
    panels.map((panel) => [
      panel.id,
      panel.panelId,
      panel.tabId,
      panel.type,
      panel.label,
      panel.filePath ?? null,
      panel.noteId ?? null,
      panel.browserUrl ?? null,
      panel.agentId ?? null,
      panel.isActive === true,
    ]),
  );
}

export function createMultiPanelContextDispatchPlan(
  previousState: MultiPanelContextDispatchState,
  workspaceId: string | null | undefined,
  panels: readonly PanelContextItem[],
): MultiPanelContextDispatchPlan {
  if (!workspaceId) {
    return {
      nextState: emptyDispatchState,
      shouldSetWorkspace: false,
      shouldUpdatePanels: false,
    };
  }

  const panelsSignature = getPanelContextSignature(panels);
  const workspaceChanged = previousState.workspaceId !== workspaceId;
  const panelsChanged = previousState.panelsSignature !== panelsSignature;

  return {
    nextState: {
      workspaceId,
      panelsSignature,
    },
    shouldSetWorkspace: workspaceChanged,
    shouldUpdatePanels: workspaceChanged || panelsChanged,
  };
}