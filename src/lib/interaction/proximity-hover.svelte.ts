import type { Action } from 'svelte/action';

/** Layout geometry relative to the proximity container's padding box. */
export interface ItemRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Pointer coordinates in the same local coordinate space as {@link ItemRect}. */
export interface PointerPosition {
  x: number;
  y: number;
}

export type ProximityAxis = 'x' | 'y' | 'xy';

export interface ProximityHoverOptions {
  /** Axis used to resolve the nearest item. Defaults to vertical lists. */
  axis?: ProximityAxis;
}

export interface ProximityHover {
  readonly activeIndex: number | null;
  readonly itemRects: readonly (ItemRect | undefined)[];
  readonly pointerPosition: PointerPosition | null;
  /** Increments on pointer entry so visual consumers can start a fresh layout session. */
  readonly sessionId: number;
  /** Re-measures all registered items synchronously. */
  measure(): void;
  /** Overrides the pointer-derived index for keyboard navigation. */
  setActiveIndex(index: number | null): void;
  /** Registers an item at its ordered list index. */
  registerItem(index: number, element: HTMLElement | null): void;
  /** Removes listeners and observers owned by this helper. */
  destroy(): void;
}

export interface ProximityItemOptions {
  hover: ProximityHover;
  index: number;
}

function distanceToInterval(position: number, start: number, size: number): number {
  const end = start + size;
  if (position < start) return start - position;
  if (position > end) return position - end;
  return 0;
}

/** Returns the nearest measured item, including when the pointer is in a gap or padding. */
export function nearestItemIndex(
  pointer: PointerPosition,
  itemRects: readonly (ItemRect | undefined)[],
  axis: ProximityAxis = 'y',
): number | null {
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < itemRects.length; index += 1) {
    const rect = itemRects[index];
    if (!rect) continue;
    const dx = distanceToInterval(pointer.x, rect.left, rect.width);
    const dy = distanceToInterval(pointer.y, rect.top, rect.height);
    const distance = axis === 'x' ? dx : axis === 'y' ? dy : Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Creates ephemeral pointer-proximity state for one list container.
 * Registered items are measured independently of feature or application state.
 */
export function createProximityHover(
  container: HTMLElement,
  options: ProximityHoverOptions = {},
): ProximityHover {
  const axis = options.axis ?? 'y';
  const items = new Map<number, HTMLElement>();
  let activeIndex = $state<number | null>(null);
  let itemRects = $state<(ItemRect | undefined)[]>([]);
  let pointerPosition = $state<PointerPosition | null>(null);
  let sessionId = $state(0);
  let frame: number | undefined;

  const updateActiveFromPointer = () => {
    if (pointerPosition) activeIndex = nearestItemIndex(pointerPosition, itemRects, axis);
  };

  const measure = () => {
    const containerRect = container.getBoundingClientRect();
    const next: (ItemRect | undefined)[] = [];
    for (const [index, element] of items) {
      const rect = element.getBoundingClientRect();
      next[index] = {
        top: rect.top - containerRect.top - container.clientTop + container.scrollTop,
        left: rect.left - containerRect.left - container.clientLeft + container.scrollLeft,
        width: rect.width,
        height: rect.height,
      };
    }
    itemRects = next;
    updateActiveFromPointer();
  };

  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          measure();
        });
  observer?.observe(container);

  const handlePointerEnter = () => {
    sessionId += 1;
  };
  const handlePointerMove = (event: PointerEvent) => {
    const containerRect = container.getBoundingClientRect();
    pointerPosition = {
      x: event.clientX - containerRect.left - container.clientLeft + container.scrollLeft,
      y: event.clientY - containerRect.top - container.clientTop + container.scrollTop,
    };
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      updateActiveFromPointer();
    });
  };
  const handlePointerLeave = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pointerPosition = null;
    activeIndex = null;
  };

  container.addEventListener('pointerenter', handlePointerEnter);
  container.addEventListener('pointermove', handlePointerMove);
  container.addEventListener('pointerleave', handlePointerLeave);

  return {
    get activeIndex() {
      return activeIndex;
    },
    get itemRects() {
      return itemRects;
    },
    get pointerPosition() {
      return pointerPosition;
    },
    get sessionId() {
      return sessionId;
    },
    measure,
    setActiveIndex(index) {
      activeIndex = index;
    },
    registerItem(index, element) {
      const previous = items.get(index);
      if (previous) observer?.unobserve?.(previous);
      if (element) {
        items.set(index, element);
        observer?.observe(element);
      } else {
        items.delete(index);
      }
      measure();
    },
    destroy() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      container.removeEventListener('pointerenter', handlePointerEnter);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
    },
  };
}

/** Svelte action that registers an ordered item with a proximity helper. */
export const proximityItem: Action<HTMLElement, ProximityItemOptions> = (node, options) => {
  let current = options;
  current.hover.registerItem(current.index, node);

  return {
    update(next) {
      if (next.hover !== current.hover || next.index !== current.index) {
        current.hover.registerItem(current.index, null);
        next.hover.registerItem(next.index, node);
      }
      current = next;
    },
    destroy() {
      current.hover.registerItem(current.index, null);
    },
  };
};
