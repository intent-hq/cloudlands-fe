<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { Skeleton } from '$lib/components/ui/skeleton/index.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    showIcon = false,
    widthIndex = 0,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    showIcon?: boolean;
    widthIndex?: number;
  } = $props();

  const widths = ['62%', '74%', '55%', '82%', '68%'] as const;
  let width = $derived(widths[Math.abs(widthIndex) % widths.length]);
</script>

<div
  bind:this={ref}
  data-slot="sidebar-menu-skeleton"
  data-sidebar="menu-skeleton"
  class={cn('flex h-(--control-height-medium) items-center gap-2 px-2', className)}
  {...restProps}
>
  {#if showIcon}
    <Skeleton class="size-4 shrink-0 rounded-md" data-sidebar="menu-skeleton-icon" />
  {/if}
  <Skeleton
    class="max-w-(--skeleton-width) h-4 flex-1"
    data-sidebar="menu-skeleton-text"
    style="--skeleton-width: {width};"
  />
  {@render children?.()}
</div>
