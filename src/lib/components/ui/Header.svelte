<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    size?: 1 | 2 | 3 | 4 | 5 | 6;
    children?: Snippet;
    [key: string]: any;
  }

  let { class: className = '', size = 1, children, ...restProps }: Props = $props();

  const componentType = $derived(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'][size - 1]);

  // Enhanced size classes with proper typography
  const sizeClasses = $derived(
    {
      1: 'text-2xl font-semibold leading-tight tracking-tight antialiased',
      2: 'text-xl font-semibold leading-tight tracking-tight antialiased',
      3: 'text-xs uppercase tracking-wider font-medium text-muted-foreground antialiased',
      4: 'text-xs font-medium text-subtle antialiased',
      5: 'text-sm font-medium leading-normal antialiased',
      6: 'text-[0.66rem] uppercase tracking-wider font-medium text-muted-foreground antialiased',
    }[size] || 'text-base antialiased',
  );
</script>

<svelte:element this={componentType} class={cn(sizeClasses, className)} {...restProps}>
  {#if children}
    {@render children()}
  {:else if restProps.title}
    {restProps.title}
  {/if}
</svelte:element>
