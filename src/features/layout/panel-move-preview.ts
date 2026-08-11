import {
  countHorizontalPanelColumns,
  movePanelInLayout,
  movePanelToRootEdgeInLayout,
  type PanelMovePosition,
} from '$store/renderer/slices/panel-layout/panel-layout-tabless';
import type { PanelLayoutNode } from '$store/renderer/slices/panel-layout/panel-layout-types';

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
