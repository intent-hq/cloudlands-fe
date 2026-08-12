<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  type Props = HTMLAnchorAttributes & {
    asChild?: boolean;
  };

  let { class: className, asChild = false, children, ...restProps }: Props = $props();
</script>

{#if asChild}
  {@render children?.()}
{:else}
  <a
    class={cn(
      'block min-w-0 truncate rounded-sm outline-none transition-[color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </a>
{/if}
