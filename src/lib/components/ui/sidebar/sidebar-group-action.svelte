<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import {
    getSidebarGroupActionsContext,
    getSidebarGroupContext,
  } from './sidebar-group-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    child,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes> & {
    child?: Snippet<[{ props: Record<string, unknown> }]>;
  } = $props();
  const group = getSidebarGroupContext();
  const clustered = getSidebarGroupActionsContext();

  $effect(() => untrack(() => group?.registerAction()));

  const mergedProps = $derived({
    class: cn(
      clustered
        ? 'relative flex size-6 items-center justify-center'
        : 'absolute right-3.5 top-3 flex size-6 items-center justify-center',
      'text-muted-foreground rounded-md p-0 hover:bg-hover hover:text-foreground transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none focus-visible:outline focus-visible:-outline-offset-1 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:transition-[stroke-width] [&>svg]:duration-spring-fast',
      // Increases the hit area of the button on mobile.
      'after:absolute after:-inset-2 md:after:hidden',
      'group-data-[collapsible=icon]:hidden',
      className,
    ),
    'data-slot': 'sidebar-group-action',
    'data-sidebar': 'group-action',
    ...restProps,
  });
</script>

{#if child}
  {@render child({ props: mergedProps })}
{:else}
  <button bind:this={ref} {...mergedProps}>
    {@render children?.()}
  </button>
{/if}

<style>
  :global([data-sidebar='group-action'] > svg) {
    stroke-width: 1.5;
  }

  :global([data-sidebar='group-action']:hover > svg) {
    stroke-width: 2;
  }
</style>
