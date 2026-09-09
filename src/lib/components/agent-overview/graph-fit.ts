import { GRAPH_FIT_PADDING } from './constants';

interface FitBounds {
  width: number;
  height: number;
}

/** Largest scale that contains the padded graph inside the available viewport. */
export function containedFitScale(
  bounds: FitBounds,
  availableWidth: number,
  availableHeight: number,
  maximumScale: number,
): number {
  return Math.min(
    maximumScale,
    availableWidth / Math.max(1, bounds.width + GRAPH_FIT_PADDING * 2),
    availableHeight / Math.max(1, bounds.height + GRAPH_FIT_PADDING * 2),
  );
}
