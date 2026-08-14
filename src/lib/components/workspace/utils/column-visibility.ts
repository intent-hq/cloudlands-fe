/**
 * Tracks which workspace columns intersect the columns scroller viewport
 * (plus horizontal overscan) via a single IntersectionObserver.
 *
 * Elements are tracked per stack container: a vertical stack is visible when
 * its container intersects, in which case every workspaceId in the stack
 * counts as visible. When IntersectionObserver is unavailable (SSR/tests),
 * every tracked column is reported visible.
 */

export interface TrackedColumnElement {
  element: Element;
  workspaceIds: readonly string[];
}

export interface ColumnVisibilityTracker {
  /** Replace the tracked set of stack elements; diffs observation internally. */
  setElements(tracked: readonly TrackedColumnElement[]): void;
  destroy(): void;
}

/** ~1 viewport-width overscan on each horizontal side (relative to the root). */
const DEFAULT_OVERSCAN_ROOT_MARGIN = '0px 100% 0px 100%';

function visibilityKey(visible: ReadonlySet<string>): string {
  return [...visible].sort().join(',');
}

export function createColumnVisibilityTracker(
  root: Element,
  onChange: (visibleWorkspaceIds: ReadonlySet<string>) => void,
  options: { rootMargin?: string } = {},
): ColumnVisibilityTracker {
  const idsByElement = new Map<Element, readonly string[]>();
  let lastEmittedKey = '';

  const emit = (visible: Set<string>) => {
    const key = visibilityKey(visible);
    if (key === lastEmittedKey) return;
    lastEmittedKey = key;
    onChange(visible);
  };

  if (typeof IntersectionObserver === 'undefined') {
    return {
      setElements(tracked) {
        idsByElement.clear();
        const visible = new Set<string>();
        for (const { element, workspaceIds } of tracked) {
          idsByElement.set(element, workspaceIds);
          for (const id of workspaceIds) visible.add(id);
        }
        emit(visible);
      },
      destroy() {
        idsByElement.clear();
      },
    };
  }

  const intersecting = new Set<Element>();

  const computeVisible = () => {
    const visible = new Set<string>();
    for (const element of intersecting) {
      const ids = idsByElement.get(element);
      if (!ids) continue;
      for (const id of ids) visible.add(id);
    }
    return visible;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      emit(computeVisible());
    },
    { root, rootMargin: options.rootMargin ?? DEFAULT_OVERSCAN_ROOT_MARGIN, threshold: 0 },
  );

  return {
    setElements(tracked) {
      const next = new Map<Element, readonly string[]>();
      for (const { element, workspaceIds } of tracked) next.set(element, workspaceIds);
      for (const element of idsByElement.keys()) {
        if (next.has(element)) continue;
        observer.unobserve(element);
        intersecting.delete(element);
      }
      for (const element of next.keys()) {
        if (!idsByElement.has(element)) observer.observe(element);
      }
      idsByElement.clear();
      for (const [element, ids] of next) idsByElement.set(element, ids);
      emit(computeVisible());
    },
    destroy() {
      observer.disconnect();
      intersecting.clear();
      idsByElement.clear();
    },
  };
}
