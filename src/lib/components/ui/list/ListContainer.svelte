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
    compact: 'gap-px p-px',
    normal: 'gap-px p-1',
    relaxed: 'gap-px p-1.5',
  };
</script>

<div
  data-slot="list-container"
  class={cn(
    'flex min-w-0 flex-col overflow-hidden text-foreground',
    spacingClasses[spacing],
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
