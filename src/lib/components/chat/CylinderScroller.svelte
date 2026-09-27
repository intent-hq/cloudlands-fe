<!--
  CylinderScroller.svelte
  A max-height scrollable container with a top gradient fade.
  Auto-scrolls to bottom during streaming.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  interface Props {
    maxHeight?: number;
    isActive?: boolean;
    constrained?: boolean;
    fadeTop?: number;
    children: Snippet;
  }

  let {
    maxHeight = 100,
    isActive = true,
    constrained = true,
    fadeTop = 24,
    children,
  }: Props = $props();

  let scrollContainer: HTMLElement | undefined = $state();
  let scrollContent: HTMLElement | undefined = $state();
  let isFollowingBottom = $state(true);
  let isUserScrolling = $state(false);
  let isScrolledFromTop = $state(false);
  let followPending = false;
  let lastScrollTop = 0;
  let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

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
    // Update scroll state
    isScrolledFromTop = scrollContainer.scrollTop > 2;
  }

  function handleWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
      isFollowingBottom = false;
    } else if (e.deltaY > 0) {
      requestAnimationFrame(() => {
        if (checkIfAtBottom()) isFollowingBottom = true;
      });
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Child controls own their navigation keys; only the focused drum scrolls here.
    if (e.defaultPrevented || e.target !== scrollContainer) return;
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) {
      isFollowingBottom = false;
    }
  }

  let touchStartY = 0;
  function handleTouchStart(e: TouchEvent) {
    touchStartY = e.touches[0]?.clientY ?? 0;
  }
  function handleTouchMove(e: TouchEvent) {
    const touchY = e.touches[0]?.clientY ?? 0;
    if (touchStartY - touchY < 0) isFollowingBottom = false;
  }
  function handleTouchEnd() {
    requestAnimationFrame(() => {
      if (checkIfAtBottom()) isFollowingBottom = true;
    });
  }

  function handleScroll() {
    isUserScrolling = true;
    if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
    scrollEndTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (followPending) scrollToBottom();
    }, 150);

    if (scrollContainer) {
      const { scrollTop } = scrollContainer;
      // The first upward keyboard frame may still be within the bottom threshold.
      // Resume only when the reader moves down to the bottom again.
      if (scrollTop > lastScrollTop && checkIfAtBottom()) isFollowingBottom = true;
      lastScrollTop = scrollTop;
      isScrolledFromTop = scrollTop > 2;
    }
  }

  onMount(() => {
    // The viewport stops growing at max-height. Observe the content as well so
    // wrapped text, tool content and panel reflow still follow the newest line.
    let observer: ResizeObserver | undefined;
    if (scrollContainer && scrollContent && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scrollToBottom);
      observer.observe(scrollContent);
      observer.observe(scrollContainer);
    }
    scrollToBottom();
    return () => {
      observer?.disconnect();
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
    };
  });

  // When isActive, keep following bottom
  $effect(() => {
    if (isActive) {
      isFollowingBottom = true;
    }
  });

  // When collapsing back to constrained, snap to bottom
  $effect(() => {
    if (constrained && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          // Temporarily disable smooth scroll for instant snap
          scrollContainer.style.scrollBehavior = 'auto';
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          isFollowingBottom = true;
          // Re-enable smooth scroll
          requestAnimationFrame(() => {
            if (scrollContainer) {
              scrollContainer.style.scrollBehavior = '';
            }
          });
        }
      });
    }
  });

  // Simple container style
  let containerStyle = $derived.by(() => {
    if (!constrained) {
      // Unconstrained: no max-height, no mask
      return '';
    }
    let style = `max-height: min(var(--cylinder-max-height, ${maxHeight}px), 40vh);`;
    if (isScrolledFromTop) {
      const ft = `var(--cylinder-top-fade, ${fadeTop}px)`;
      style += ` mask-image: linear-gradient(to bottom, transparent 0%, black ${ft}, black 100%);`;
    }
    return style;
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (the constrained scroll region needs focus and native scroll keys) -->
<div
  role="group"
  tabindex={constrained ? 0 : undefined}
  class="cylinder-scroller"
  style={containerStyle}
  bind:this={scrollContainer}
  onscroll={handleScroll}
  onwheel={handleWheel}
  onkeydown={handleKeyDown}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
>
  <div class="flow-root" bind:this={scrollContent}>
    {@render children()}
  </div>
</div>

<style>
  .cylinder-scroller {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    position: relative;
    scroll-behavior: smooth;
  }

  .cylinder-scroller::-webkit-scrollbar {
    display: none;
  }
</style>
