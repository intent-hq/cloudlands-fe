import type { PanelLayoutNode } from '$features/layout/panel-layout-adapter';
import { MIN_PANEL_CANVAS_WIDTH, PANEL_SPLIT_GUTTER_WIDTH } from '$shared/panel-layout-sizing';

function containsPanel(node: PanelLayoutNode, panelId: string): boolean {
  if (node.type === 'panel') return node.panelId === panelId;
  return node.children.some((child) => containsPanel(child, panelId));
}

export function getCompactPanelWidth(node: PanelLayoutNode): number {
  if (node.type === 'panel') return MIN_PANEL_CANVAS_WIDTH;
  const childWidths = node.children.map(getCompactPanelWidth);
  return node.direction === 'vertical'
    ? Math.max(MIN_PANEL_CANVAS_WIDTH, ...childWidths)
    : childWidths.reduce((total, width) => total + width, 0) +
        PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, node.children.length - 1);
}

/** Resolve dominant horizontal children directly in pixels against the live rendered width. */
export function getDominantPanelChildWidth(
  node: PanelLayoutNode,
  childIndex: number,
  dominantPanelId: string | null,
  referenceWidth: number | null,
): number | null {
  if (
    !dominantPanelId ||
    referenceWidth === null ||
    node.type !== 'split' ||
    node.direction !== 'horizontal'
  ) {
    return null;
  }

  const compactWidths = node.children.map(getCompactPanelWidth);
  const dominantIndex = node.children.findIndex((child) => containsPanel(child, dominantPanelId));
  if (dominantIndex < 0) return compactWidths[childIndex] ?? null;
  if (childIndex !== dominantIndex) return compactWidths[childIndex] ?? null;

  const siblingWidth = compactWidths.reduce(
    (total, width, index) => total + (index === dominantIndex ? 0 : width),
    0,
  );
  return Math.max(
    compactWidths[dominantIndex] ?? MIN_PANEL_CANVAS_WIDTH,
    referenceWidth - siblingWidth,
  );
}
