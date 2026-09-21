<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';

  let {
    class: className,
    children,
  }: {
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<kbd
  data-slot="shortcut-chip"
  class={cn('type-caption shrink-0 font-normal leading-none text-muted-foreground', className)}
  style="font-family: var(--font-ui);"
>
  {@render children?.()}
</kbd>
