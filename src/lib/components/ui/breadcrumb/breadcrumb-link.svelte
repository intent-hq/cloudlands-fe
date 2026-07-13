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
  <a class={cn('transition-colors hover:text-foreground', className)} {...restProps}>
    {@render children?.()}
  </a>
{/if}
