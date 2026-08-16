/**
 * Smart scroll behavior for chat interfaces.
 * Based on Vercel AI Chatbot's use-scroll-to-bottom hook.
 *
 * Key behaviors:
 * - Auto-scrolls to bottom when content/size changes (if following)
 * - Stops auto-scroll when user scrolls UP (wheel, touch, keyboard)
 * - Resumes when user scrolls DOWN to the bottom
 * - Uses RAF for smooth scrolling during streaming
 *
 * Follow policy changes only from consumer intent or user input. Layout and
 * programmatic scroll events report geometry but never detach or re-lock it.
 */

export interface FollowBottomOptions {
  /** Whether to follow (auto-scroll) - reactive */
  follow: boolean;
  /** Threshold in pixels from bottom to consider "at bottom" (default: 100) */
  threshold?: number;
  /** Callback when follow state changes due to user interaction */
  onFollowChange?: (follow: boolean) => void;
  /** Reports live geometry for controls outside the scroll container. */
  onScrollStateChange?: (state: FollowBottomState) => void;
}

export interface FollowBottomState {
  distanceFromBottom: number;
  isAtBottom: boolean;
  isFollowing: boolean;
}

interface BottomFollower {
  followAndScroll: () => void;
  isFollowing: () => boolean;
  beforeMutation: () => FollowBottomMutation;
}

export interface FollowBottomMutation {
  request: () => void;
  settle: () => void;
}

const inertFollowBottomMutation: FollowBottomMutation = {
  request() {},
  settle() {},
};

const bottomFollowers = new WeakMap<HTMLElement, BottomFollower>();
export const FOLLOW_BOTTOM_MAX_SETTLE_FRAMES = 32;
const FOLLOW_BOTTOM_STABLE_FRAMES = 2;

/**
 * Svelte action that follows the bottom of a scrollable container.
 *
 * The consumer owns the follow policy. Mutation and resize observers capture
 * that policy before they run and keep a followed viewport at the exact
 * maximum through a bounded settle. Enabling follow also snaps immediately.
 */
