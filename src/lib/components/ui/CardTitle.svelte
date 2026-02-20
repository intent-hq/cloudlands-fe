<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLHeadingElement> {
    class?: string;
    tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    children?: Snippet;
  }

  let { class: className = '', tag = 'h3', children, ...restProps }: Props = $props();
</script>

{#if tag === 'h1'}
  <h1 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h1>
{:else if tag === 'h2'}
  <h2 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h2>
{:else if tag === 'h3'}
  <h3 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h3>
{:else if tag === 'h4'}
  <h4 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h4>
{:else if tag === 'h5'}
  <h5 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h5>
{:else if tag === 'h6'}
  <h6 class={cn('font-semibold leading-none tracking-tight', className)} {...restProps}>
    {@render children?.()}
  </h6>
{/if}
