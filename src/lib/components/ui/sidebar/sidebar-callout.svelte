<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'banner',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    variant?: 'banner' | 'inline';
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="sidebar-callout"
  data-sidebar="callout"
  data-variant={variant}
  class={cn(
    'text-foreground',
    variant === 'banner'
      ? 'bg-surface-2 shadow-surface-2 flex flex-col gap-2 rounded-xl p-3'
      : 'bg-hover flex items-center gap-2 rounded-md px-2 py-1.5',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
