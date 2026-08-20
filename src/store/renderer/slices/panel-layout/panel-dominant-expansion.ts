import {
  MIN_PANEL_CANVAS_WIDTH,
  PANEL_SPLIT_GUTTER_WIDTH,
} from '../../../../shared/panel-layout-sizing';
import type { PanelLayoutNode, PanelState, SavedExpandSizes } from './panel-layout-types';
import { getHorizontalPanelColumnDefaultWidths } from './panel-layout-tabless';

function containsPanel(node: PanelLayoutNode, panelId: string): boolean {
  if (node.type === 'panel') return node.panelId === panelId;
  return node.children.some((child) => containsPanel(child, panelId));
}

function getCompactPanelLayoutWidth(node: PanelLayoutNode): number {
  if (node.type === 'panel') return MIN_PANEL_CANVAS_WIDTH;
  const childWidths = node.children.map(getCompactPanelLayoutWidth);
  if (node.direction === 'vertical') return Math.max(MIN_PANEL_CANVAS_WIDTH, ...childWidths);
  return (
    childWidths.reduce((sum, width) => sum + width, 0) +
    PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, childWidths.length - 1)
  );
}

function getPreferredPanelLayoutWidth(
  node: PanelLayoutNode,
  panels: Record<string, PanelState>,
): number {
  const widths = getHorizontalPanelColumnDefaultWidths(node, panels);
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, widths.length - 1)
  );
}

function getRequiredDominantWidth(
  node: PanelLayoutNode,
  panels: Record<string, PanelState>,
  panelId: string,
): number {
  if (!containsPanel(node, panelId)) return getCompactPanelLayoutWidth(node);
  if (node.type === 'panel') return getPreferredPanelLayoutWidth(node, panels);
  const widths = node.children.map((child) => getRequiredDominantWidth(child, panels, panelId));
  if (node.direction === 'vertical') return Math.max(MIN_PANEL_CANVAS_WIDTH, ...widths);
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, widths.length - 1)
  );
}

export function getDominantPanelCanvasWidth(
  root: PanelLayoutNode,
  panels: Record<string, PanelState>,
  panelId: string,
  availableWidth: number,
): number {
  return Math.max(availableWidth, getRequiredDominantWidth(root, panels, panelId));
}

export function getDominantSplitGeometry(
  node: Extract<PanelLayoutNode, { type: 'split' }>,
  targetIndex: number,
  outerWidth: number,
): { sizes: number[]; targetWidth: number } {
  const gutterWidth = PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, node.children.length - 1);
  const minimums = node.children.map(getCompactPanelLayoutWidth);
  const siblingWidth = minimums.reduce(
    (sum, width, index) => sum + (index === targetIndex ? 0 : width),
    0,
  );
  const referenceWidth = Math.max(
    1,
    outerWidth - gutterWidth,
    siblingWidth + minimums[targetIndex],
  );
  const targetWidth = referenceWidth - siblingWidth;
  const widths = minimums.map((width, index) => (index === targetIndex ? targetWidth : width));
  return { sizes: widths.map((width) => (width / referenceWidth) * 100), targetWidth };
}

export function snapshotPanelSplitSizes(
  node: PanelLayoutNode,
  nodePath: number[] = [],
): SavedExpandSizes[] {
  if (node.type === 'panel') return [];
  return [
    { nodePath, sizes: [...node.sizes] },
    ...node.children.flatMap((child, index) =>
      snapshotPanelSplitSizes(child, [...nodePath, index]),
    ),
  ];
}
