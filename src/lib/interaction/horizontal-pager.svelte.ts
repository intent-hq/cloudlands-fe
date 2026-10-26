import { scheduleLayoutRead, type CancelLayoutTask } from '$lib/utils/layout-phases';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';

/** Horizontal extent of one item in its scroll container's content coordinates. */
interface PagerItemBounds {
  start: number;
  end: number;
}

interface PagerViewport {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

type PagerDirection = -1 | 1;

interface HorizontalPagerOptions {
  /** Selects the paged items inside the scroll container, in visual order. */
  itemSelector: string;
}

interface HorizontalPager {
  /** Some item is cut off at either edge. */
  readonly overflowing: boolean;
  readonly canScrollBack: boolean;
  readonly canScrollForward: boolean;
  /** Svelte attachment for the horizontal scroll container. */
  attach(node: HTMLElement): () => void;
  /** Scrolls one page toward `direction`. */
  page(direction: PagerDirection): void;
}

// Absorbs subpixel scroll offsets under fractional zoom.
const TOLERANCE_PX = 1;

/**
 * Scroll offset one page away from `viewport.scrollLeft`. Forward brings the
 * first item cut off at the end to the leading inset (the first item's resting
 * offset); back reveals the last item cut off at the start, again starting the
 * page on an item. A step that would stop less than one item short of either
 * end goes all the way, so the last page lands flush with the trailing inset.
 */
function pagerScrollTarget(
  viewport: PagerViewport,
  items: readonly PagerItemBounds[],
  direction: PagerDirection,
): number {
  const { scrollLeft, clientWidth } = viewport;
  const max = Math.max(0, viewport.scrollWidth - clientWidth);
  const inset = items[0]?.start ?? 0;
  // Fallback step for items wider than the viewport.
  const page = Math.max(clientWidth - 2 * inset, clientWidth / 2);
  const narrowest = items.reduce(
    (width, { start, end }) => Math.min(width, end - start),
    Number.POSITIVE_INFINITY,
  );
  let target: number;
  if (direction === 1) {
    const cut = items.find(({ end }) => end > scrollLeft + clientWidth + TOLERANCE_PX);
    target = cut ? cut.start - inset : max;
    if (target <= scrollLeft + TOLERANCE_PX) target = scrollLeft + page;
    if (max - target < narrowest) target = max;
  } else {
    const cut = items.findLast(({ start }) => start < scrollLeft - TOLERANCE_PX);
    const first =
      cut && items.find(({ start }) => start - inset >= cut.end - clientWidth - TOLERANCE_PX);
    target = cut ? (first ? first.start - inset : scrollLeft - page) : 0;
    if (target >= scrollLeft - TOLERANCE_PX) target = scrollLeft - page;
    if (target < narrowest) target = 0;
  }
  return Math.min(Math.max(target, 0), max);
}

/** Layout offset from the container's content start; ignores transforms such as FLIP. */
function contentOffset(item: HTMLElement, container: HTMLElement): number {
  let offset = 0;
  let node: Element | null = item;
  while (node instanceof HTMLElement && node !== container) {
    offset += node.offsetLeft;
    node = node.offsetParent;
  }
  if (node === container) return offset;
  return (
    item.getBoundingClientRect().left -
    container.getBoundingClientRect().left -
    container.clientLeft +
    container.scrollLeft
  );
}

/**
 * Previous/next paging for a horizontal strip. Must be created during
 * component init; attach it to the scroll container with `{@attach}`.
 */
export function createHorizontalPager({ itemSelector }: HorizontalPagerOptions): HorizontalPager {
  let canScrollBack = $state(false);
  let canScrollForward = $state(false);
  let scroller: HTMLElement | null = null;
  // Destination of an in-flight smooth scroll, so repeated presses keep paging.
  let pendingTarget: number | null = null;

  const measureItems = (container: HTMLElement): PagerItemBounds[] =>
    Array.from(container.querySelectorAll<HTMLElement>(itemSelector), (item) => {
      const start = contentOffset(item, container);
      return { start, end: start + item.offsetWidth };
    });

  const measure = () => {
    if (!scroller) return;
    const { scrollLeft, clientWidth } = scroller;
    const items = measureItems(scroller);
    canScrollBack = items.some(({ start }) => start < scrollLeft - TOLERANCE_PX);
    canScrollForward = items.some(({ end }) => end > scrollLeft + clientWidth + TOLERANCE_PX);
  };

  return {
    get overflowing() {
      return canScrollBack || canScrollForward;
    },
    get canScrollBack() {
      return canScrollBack;
    },
    get canScrollForward() {
      return canScrollForward;
    },
    attach(node) {
      scroller = node;
      let readPending = false;
      let cancelRead: CancelLayoutTask | undefined;
      // The pending flag (not the cancel handle) gates re-scheduling: a
      // synchronously-invoking rAF stub runs the task before assignment lands.
      const scheduleMeasure = () => {
        if (readPending) return;
        readPending = true;
        cancelRead = scheduleLayoutRead(() => {
          readPending = false;
          measure();
        });
      };
      const settle = () => {
        pendingTarget = null;
      };
      const resizeObserver =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);
      resizeObserver?.observe(node);
      for (const child of node.children) resizeObserver?.observe(child);
      const mutationObserver = new MutationObserver(scheduleMeasure);
      mutationObserver.observe(node, { childList: true, subtree: true });
      node.addEventListener('scroll', scheduleMeasure, { passive: true });
      node.addEventListener('scrollend', settle);
      scheduleMeasure();

      return () => {
        node.removeEventListener('scroll', scheduleMeasure);
        node.removeEventListener('scrollend', settle);
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        cancelRead?.();
        if (scroller !== node) return;
        scroller = null;
        pendingTarget = null;
        canScrollBack = false;
        canScrollForward = false;
      };
    },
    page(direction) {
      if (!scroller) return;
      const scrollLeft = pendingTarget ?? scroller.scrollLeft;
      const target = pagerScrollTarget(
        { scrollLeft, clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth },
        measureItems(scroller),
        direction,
      );
      if (Math.abs(target - scroller.scrollLeft) < TOLERANCE_PX) return;
      const instant = prefersReducedMotion();
      pendingTarget = instant ? null : target;
      scroller.scrollTo({ left: target, behavior: instant ? 'instant' : 'smooth' });
    },
  };
}
