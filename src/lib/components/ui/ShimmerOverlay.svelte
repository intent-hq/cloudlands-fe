<script lang="ts">
  /**
   * ShimmerOverlay — A reusable shimmer effect for text content.
   *
   * Applies a scrolling gradient that shimmers across text using
   * background-clip: text. Wrap text content in this component
   * to give it a subtle animated shimmer.
   *
   * Usage:
   *   <ShimmerOverlay>Some text content</ShimmerOverlay>
   *
   * Or as an overlay on a container:
   *   <div class="relative overflow-hidden">
   *     <ShimmerOverlay />
   *     ...content...
   *   </div>
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** Animation duration in seconds. Default 8. */
    duration?: number;
    /** Custom CSS class on the wrapper. */
    class?: string;
    /** Content to apply shimmer to. If omitted, renders as an overlay. */
    children?: Snippet;
  }

  let { duration = 8, class: className = '', children }: Props = $props();
</script>

{#if children}
  <span class="shimmer-text {className}" style:animation-duration="{duration}s">
    {@render children()}
  </span>
{:else}
  <div
    class="absolute inset-0 overflow-hidden pointer-events-none z-20 shimmer-overlay {className}"
    style:animation-duration="{duration}s"
  ></div>
{/if}

<style>
  .shimmer-text {
    background: linear-gradient(
      90deg,
      var(--color-muted-foreground) 0%,
      var(--color-foreground) 20%,
      var(--color-muted-foreground) 40%,
      var(--color-foreground) 60%,
      var(--color-muted-foreground) 80%,
      var(--color-foreground) 100%
    );
    background-size: 400% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 8s linear infinite;
    transform: translateZ(0);
  }

  .shimmer-overlay {
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--color-background) 20%,
      transparent 40%,
      var(--color-background) 60%,
      transparent 80%,
      var(--color-background) 100%
    );
    background-size: 400% 100%;
    animation: shimmer 8s linear infinite;
    opacity: 0.6;
    transform: translateZ(0);
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
