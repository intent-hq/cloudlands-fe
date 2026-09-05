<script lang="ts">
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    children: Snippet;
    class?: string;
  }

  let { children, class: className, ...restProps }: Props = $props();
</script>

<div data-slot="screen-body" class={cn('min-h-0 min-w-0 flex-1', className)} {...restProps}>
  {@render children()}
</div>
