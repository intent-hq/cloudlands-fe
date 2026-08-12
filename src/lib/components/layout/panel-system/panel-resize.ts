export const MIN_PANEL_SIZE_PERCENT = 10;
export const MAX_PANEL_SIZE_PERCENT = 100;

export function getPanelReferenceSize(availableSize: number, totalGutterSize: number): number {
  return Math.max(1, availableSize - totalGutterSize);
}

export function getPanelFlexValue(
  sizePercent: number,
  panelReferenceSize: number | null,
  retainedPixelSize: number | null = null,
): string {
  if (retainedPixelSize !== null) return `0 0 ${retainedPixelSize}px`;
  if (panelReferenceSize === null) return `${sizePercent} 1 0%`;
  return `0 0 ${(panelReferenceSize * sizePercent) / 100}px`;
}

export function resizeAdjacentPanels(
  sizes: number[],
  panelIndex: number,
  deltaPercent: number,
): number[] {
  if (panelIndex < 0 || panelIndex >= sizes.length - 1 || !Number.isFinite(deltaPercent)) {
    return sizes;
  }

  const nextSizes = [...sizes];
  const adjacentTotal = nextSizes[panelIndex] + nextSizes[panelIndex + 1];
  const minimumSize = Math.min(MIN_PANEL_SIZE_PERCENT, adjacentTotal / 2);
  const minimumResizedPanel = Math.max(minimumSize, adjacentTotal - MAX_PANEL_SIZE_PERCENT);
  const maximumResizedPanel = Math.min(MAX_PANEL_SIZE_PERCENT, adjacentTotal - minimumSize);
  const resizedPanel = Math.max(
    minimumResizedPanel,
    Math.min(maximumResizedPanel, nextSizes[panelIndex] + deltaPercent),
  );
  nextSizes[panelIndex] = resizedPanel;
  nextSizes[panelIndex + 1] = adjacentTotal - resizedPanel;
  return nextSizes;
}
