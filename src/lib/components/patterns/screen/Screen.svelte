<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
    ref?: HTMLElement | null;
    children: Snippet;
    class?: string;
  }

  let { ref = $bindable(null), children, class: className, ...restProps }: Props = $props();
</script>

<section
  bind:this={ref}
  data-slot="screen"
  class={cn('flex min-h-0 min-w-0 flex-col bg-background text-foreground', className)}
  {...restProps}
>
  {@render children()}
</section>
