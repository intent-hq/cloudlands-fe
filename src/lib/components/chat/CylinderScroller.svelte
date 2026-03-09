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
  let isFollowingBottom = $state(true);
  let isUserScrolling = $state(false);
  let isScrolledFromTop = $state(false);
  let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

  const BOTTOM_THRESHOLD = 5;

  function checkIfAtBottom(): boolean {
    if (!scrollContainer) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    return scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD;
  }

  function scrollToBottom() {
    if (!scrollContainer || !isFollowingBottom || isUserScrolling) return;
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

  let touchStartY = 0;
  function handleTouchStart(e: TouchEvent) { touchStartY = e.touches[0]?.clientY ?? 0; }
  function handleTouchMove(e: TouchEvent) {
    const touchY = e.touches[0]?.clientY ?? 0;
    if (touchStartY - touchY < 0) isFollowingBottom = false;
  }
  function handleTouchEnd() {
    requestAnimationFrame(() => { if (checkIfAtBottom()) isFollowingBottom = true; });
  }

  function handleScroll() {
    isUserScrolling = true;
    if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
    scrollEndTimeout = setTimeout(() => { isUserScrolling = false; }, 150);

    // Track if scrolled from top for gradient visibility
    if (scrollContainer) {
      isScrolledFromTop = scrollContainer.scrollTop > 2;
    }
  }

  let mutationObs: MutationObserver | null = null;

  onMount(() => {
    if (scrollContainer) {
      mutationObs = new MutationObserver((mutations) => {
        // Only scroll for new nodes, not text changes on existing nodes
        const hasNewNodes = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
        if (hasNewNodes) {
          scrollToBottom();
        }
      });
      mutationObs.observe(scrollContainer, { childList: true, subtree: true });
      scrollToBottom();
    }
    return () => {
      mutationObs?.disconnect();
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

<div
  class="cylinder-scroller"
  style={containerStyle}
  bind:this={scrollContainer}
  onscroll={handleScroll}
  onwheel={handleWheel}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
>
  {@render children()}
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
