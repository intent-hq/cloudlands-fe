<script lang="ts">
  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('VirtualList');

  // Props
  interface Props {
    items?: any[];
    itemHeight?: number;
    containerHeight?: number;
    overscan?: number;
    getKey?: (item: any, index: number) => string | number;
    children?: any;
  }

  let {
    items = [],
    itemHeight = 50,
    containerHeight = 400,
    overscan = 3,
    getKey = (_, index) => index,
    children,
  }: Props = $props();

  // State
  let scrollTop = $state(0);
  let scrollEl: HTMLDivElement;
  let rafId: number;

  // Computed values - use defensive checks to handle undefined items during reactive updates
  const safeItems = $derived(Array.isArray(items) ? items : []);
  const visibleCount = $derived(Math.ceil(containerHeight / itemHeight));
  const totalHeight = $derived(safeItems.length * itemHeight);
  const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
  const endIndex = $derived(Math.min(safeItems.length, startIndex + visibleCount + overscan * 2));
  const visibleItems = $derived(safeItems.slice(startIndex, endIndex));
  const offsetY = $derived(startIndex * itemHeight);

  // Handle scroll with RAF for better performance
  function handleScroll(event: Event) {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      const target = event.target as HTMLDivElement;
      scrollTop = target.scrollTop;
    });
  }

  // Scroll to specific index

  onMount(() => {
    logger.debug('VirtualList mounted', {
      itemCount: safeItems.length,
      itemHeight,
      containerHeight,
      visibleCount,
    });
  });

  onDestroy(() => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  });
</script>

<div class="relative overflow-hidden" style="height: {containerHeight}px;">
  <div
    bind:this={scrollEl}
    class="virtual-list-scroll h-full overflow-y-auto overflow-x-hidden"
    onscroll={handleScroll}
  >
    <!-- Total height spacer -->
    <div class="relative" style="height: {totalHeight}px;">
      <!-- Visible items container -->
      <div class="absolute top-0 left-0 right-0" style="transform: translateY({offsetY}px);">
        {#each visibleItems as item, i (getKey(item, startIndex + i))}
          <div
            class="flex items-center box-border"
            style="height: {itemHeight}px;"
            data-index={startIndex + i}
          >
            {#if children}
              {@render children({ item, index: startIndex + i })}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<!-- Scrollbar styles are defined globally in app.css -->