export function followBottom(container: HTMLElement, options: FollowBottomOptions) {
  let isFollowing = options.follow;
  let onFollowChange = options.onFollowChange;
  let onScrollStateChange = options.onScrollStateChange;
  let threshold = options.threshold ?? 100;
  let pointerScrolling = false;
  let pointerMaximum = 0;
  let pointerDistanceFromBottom = 0;
  let pointerMovedTowardBottom = false;

  let mutationObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let settleFrame: number | null = null;
  let settleFramesRemaining = 0;
  let stableFrames = 0;
  let previousMaximum: number | null = null;
  let activeMutationLocks = 0;

  function cancelSettle() {
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = null;
    settleFramesRemaining = 0;
    stableFrames = 0;
    previousMaximum = null;
  }

  function maximumScrollTop(): number {
    return Math.max(0, container.scrollHeight - container.clientHeight);
  }

  function setExactBottom(): number {
    const maximum = maximumScrollTop();
    if (container.scrollTop !== maximum) container.scrollTop = maximum;
    return maximum;
  }

  function checkIfAtBottom(): boolean {
    return maximumScrollTop() - container.scrollTop <= threshold;
  }

  function reportState() {
    const distance = Math.max(0, maximumScrollTop() - container.scrollTop);
    onScrollStateChange?.({
      distanceFromBottom: distance,
      isAtBottom: distance <= threshold,
      isFollowing,
    });
  }

  function setFollowing(value: boolean, notify = true) {
    if (isFollowing !== value) {
      isFollowing = value;
      if (notify) onFollowChange?.(value);
    }
    if (!value) cancelSettle();
    reportState();
  }

  function runSettleFrame() {
    settleFrame = null;
    if (!isFollowing) return;
    const maximum = setExactBottom();
    reportState();
    if (maximum === previousMaximum) stableFrames += 1;
    else stableFrames = 0;
    previousMaximum = maximum;
    settleFramesRemaining -= 1;
    if (
      settleFramesRemaining > 0 &&
      (activeMutationLocks > 0 || stableFrames < FOLLOW_BOTTOM_STABLE_FRAMES)
    ) {
      settleFrame = requestAnimationFrame(runSettleFrame);
    }
  }

  function scheduleBottomSettle(reset = false) {
    if (!isFollowing) return;
    if (reset || settleFramesRemaining === 0) {
      settleFramesRemaining = FOLLOW_BOTTOM_MAX_SETTLE_FRAMES;
      stableFrames = 0;
      previousMaximum = null;
    }
    if (settleFrame !== null) return;
    settleFrame = requestAnimationFrame(runSettleFrame);
  }

  function requestBottomSettle() {
    if (!isFollowing) return;
    setExactBottom();
    reportState();
    scheduleBottomSettle(true);
  }

  function handleLayoutChange() {
    if (isFollowing) {
      setExactBottom();
      scheduleBottomSettle();
    }
    reportState();
  }

  const follower: BottomFollower = {
    followAndScroll() {
      setFollowing(true);
      setExactBottom();
      reportState();
      scheduleBottomSettle();
    },
    isFollowing: () => isFollowing,
    beforeMutation() {
      if (!isFollowing) return inertFollowBottomMutation;
      activeMutationLocks += 1;
      requestBottomSettle();
      let active = true;
      return {
        request() {
          if (active) requestBottomSettle();
        },
        settle() {
          if (!active) return;
          active = false;
          activeMutationLocks = Math.max(0, activeMutationLocks - 1);
          requestBottomSettle();
        },
      };
    },
  };
  bottomFollowers.set(container, follower);

  // Handle wheel events - user is scrolling with mouse/trackpad
  function handleWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
      setFollowing(false);
    } else if (e.deltaY > 0) {
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) follower.followAndScroll();
        else reportState();
      });
    }
  }

  // Handle touch events - user is scrolling on touch device
  let touchStartY = 0;
  function handleTouchStart(e: TouchEvent) {
    touchStartY = e.touches[0]?.clientY ?? 0;
  }

  function handleTouchMove(e: TouchEvent) {
    const touchY = e.touches[0]?.clientY ?? 0;
    const deltaY = touchStartY - touchY; // positive = scrolling down, negative = scrolling up

    if (deltaY < 0) {
      setFollowing(false);
    }
    // For scrolling down, we'll check in touchend
  }

  function handleTouchEnd() {
    // Check if at bottom after touch scroll ends
    requestAnimationFrame(() => {
      if (checkIfAtBottom()) follower.followAndScroll();
      else reportState();
    });
  }

  // Handle keyboard events for scroll keys
  function handleKeyDown(e: KeyboardEvent) {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) {
      setFollowing(false);
    } else if (['ArrowDown', 'PageDown', 'End'].includes(e.key)) {
      // Check if at bottom after keyboard scroll
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) follower.followAndScroll();
        else reportState();
      });
    }
  }

  function isVerticalScrollbarPointer(e: PointerEvent): boolean {
    if (e.button !== 0 || e.target !== container) return false;
    const gutterWidth = Math.max(0, container.offsetWidth - container.clientWidth);
    if (gutterWidth === 0) return false;
    const rect = container.getBoundingClientRect();
    const visualGutterWidth =
      container.offsetWidth > 0 ? gutterWidth * (rect.width / container.offsetWidth) : gutterWidth;
    return getComputedStyle(container).direction === 'rtl'
      ? e.clientX <= rect.left + visualGutterWidth
      : e.clientX >= rect.right - visualGutterWidth;
  }

  function handleScroll() {
    if (!pointerScrolling) {
      reportState();
      return;
    }

    const nextMaximum = maximumScrollTop();
    const nextDistance = Math.max(0, nextMaximum - container.scrollTop);
    if (nextMaximum !== pointerMaximum) {
      pointerMaximum = nextMaximum;
      pointerDistanceFromBottom = nextDistance;
      pointerMovedTowardBottom = false;
      reportState();
      return;
    }

    const distanceDelta = nextDistance - pointerDistanceFromBottom;
    pointerDistanceFromBottom = nextDistance;
    if (distanceDelta > 0) {
      pointerMovedTowardBottom = false;
      setFollowing(false);
    } else if (distanceDelta < 0) {
      pointerMovedTowardBottom = true;
      if (checkIfAtBottom()) follower.followAndScroll();
      else reportState();
    } else reportState();
  }

  function handlePointerDown(e: PointerEvent) {
    pointerScrolling = isVerticalScrollbarPointer(e);
    pointerMaximum = maximumScrollTop();
    pointerDistanceFromBottom = Math.max(0, pointerMaximum - container.scrollTop);
    pointerMovedTowardBottom = false;
  }

  function handlePointerUp() {
    if (!pointerScrolling) return;
    pointerScrolling = false;
    if (pointerMovedTowardBottom && checkIfAtBottom()) follower.followAndScroll();
    else reportState();
  }

  function setupObservers() {
    if (mutationObserver) return;

    // Watch for DOM changes
    mutationObserver = new MutationObserver((mutations) => {
      // When new children are added, observe them for size changes too
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && resizeObserver) {
              resizeObserver.observe(node);
            }
          }
        }
      }
      handleLayoutChange();
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Watch for size changes
    resizeObserver = new ResizeObserver(handleLayoutChange);
    resizeObserver.observe(container);

    // Also observe children for size changes
    for (const child of container.children) {
      resizeObserver.observe(child);
    }
  }

  function teardownObservers() {
    mutationObserver?.disconnect();
    mutationObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  // Attach event listeners
  container.addEventListener('scroll', handleScroll, { passive: true });
  container.addEventListener('wheel', handleWheel, { passive: true });
  container.addEventListener('touchstart', handleTouchStart, { passive: true });
  container.addEventListener('touchmove', handleTouchMove, { passive: true });
  container.addEventListener('touchend', handleTouchEnd, { passive: true });
  container.addEventListener('keydown', handleKeyDown);
  container.addEventListener('pointerdown', handlePointerDown, { passive: true });
  window.addEventListener('pointerup', handlePointerUp, { passive: true });
  window.addEventListener('pointercancel', handlePointerUp, { passive: true });

  // Initial setup
  setupObservers();
  if (isFollowing) setExactBottom();
  reportState();

  return {
    update(newOptions: FollowBottomOptions) {
      onFollowChange = newOptions.onFollowChange;
      onScrollStateChange = newOptions.onScrollStateChange;
      threshold = newOptions.threshold ?? 100;

      // Consumer-driven changes do not echo through onFollowChange. That
      // callback is reserved for wheel, touch, keyboard, and scrollbar input.
      if (newOptions.follow && !isFollowing) {
        setFollowing(true, false);
        setExactBottom();
        reportState();
        scheduleBottomSettle();
      } else if (!newOptions.follow && isFollowing) setFollowing(false, false);
      else reportState();
    },

    destroy() {
      cancelSettle();
      if (bottomFollowers.get(container) === follower) bottomFollowers.delete(container);
      teardownObservers();
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    },
  };
}

