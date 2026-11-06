<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { createMenuLayout } from './menu-layout-context.svelte';

  let {
    children,
    class: className,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
  createMenuLayout(() => false);
</script>

<div
  data-slot="menu-footer"
  class={cn(
    'menu-footer type-caption relative z-10 -mx-1.5 -mb-1.5 mt-1.5 border-t border-border bg-muted/20 px-3.5 py-1.5 leading-(--text-caption-line-height) font-normal text-muted-foreground [&_[data-menu-item]]:hover:bg-hover [&_[data-menu-item]]:focus-visible:bg-hover',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>

<style>
  .menu-footer {
    font-size: calc(var(--text-caption-size) - 0.125rem);
  }

  .menu-footer :global([data-menu-item]) {
    font: inherit;
    color: inherit;
  }
</style>
