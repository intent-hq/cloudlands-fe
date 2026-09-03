export interface AvatarStackFitOptions {
  itemCount: number;
  maxVisible: number;
  availableWidth: number;
  /** Avatar surface size in px (see `agentAvatarGeometry[variant].surface`). */
  surface: number;
  /** Stack overlap in px (see `agentAvatarGeometry[variant].overlap`). */
  overlap: number;
  /** Amount the overflow tile overlaps the final visible avatar in px. */
  overflowOverlap: number;
  /** Measured total width in px of the `+N` overflow tile for `remaining` items. */
  measureOverflowText: (remaining: number) => number;
}

/**
 * Pure fit computation for an adaptive avatar stack: the largest visible count
 * (capped at `maxVisible`) whose avatars plus any `+N` overflow label fit in
 * `availableWidth`. Derived entirely from geometry constants so callers avoid
 * forced-layout reads.
 */
export function computeAdaptiveVisibleCount(options: AvatarStackFitOptions): number {
  const { itemCount, maxVisible, availableWidth, surface, overlap, overflowOverlap } = options;
  if (availableWidth <= 0) return 0;
  const step = surface - overlap;
  const cap = Math.min(itemCount, Math.max(0, maxVisible));
  const avatarsWidth = (count: number) => (count === 0 ? 0 : surface + (count - 1) * step);

  if (itemCount <= cap && avatarsWidth(itemCount) <= availableWidth) {
    return itemCount;
  }
  for (let count = cap; count >= 0; count -= 1) {
    const remaining = itemCount - count;
    const requiredWidth =
      avatarsWidth(count) +
      (remaining > 0
        ? options.measureOverflowText(remaining) - (count > 0 ? overflowOverlap : 0)
        : 0);
    if (requiredWidth <= availableWidth) {
      return count;
    }
  }
  return 0;
}

export interface DeferredWidthApplier {
  set(width: number): void;
  cancel(): void;
}

/**
 * Coalesces observed widths onto the next animation frame. ResizeObserver
 * callbacks run inside the delivering frame's rendering steps (after that
 * frame's rAF callbacks), so a rAF scheduled from one executes in the
 * following frame — consuming the width there (fit computation, overflow
 * text measurement, re-render) never extends the frame that delivered the
 * resize, e.g. the workspace-switch reveal frame.
 */
export function createDeferredWidthApplier(
  apply: (width: number) => void,
  schedule: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  unschedule: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): DeferredWidthApplier {
  let pendingWidth: number | undefined;
  let handle: number | undefined;
  return {
    set(width: number) {
      pendingWidth = width;
      if (handle !== undefined) return;
      let ran = false;
      const scheduled = schedule(() => {
        ran = true;
        handle = undefined;
        const latestWidth = pendingWidth as number;
        pendingWidth = undefined;
        apply(latestWidth);
      });
      // Guard against a synchronously-invoking scheduler: its callback already
      // cleared the pending state, so retaining the stale handle would wedge
      // the applier (rAF itself is always asynchronous).
      if (!ran) handle = scheduled;
    },
    cancel() {
      if (handle !== undefined) {
        unschedule(handle);
        handle = undefined;
      }
      pendingWidth = undefined;
    },
  };
}