export function isFollowingBottom(element: HTMLElement): boolean {
  return bottomFollowers.get(element)?.isFollowing() ?? false;
}

/**
 * Capture the nearest followed scroll container before descendant layout changes.
 * The returned lease asks that single authority to keep its bounded settle active.
 */
export function beforeFollowBottomMutation(element: HTMLElement): FollowBottomMutation {
  let current: HTMLElement | null = element;
  while (current) {
    const follower = bottomFollowers.get(current);
    if (follower) return follower.beforeMutation();
    current = current.parentElement;
  }
  return inertFollowBottomMutation;
}

/**
 * Distance from scroll bottom in pixels
 */
export function distanceFromBottom(element: HTMLElement): number {
  const { scrollTop, scrollHeight, clientHeight } = element;
  return scrollHeight - scrollTop - clientHeight;
}

/**
 * Check if scroll position is near the bottom
 */
export function isScrollNearBottom(element: HTMLElement, threshold = 100): boolean {
  return distanceFromBottom(element) <= threshold;
}

/**
 * Force scroll to bottom (for button clicks)
 */
export function scrollToBottom(element: HTMLElement, smooth = false): void {
  element.scrollTo({
    top: element.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

/**
 * Enable the active follow action and settle at the exact maximum scroll position.
 * Observer callbacks retain the lock while immediate nested content mounts or resizes.
 */
export function followToBottom(element: HTMLElement): void {
  const follower = bottomFollowers.get(element);
  if (follower) {
    follower.followAndScroll();
    return;
  }
  scrollToBottom(element);
}

/**
 * Animate `scrollTop` toward `targetScrollTop` with an easeOutCubic curve.
 *
 * `getContainer` is re-read on every frame; the animation stops cleanly (no
 * write, no further frame scheduled) as soon as it returns null/undefined —
 * e.g. when the container is unmounted mid-animation.
 */
export function animateScrollTo(
  getContainer: () => HTMLElement | null | undefined,
  targetScrollTop: number,
  duration = 150,
): void {
  const container = getContainer();
  if (!container) return;

  const startScrollTop = container.scrollTop;
  const distance = targetScrollTop - startScrollTop;
  const startTime = performance.now();

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function animate(currentTime: number) {
    const current = getContainer();
    if (!current) return;

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    current.scrollTop = startScrollTop + distance * easeOutCubic(progress);

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

/**
 * Scroll anchor - preserves scroll position relative to a visible element.
 * This prevents "scroll jump to top" when content changes above the viewport.
 *
 * Usage:
 * 1. Call captureScrollAnchor() before DOM changes
 * 2. DOM changes occur (e.g., messages array update)
 * 3. Call restoreScrollAnchor() after DOM settles (use requestAnimationFrame)
 *
 * The anchor works by finding the first visible element in the scroll container
 * and tracking its offset from the viewport top. After DOM changes, it scrolls
 * to maintain the same offset, preventing apparent "jumps".
 */
export interface ScrollAnchor {
  /** The anchored element (first visible in viewport) */
  element: Element | null;
  /** The element's offset from viewport top before changes */
  offsetFromViewport: number;
  /** Original scroll position (fallback) */
  scrollTop: number;
  /** Whether we're near the bottom (skip anchoring if true) */
  isNearBottom: boolean;
}

/**
 * Capture scroll anchor before DOM changes.
 * Finds the first visible element with data-message-id attribute
 * and records its position relative to the viewport.
 */
export function captureScrollAnchor(
  container: HTMLElement,
  selector = '[data-message-id], [data-lazy-turn-key]',
): ScrollAnchor {
  const scrollTop = container.scrollTop;
  const containerRect = container.getBoundingClientRect();
  const isNearBottom = isScrollNearBottom(container, 100);

  // Skip anchoring if near bottom - auto-scroll will handle it
  if (isNearBottom) {
    return { element: null, offsetFromViewport: 0, scrollTop, isNearBottom };
  }

  // Find first visible element with the selector
  const elements = container.querySelectorAll(selector);
  let anchorElement: Element | null = null;
  let offsetFromViewport = 0;

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    // Element is at least partially visible in the container
    if (rect.top >= containerRect.top && rect.top < containerRect.bottom) {
      anchorElement = el;
      offsetFromViewport = rect.top - containerRect.top;
      break;
    }
  }

  return { element: anchorElement, offsetFromViewport, scrollTop, isNearBottom };
}

/**
 * Restore scroll position based on anchor after DOM changes.
 * Should be called after DOM settles (e.g., in requestAnimationFrame).
 */
export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor): void {
  // Skip if we were near bottom - let auto-scroll handle it
  if (anchor.isNearBottom) {
    return;
  }

  // If we have an anchor element, restore position relative to it
  if (anchor.element && anchor.element.isConnected) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = anchor.element.getBoundingClientRect();
    const currentOffset = elementRect.top - containerRect.top;
    const offsetDifference = currentOffset - anchor.offsetFromViewport;

    if (Math.abs(offsetDifference) > 5) {
      // Threshold to avoid jitter
      container.scrollTop += offsetDifference;
    }
  }
}
