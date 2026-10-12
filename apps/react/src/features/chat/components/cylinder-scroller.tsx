// Source: src/lib/components/chat/CylinderScroller.svelte.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CYLINDER_SCROLL_SETTLE_MS } from '$lib/components/chat/response-group-timing';
import './cylinder-scroller.css';

export interface CylinderScrollerProps {
  maxHeight?: number;
  isActive?: boolean;
  constrained?: boolean;
  fadeTop?: number;
  /** React children replace the source's required zero-argument snippet. */
  children: ReactNode;
}

export function CylinderScroller({
  maxHeight = 100,
  isActive = true,
  constrained = true,
  fadeTop = 24,
  children,
}: CylinderScrollerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<{
    activate: () => void;
    constrain: () => void;
    handleWheel: (event: WheelEvent) => void;
    handleKeyDown: (event: KeyboardEvent) => void;
    handleTouchStart: (event: TouchEvent) => void;
    handleTouchMove: (event: TouchEvent) => void;
    handleTouchEnd: () => void;
  } | null>(null);
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false);

  useLayoutEffect(() => {
    let scrollContainer: HTMLDivElement | null = containerRef.current;
    const scrollContent = contentRef.current;
    if (!scrollContainer || !scrollContent) return;
    let isFollowingBottom = true;
    let isUserScrolling = false;
    let followPending = false;
    let keyboardScrollPending = false;
    let lastScrollTop = 0;
    let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
    let touchStartY = 0;
    const BOTTOM_THRESHOLD = 5;

    function checkIfAtBottom(): boolean {
      if (!scrollContainer) return true;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      return scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD;
    }

    function scrollToBottom() {
      if (!scrollContainer || !isFollowingBottom) {
        followPending = false;
        return;
      }
      if (isUserScrolling) {
        followPending = true;
        return;
      }
      followPending = false;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setIsScrolledFromTop(scrollContainer.scrollTop > 2);
    }

    function handleWheel(event: WheelEvent) {
      if (event.deltaY < 0) {
        isFollowingBottom = false;
      } else if (event.deltaY > 0) {
        requestAnimationFrame(() => {
          if (checkIfAtBottom()) isFollowingBottom = true;
        });
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey)
      ) {
        keyboardScrollPending = true;
        lastScrollTop = scrollContainer?.scrollTop ?? 0;
        markScrollActivity();
      }
    }

    function handleTouchStart(event: TouchEvent) {
      touchStartY = event.touches[0]?.clientY ?? 0;
    }
    function handleTouchMove(event: TouchEvent) {
      const touchY = event.touches[0]?.clientY ?? 0;
      if (touchStartY - touchY < 0) isFollowingBottom = false;
    }
    function handleTouchEnd() {
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) isFollowingBottom = true;
      });
    }

    function markScrollActivity() {
      isUserScrolling = true;
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      scrollEndTimeout = setTimeout(() => {
        isUserScrolling = false;
        keyboardScrollPending = false;
        if (followPending) scrollToBottom();
      }, CYLINDER_SCROLL_SETTLE_MS);
    }

    function handleScroll() {
      markScrollActivity();
      if (scrollContainer) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        if (
          keyboardScrollPending &&
          scrollTop < lastScrollTop &&
          scrollTop + clientHeight < scrollHeight
        ) {
          isFollowingBottom = false;
        }
        if (scrollTop > lastScrollTop && checkIfAtBottom()) isFollowingBottom = true;
        lastScrollTop = scrollTop;
        setIsScrolledFromTop(scrollTop > 2);
      }
    }

    controller.current = {
      handleWheel,
      handleKeyDown,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      activate() {
        isFollowingBottom = true;
      },
      constrain() {
        requestAnimationFrame(() => {
          if (scrollContainer) {
            scrollContainer.style.scrollBehavior = 'auto';
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            isFollowingBottom = true;
            requestAnimationFrame(() => {
              if (scrollContainer) scrollContainer.style.scrollBehavior = '';
            });
          }
        });
      },
    };

    const node = scrollContainer;
    node.addEventListener('scroll', handleScroll);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scrollToBottom);
      observer.observe(scrollContent);
      observer.observe(scrollContainer);
    }
    scrollToBottom();
    return () => {
      observer?.disconnect();
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      node.removeEventListener('scroll', handleScroll);
      controller.current = null;
      // Match bind:this clearing. Source rAF callbacks are deliberately not cancelled;
      // their node guards also make callbacks from a retired mount harmless.
      scrollContainer = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (isActive) controller.current?.activate();
  }, [isActive]);

  useLayoutEffect(() => {
    if (constrained) controller.current?.constrain();
    // Like the source, changing constrained does not cancel an already queued snap.
  }, [constrained]);

  const containerStyle: CSSProperties = constrained
    ? {
        maxHeight: `min(var(--cylinder-max-height, ${maxHeight}px), 40vh)`,
        ...(isScrolledFromTop
          ? {
              maskImage: `linear-gradient(to bottom, transparent 0%, black var(--cylinder-top-fade, ${fadeTop}px), black 100%)`,
            }
          : {}),
      }
    : {};

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The source scroll region handles native scroll keys.
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source scroll group, not a fieldset with different layout semantics.
      role="group"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The source constrained scroll region must receive native scroll keys.
      tabIndex={constrained ? 0 : undefined}
      className="cylinder-scroller intent-cylinder-scroller"
      style={containerStyle}
      ref={containerRef}
      // Match source delegation: child handlers run first, preserving stopPropagation
      // and defaultPrevented, and the controller receives the actual browser event.
      onWheel={(event) => controller.current?.handleWheel(event.nativeEvent)}
      onKeyDown={(event) => controller.current?.handleKeyDown(event.nativeEvent)}
      onTouchStart={(event) => controller.current?.handleTouchStart(event.nativeEvent)}
      onTouchMove={(event) => controller.current?.handleTouchMove(event.nativeEvent)}
      onTouchEnd={() => controller.current?.handleTouchEnd()}
    >
      <div className="flow-root" ref={contentRef}>
        {children}
      </div>
    </div>
  );
}

export default CylinderScroller;
