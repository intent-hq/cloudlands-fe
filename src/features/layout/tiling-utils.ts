/**
 * Tiling System Utilities
 *
 * Calculates optimal panel layouts based on container dimensions.
 * Used for applying presets that tile multiple items (agents, files, etc.)
 */

import type { PanelLayoutNode } from '$lib/store/slices/panel-layout/panel-layout-types';

/**
 * Tiling configuration based on container dimensions
 */
export interface TilingConfig {
  /** Number of columns */
  columns: number;
  /** Number of rows */
  rows: number;
  /** Maximum items that can be displayed */
  maxItems: number;
}

/**
 * Breakpoint thresholds for tiling
 */
const BREAKPOINTS = {
  /** Width threshold for switching between 2 and 3 columns */
  narrowWidth: 600,
  /** Height threshold for switching between 2 and 3 rows */
  shortHeight: 500,
  /** Minimum width to show 3 columns */
  wideWidth: 900,
};

/**
 * Calculate optimal tiling configuration based on dimensions
 *
 * @param width - Container width in pixels
 * @param height - Container height in pixels
 * @param itemCount - Number of items to display
 * @returns Tiling configuration
 */
export function calculateTiling(
  width: number,
  height: number,
  itemCount: number,
): TilingConfig {
  // Determine columns based on width
  let columns: number;
  if (width < BREAKPOINTS.narrowWidth) {
    columns = 2;
  } else if (width < BREAKPOINTS.wideWidth) {
    columns = Math.min(3, itemCount);
  } else {
    columns = Math.min(3, itemCount);
  }

  // Determine rows based on height and item count
  let rows: number;
  if (height < BREAKPOINTS.shortHeight) {
    rows = 2;
  } else {
    rows = Math.min(3, Math.ceil(itemCount / columns));
  }

  // Calculate max items that can fit
  const maxItems = columns * rows;

  return { columns, rows, maxItems };
}

/**
 * Generate a panel layout node for a grid of items
 *
 * @param itemCount - Number of items to lay out
 * @param columns - Number of columns
 * @param rows - Number of rows
 * @param generatePanelId - Function to generate unique panel IDs
 * @returns Layout node and array of panel IDs
 */
export function generateGridLayout(
  itemCount: number,
  columns: number,
  rows: number,
  generatePanelId: () => string,
): { root: PanelLayoutNode; panelIds: string[] } {
  const panelIds: string[] = [];
  const actualItems = Math.min(itemCount, columns * rows);

  // Single panel case
  if (actualItems === 1) {
    const panelId = generatePanelId();
    panelIds.push(panelId);
    return {
      root: { type: 'panel', panelId },
      panelIds,
    };
  }

  // Calculate how many items per row
  const actualRows = Math.ceil(actualItems / columns);
  const rowNodes: PanelLayoutNode[] = [];

  for (let row = 0; row < actualRows; row++) {
    const rowStartIndex = row * columns;
    const rowEndIndex = Math.min(rowStartIndex + columns, actualItems);
    const rowItemCount = rowEndIndex - rowStartIndex;

    if (rowItemCount === 1) {
      // Single item in row
      const panelId = generatePanelId();
      panelIds.push(panelId);
      rowNodes.push({ type: 'panel', panelId });
    } else {
      // Multiple items in row - horizontal split
      const children: PanelLayoutNode[] = [];
      const sizes: number[] = [];

      for (let i = 0; i < rowItemCount; i++) {
        const panelId = generatePanelId();
        panelIds.push(panelId);
        children.push({ type: 'panel', panelId });
        sizes.push(100 / rowItemCount);
      }

      rowNodes.push({
        type: 'split',
        direction: 'horizontal',
        children,
        sizes,
      });
    }
  }

  // If only one row, return it directly
  if (rowNodes.length === 1) {
    return { root: rowNodes[0], panelIds };
  }

  // Multiple rows - vertical split
  const rowSizes = rowNodes.map(() => 100 / rowNodes.length);
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      children: rowNodes,
      sizes: rowSizes,
    },
    panelIds,
  };
}

/**
 * Calculate panel sizes for even distribution
 */
export function evenSizes(count: number): number[] {
  return Array(count).fill(100 / count);
}
