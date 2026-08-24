import {
  countHorizontalPanelColumns,
  getPanelOrder,
  insertFixedColumnInLayout,
  movePanelInLayout,
  movePanelToRootEdgeInLayout,
  type PanelMovePosition,
} from '$store/renderer/slices/panel-layout/panel-layout-tabless';
import type { PanelLayoutNode } from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { PaneDropPlacement } from '$lib/components/layout/panel-system/panel-drag';

export const PANE_DROP_PREVIEW_PANEL_ID = '__pane-drop-preview__';

export function getPaneDropPreview(
  root: PanelLayoutNode,
  placement: PaneDropPlacement,
  canvasWidth: number | null | undefined,
): PanelLayoutNode {
  if (placement.kind === 'panel' && placement.zone === 'center') return root;

  const panelIds = getPanelOrder(root);
  const targetPanelId =
    placement.kind === 'edge'
      ? placement.position === 'before'
        ? panelIds[0]
        : panelIds.at(-1)
      : placement.targetPanelId;
  const position =
    placement.kind === 'edge' ? placement.position : placement.zone === 'left' ? 'before' : 'after';
  if (!targetPanelId) return root;

  return (
    insertFixedColumnInLayout(
      root,
      PANE_DROP_PREVIEW_PANEL_ID,
      targetPanelId,
      position,
      canvasWidth,
    ) ?? root
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
