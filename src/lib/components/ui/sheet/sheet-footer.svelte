<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="sheet-footer"
  class={cn(
    'mt-auto flex flex-col gap-2 border-t border-border bg-popover px-4 py-3 sm:flex-row sm:items-center sm:justify-end',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
