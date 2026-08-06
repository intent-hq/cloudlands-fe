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
 * Key insight: We ONLY change isAtBottom based on user INPUT events (wheel, touch, keyboard),
 * NOT based on scroll events. This prevents browser/programmatic scrolls from changing state.
 */

export interface FollowBottomOptions {
  /** Whether to follow (auto-scroll) - reactive */
  follow: boolean;
  /** Threshold in pixels from bottom to consider "at bottom" (default: 100) */
  threshold?: number;
  /** Callback when follow state changes due to user interaction */
  onFollowChange?: (follow: boolean) => void;
}

/**
 * Svelte action that follows the bottom of a scrollable container.
 *
 * The consumer owns the follow policy: mutation/resize observers only
 * auto-scroll to bottom when `follow` is true, and `update()` never initiates
 * a scroll on its own. Callers that want to snap to bottom must do so
 * explicitly (see `scrollToBottom` below) in addition to flipping `follow`.
 */
export function followBottom(container: HTMLElement, options: FollowBottomOptions) {
  let isAtBottom = options.follow;
  let onFollowChange = options.onFollowChange;
  const threshold = options.threshold ?? 100;

  // Track if we're in the middle of a USER scroll (not programmatic)
  // This prevents auto-scroll from fighting with user scrolls
  let isUserScrolling = false;
  let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track if we're doing a programmatic scroll
  let isProgrammaticScroll = false;

  let mutationObserver: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function checkIfAtBottom(): boolean {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollTop + clientHeight >= scrollHeight - threshold;
  }

  function setIsAtBottom(value: boolean) {
    if (isAtBottom !== value) {
      isAtBottom = value;
      onFollowChange?.(value);
    }
  }

  // Called when DOM or size changes
  function scrollIfNeeded() {
    // Only auto-scroll if following and not actively user-scrolling
    // Note: We check isAtBottom (the "following" state), not the actual scroll position.
    // This is important because when content first becomes scrollable, the actual position
    // might not be at bottom, but we still want to scroll if we were following.
    if (isAtBottom && !isUserScrolling) {
      isProgrammaticScroll = true;
      requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
        // Reset flag after scroll completes
        requestAnimationFrame(() => {
          isProgrammaticScroll = false;
        });
      });
    }
  }

  // Handle wheel events - user is scrolling with mouse/trackpad
  function handleWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
      // User scrolling UP - stop following
      setIsAtBottom(false);
    } else if (e.deltaY > 0) {
      // User scrolling DOWN - check if at bottom after a short delay
      // (the scroll hasn't happened yet when wheel fires)
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) {
          setIsAtBottom(true);
        }
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
      // User dragging down (scrolling up) - stop following
      setIsAtBottom(false);
    }
    // For scrolling down, we'll check in touchend
  }

  function handleTouchEnd() {
    // Check if at bottom after touch scroll ends
    requestAnimationFrame(() => {
      if (checkIfAtBottom()) {
        setIsAtBottom(true);
      }
    });
  }

  // Handle keyboard events for scroll keys
  function handleKeyDown(e: KeyboardEvent) {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) {
      setIsAtBottom(false);
    } else if (['ArrowDown', 'PageDown', 'End'].includes(e.key)) {
      // Check if at bottom after keyboard scroll
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) {
          setIsAtBottom(true);
        }
      });
    }
  }

  // Handle scroll events - only track USER scrolls, not programmatic ones
  function handleScroll() {
    // Ignore programmatic scrolls
    if (isProgrammaticScroll) return;

    isUserScrolling = true;
    if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
    scrollEndTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 150);
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
      scrollIfNeeded();
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Watch for size changes
    resizeObserver = new ResizeObserver(scrollIfNeeded);
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

  // Initial setup
  setupObservers();
  if (isAtBottom) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'instant',
    });
  }

  return {
    update(newOptions: FollowBottomOptions) {
      onFollowChange = newOptions.onFollowChange;

      // Sync internal follow state with the consumer's intent. We intentionally
      // never initiate a scroll here — consumers that want to snap to bottom
      // must call `scrollToBottom(container)` explicitly. The observers below
      // will keep the viewport pinned to the bottom while `follow` is true as
      // new content streams in.
      //
      // Assign `isAtBottom` directly rather than through `setIsAtBottom` so this
      // consumer-driven change doesn't echo back via `onFollowChange`. That
      // callback is reserved for user-input pathways (wheel/touch/keyboard); if
      // we routed through it, toggling `follow` (e.g. when search opens) would
      // flip the consumer's own follow flag and leave auto-follow disabled when
      // the consumer next sets `follow: true`.
      if (newOptions.follow && !isAtBottom) {
        isUserScrolling = false;
        isAtBottom = true;
      } else if (!newOptions.follow && isAtBottom) {
        isAtBottom = false;
      }
    },

    destroy() {
      teardownObservers();
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('keydown', handleKeyDown);
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
    },
  };
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
