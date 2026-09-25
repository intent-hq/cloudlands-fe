<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn('dialog-actions mt-6 flex min-w-0 flex-wrap items-center justify-end gap-2', className)}
  {...restProps}
>
  {@render children?.()}
</div>

<style>
  .dialog-actions :global(button) {
    min-width: 0;
    max-width: 100%;
    min-height: var(--control-height-medium);
    height: auto;
    padding-block: var(--space-1);
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .dialog-actions :global([data-slot='button-label']) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
</style>
