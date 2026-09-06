/**
 * Tiling System Utilities
 *
 * Calculates optimal panel layouts based on container dimensions.
 * Used for applying presets that tile multiple items (agents, files, etc.)
 */

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
export function calculateTiling(width: number, height: number, itemCount: number): TilingConfig {
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
