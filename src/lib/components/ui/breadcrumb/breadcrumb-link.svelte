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
      'block min-w-0 truncate rounded-sm transition-[background-color,color] duration-spring-fast ease-spring-fast hover:bg-hover hover:text-foreground focus-visible:-outline-offset-1 motion-reduce:transition-none',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </a>
{/if}
