<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { portal } from '$lib/actions/portal';

  interface Props {
    targetPosition: { x: number; y: number };
    isExpanded?: boolean;
    children?: any;
  }

  let { targetPosition, isExpanded = false, children }: Props = $props();

  let portalElement: HTMLDivElement | null = $state(null);
  let adjustedPosition = $state({ x: 0, y: 0 });

  // Calculate position that keeps comment within viewport
  function calculatePosition() {
    if (!portalElement) return;

    const rect = portalElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let x = targetPosition.x;
    let y = targetPosition.y;

    // Adjust vertical position
    if (isExpanded) {
      // For expanded comments, ensure they don't go above viewport
      const expandedHeight = Math.min(rect.height, viewportHeight * 0.7); // max 70vh
      const halfHeight = expandedHeight / 2;

      // Check if centering would go above viewport
      if (y - halfHeight < 20) {
        // 20px padding from top
        y = halfHeight + 20;
      }
      // Check if it would go below viewport
      else if (y + halfHeight > viewportHeight - 20) {
        y = viewportHeight - halfHeight - 20;
      }
    } else {
      // For collapsed comments, just ensure they're visible
      const collapsedHeight = rect.height;
      const halfHeight = collapsedHeight / 2;

      if (y - halfHeight < 10) {
        y = halfHeight + 10;
      } else if (y + halfHeight > viewportHeight - 10) {
        y = viewportHeight - halfHeight - 10;
      }
    }

    // Adjust horizontal position (keep comments from going off right edge)
    const commentWidth = isExpanded ? 380 : 320; // max-w-[380px] when expanded
    if (x + commentWidth > viewportWidth - 20) {
      x = viewportWidth - commentWidth - 20;
    }

    adjustedPosition = { x, y };
  }

  $effect(() => {
    // Recalculate when position or expanded state changes
    targetPosition;
    isExpanded;
    calculatePosition();
  });

  onMount(() => {
    window.addEventListener('resize', calculatePosition);
    window.addEventListener('scroll', calculatePosition);
  });

  onDestroy(() => {
    window.removeEventListener('resize', calculatePosition);
    window.removeEventListener('scroll', calculatePosition);
  });
</script>

<div
  bind:this={portalElement}
  use:portal={'body'}
  class="fixed pointer-events-auto transition-all duration-200"
  style="
    top: {adjustedPosition.y}px;
    left: {adjustedPosition.x}px;
    transform: translate(-50%, -50%);
    z-index: 30;
  "
>
  {@render children?.()}
</div>
