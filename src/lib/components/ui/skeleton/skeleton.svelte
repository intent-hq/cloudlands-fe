<script lang="ts">
  import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="skeleton"
  class={cn('skeleton-shimmer rounded-(--radius-small) bg-(--skeleton)', className)}
  {...restProps}
></div>

<style>
  .skeleton-shimmer {
    --skeleton: color-mix(in srgb, hsl(var(--muted)) 75%, hsl(var(--background)));
    background-image: linear-gradient(
      90deg,
      transparent 25%,
      color-mix(in oklab, hsl(var(--background)) 40%, transparent) 50%,
      transparent 75%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer calc(var(--spring-moderate) * 10) linear infinite;
  }

  @keyframes skeleton-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @container style(--motion-reduced: 1) {
    .skeleton-shimmer {
      animation: none;
      background-image: none;
    }
  }
</style>
