<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    spacing?: 'compact' | 'normal' | 'relaxed';
    children?: any;
  }

  let { class: className, spacing = 'normal', children, ...restProps }: Props = $props();

  const spacingClasses = {
    compact: 'space-y-px',
    normal: 'space-y-0.5',
    relaxed: 'space-y-1',
  };
</script>

<div class={cn('flex flex-col', spacingClasses[spacing], className)} {...restProps}>
  {@render children?.()}
</div>
