/**
 * Tracks which workspace columns intersect the columns scroller viewport
 * (plus horizontal overscan) via a single IntersectionObserver.
 *
 * Elements are tracked per stack container: a vertical stack is visible when
 * its container intersects, in which case every workspaceId in the stack
 * counts as visible. When IntersectionObserver is unavailable (SSR/tests),
 * every tracked column is reported visible.
 *
 * Observer callbacks fire asynchronously (next frame), so until the first
 * callback delivers real data `setElements` seeds the visible set with a
 * synchronous bounding-rect estimate against the root plus rootMargin —
 * otherwise every column would render a placeholder for the first frame(s).
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

/**
 * Resolves a rootMargin string into `[top, right, bottom, left]` pixel
 * offsets (CSS margin shorthand rules; percentages are relative to the root
 * rect's height for top/bottom and width for left/right).
 */
function parseRootMarginPx(
  rootMargin: string,
  rootRect: DOMRectReadOnly,
): [number, number, number, number] {
  const parts = rootMargin.trim().split(/\s+/).filter(Boolean);
  const [top = '0px', right = top, bottom = top, left = right] = parts;
  const resolve = (raw: string, basis: number): number => {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return 0;
    return raw.endsWith('%') ? (value / 100) * basis : value;
  };
  return [
    resolve(top, rootRect.height),
    resolve(right, rootRect.width),
    resolve(bottom, rootRect.height),
    resolve(left, rootRect.width),
  ];
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
  const rootMargin = options.rootMargin ?? DEFAULT_OVERSCAN_ROOT_MARGIN;
  let hasIntersectionData = false;

  // Pre-observer estimate: replace `intersecting` with the elements whose
  // bounding rects overlap the root expanded by rootMargin. Skipped when the
  // root has no layout yet (zero-size rect, e.g. jsdom) — the observer's
  // first callback is authoritative either way.
  const seedIntersectingFromLayout = (tracked: readonly TrackedColumnElement[]) => {
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width === 0 && rootRect.height === 0) return;
    const [top, right, bottom, left] = parseRootMarginPx(rootMargin, rootRect);
    intersecting.clear();
    for (const { element } of tracked) {
      const rect = element.getBoundingClientRect();
      if (
        rect.left <= rootRect.right + right &&
        rect.right >= rootRect.left - left &&
        rect.top <= rootRect.bottom + bottom &&
        rect.bottom >= rootRect.top - top
      ) {
        intersecting.add(element);
      }
    }
  };

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
      hasIntersectionData = true;
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      emit(computeVisible());
    },
    { root, rootMargin, threshold: 0 },
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
      if (!hasIntersectionData) seedIntersectingFromLayout(tracked);
      emit(computeVisible());
    },
    destroy() {
      observer.disconnect();
      intersecting.clear();
      idsByElement.clear();
    },
  };
}
