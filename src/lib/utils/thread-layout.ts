/**
 * Thread Layout Algorithm
 *
 * Provides a swappable interface for computing non-overlapping positions
 * for thread UI elements based on their anchor positions in the document.
 *
 * This is a direct port from the reference implementation.
 */

import { Logger } from '$shared/logger';

const logger = new Logger('ThreadLayout');

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Input: Raw thread data with measurements
 */
export interface ThreadLayoutInput {
  id: string;
  anchorY: number; // Ideal Y position (from mark bounding box)
  height: number; // Measured height of thread UI element
}

/**
 * Output: Computed layout positions
 */
export interface ThreadLayoutOutput {
  id: string;
  anchorY: number; // Original anchor position (for reference)
  displayY: number; // Computed display position (top edge)
  height: number; // Height (passed through)
}

/**
 * Configuration for layout algorithm
 */
export interface LayoutConfig {
  minSpacing?: number; // Minimum gap between threads (default: 8px)
  focusedThreadId?: string | null; // Thread to pin at its anchor position
}

/**
 * The swappable layout algorithm interface
 */
export type LayoutAlgorithm = (
  threads: ThreadLayoutInput[],
  config: LayoutConfig,
) => ThreadLayoutOutput[];

// ============================================
// BIDIRECTIONAL GREEDY LAYOUT ALGORITHM
// ============================================

/**
 * Bidirectional greedy layout algorithm with focus pinning.
 *
 * Improvements over simple greedy:
 * - Allows shifting threads both UP and DOWN to minimize displacement
 * - Uses iterative collision resolution
 * - Minimizes total displacement from anchor positions
 *
 * Algorithm:
 * 1. Sort threads by anchor Y position (top to bottom)
 * 2. If a thread is focused, pin it to its anchor
 * 3. Initialize all threads at their anchor positions
 * 4. Iteratively resolve collisions by shifting threads up or down
 *    - Choose direction that minimizes displacement
 *    - Respect focused thread (never move it)
 * 5. Continue until no collisions or max iterations reached
 *
 * Time complexity: O(n × iterations) where iterations is typically small (< 10)
 */
export const bidirectionalGreedyLayout: LayoutAlgorithm = (threads, config) => {
  const minSpacing = config.minSpacing ?? 8;
  const focusedThreadId = config.focusedThreadId ?? null;
  const maxIterations = 10;

  // Handle empty case
  if (threads.length === 0) {
    return [];
  }

  // Sort by anchor Y position (top to bottom)
  const sorted = [...threads].sort((a, b) => a.anchorY - b.anchorY);

  // Initialize output with anchor positions
  const output: ThreadLayoutOutput[] = sorted.map((t) => ({
    id: t.id,
    anchorY: t.anchorY,
    displayY: t.anchorY,
    height: t.height,
  }));

  // Find focused thread index
  const focusedIndex = focusedThreadId ? output.findIndex((t) => t.id === focusedThreadId) : -1;

  // Iteratively resolve collisions
  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Check each adjacent pair for collisions
    for (let i = 0; i < output.length - 1; i++) {
      const current = output[i];
      const next = output[i + 1];

      // Calculate gap between threads
      const gap = next.displayY - (current.displayY + current.height);

      // If collision detected
      if (gap < minSpacing) {
        const neededSpace = minSpacing - gap;

        // If focused thread is involved, only move the non-focused one
        if (focusedIndex === i) {
          // Current is focused, push next down
          next.displayY = current.displayY + current.height + minSpacing;
          changed = true;
          continue;
        } else if (focusedIndex === i + 1) {
          // Next is focused, push current up
          current.displayY = next.displayY - current.height - minSpacing;
          changed = true;
          continue;
        }

        // Neither is focused: choose direction that minimizes displacement
        const currentDisplacement = Math.abs(current.displayY - current.anchorY);
        const nextDisplacement = Math.abs(next.displayY - next.anchorY);

        // Calculate cost of pushing each direction
        const pushUpCost = currentDisplacement + neededSpace;
        const pushDownCost = nextDisplacement + neededSpace;

        // Also consider if we're already displaced in a direction
        const currentIsBelow = current.displayY > current.anchorY;
        const nextIsAbove = next.displayY < next.anchorY;

        if (pushUpCost < pushDownCost && i > 0 && !currentIsBelow) {
          // Push current up (but not above previous thread or negative)
          const maxUpShift =
            i > 0
              ? current.displayY - (output[i - 1].displayY + output[i - 1].height + minSpacing)
              : current.displayY; // Can't go negative

          const actualShift = Math.min(neededSpace, maxUpShift);
          current.displayY -= actualShift;

          // If we couldn't shift enough, push next down for the remainder
          if (actualShift < neededSpace) {
            next.displayY += neededSpace - actualShift;
          }

          changed = true;
        } else {
          // Push next down
          next.displayY = current.displayY + current.height + minSpacing;
          changed = true;
        }
      }
    }
  }

  if (iterations >= maxIterations) {
    logger.warn(`Layout algorithm reached max iterations (${maxIterations})`);
  }

  return output;
};

// ============================================
// DEFAULT EXPORT
// ============================================

/**
 * The currently active layout algorithm.
 */
export const layoutThreads = bidirectionalGreedyLayout;
