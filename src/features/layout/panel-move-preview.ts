import {
  countHorizontalPanelColumns,
  movePanelInLayout,
  movePanelToRootEdgeInLayout,
  projectPaneMoveInLayout,
  type PaneMoveProjection,
  type PaneMoveTarget,
  type PanelMovePosition,
} from '$store/renderer/slices/panel-layout/panel-layout-tabless';
import type {
  PanelLayoutNode,
  PanelState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import type {
  DraggedPane,
  PaneDropPlacement,
} from '$lib/components/layout/panel-system/panel-drag';

export const PANE_DROP_PREVIEW_PANEL_ID = '__pane-drop-preview__';

export type PaneDropPreview = PaneMoveProjection;

function toPaneMoveTarget(placement: PaneDropPlacement): PaneMoveTarget {
  if (placement.kind === 'edge') return placement;
  return {
    kind: 'panel',
    targetPanelId: placement.targetPanelId,
    position:
      placement.zone === 'center' ? 'center' : placement.zone === 'left' ? 'before' : 'after',
  };
}

export function getPaneDropPreview(
  layout: { root: PanelLayoutNode; panels: Record<string, PanelState> },
  draggedPane: DraggedPane,
  placement: PaneDropPlacement,
  canvasWidth: number | null | undefined,
): PaneDropPreview | null {
  return projectPaneMoveInLayout(
    { ...layout, canvasWidth },
    draggedPane.tabId,
    draggedPane.panelId,
    toPaneMoveTarget(placement),
    PANE_DROP_PREVIEW_PANEL_ID,
  );
}

export function getPanelMovePreview(
  root: PanelLayoutNode,
  panelId: string,
  targetPanelId: string,
  position: PanelMovePosition,
): PanelLayoutNode {
  return movePanelInLayout(root, panelId, targetPanelId, position) ?? root;
}

export function getPanelRootEdgeMovePreview(
  root: PanelLayoutNode,
  panelId: string,
  position: PanelMovePosition,
): PanelLayoutNode {
  return movePanelToRootEdgeInLayout(root, panelId, position) ?? root;
}

export function getPanelMovePreviewWidthRatio(
  root: PanelLayoutNode,
  previewRoot: PanelLayoutNode,
): number {
  const currentColumns = countHorizontalPanelColumns(root);
  const previewColumns = countHorizontalPanelColumns(previewRoot);
  return currentColumns > 0 ? previewColumns / currentColumns : 1;
}
