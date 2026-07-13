/**
 * Virtual Scrolling for Large Lists
 *
 * Optimizes rendering of large lists by only rendering visible items
 * plus a buffer zone for smooth scrolling.
 */



export interface VirtualScrollOptions {
  /** Height of each item (must be fixed) */
  itemHeight: number;
  /** Number of items to render outside visible area */
  overscan?: number;
  /** Container height */
  containerHeight: number;
  /** Total number of items */
  totalItems: number;
  /** Scroll position */
  scrollTop?: number;
}

export interface VirtualScrollResult {
  /** Index of first visible item */
  startIndex: number;
  /** Index of last visible item */
  endIndex: number;
  /** Total height of all items */
  totalHeight: number;
  /** Offset for positioning visible items */
  offsetY: number;
  /** Items to render */
  visibleItems: number[];
}

/**
 * Calculate which items should be rendered based on scroll position
 */
export function calculateVirtualScroll(options: VirtualScrollOptions): VirtualScrollResult {
  const { itemHeight, overscan = 3, containerHeight, totalItems, scrollTop = 0 } = options;

  // Calculate visible range
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.ceil((scrollTop + containerHeight) / itemHeight);

  // Add overscan
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(totalItems - 1, visibleEnd + overscan);

  // Calculate total height for scrollbar
  const totalHeight = totalItems * itemHeight;

  // Calculate offset for positioning
  const offsetY = startIndex * itemHeight;

  // Generate array of visible item indices
  const visibleItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push(i);
  }

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    visibleItems,
  };
}

/**
 * Create a virtual scroll store for reactive updates
 */
export function createVirtualScrollStore(items: any[], itemHeight: number, overscan: number = 3) {
  let scrollTop = $state(0);
  let containerHeight = $state(400);

  const virtualScroll = $derived.by(() =>
    calculateVirtualScroll({
      itemHeight,
      overscan,
      containerHeight,
      totalItems: items.length,
      scrollTop,
    }),
  );

  const visibleItems = $derived.by(() =>
    virtualScroll.visibleItems.map((index) => ({
      index,
      item: items[index],
      style: `position: absolute; top: ${index * itemHeight}px; height: ${itemHeight}px; width: 100%;`,
    })),
  );

  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },

    get containerHeight() {
      return containerHeight;
    },
    set containerHeight(value: number) {
      containerHeight = value;
    },

    get virtualScroll() {
      return virtualScroll;
    },
    get visibleItems() {
      return visibleItems;
    },

    handleScroll(event: Event) {
      const target = event.target as HTMLElement;
      scrollTop = target.scrollTop;
    },

    handleResize(entries: ResizeObserverEntry[]) {
      const entry = entries[0];
      if (entry) {
        containerHeight = entry.contentRect.height;
      }
    },
  };
}

/**
 * Intersection observer for lazy loading as items come into view
 */
export function createLazyLoadObserver(
  onIntersect: (index: number) => void,
  options?: IntersectionObserverInit,
) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const index = parseInt(entry.target.getAttribute('data-index') || '0');
        onIntersect(index);
      }
    });
  }, options);

  return {
    observe(element: Element, index: number) {
      element.setAttribute('data-index', index.toString());
      observer.observe(element);
    },
    unobserve(element: Element) {
      observer.unobserve(element);
    },
    disconnect() {
      observer.disconnect();
    },
  };
}
