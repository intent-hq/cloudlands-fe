<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import { CARD_CONTENT_INSET_CLASS } from './card-inset';

  type Props = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    flush?: boolean;
  };

  let {
    ref = $bindable(null),
    class: className,
    flush = false,
    children,
    ...restProps
  }: Props = $props();
</script>

<div
  bind:this={ref}
  data-slot="card-content"
  data-flush={flush || undefined}
  class={cn(
    'type-body min-w-0',
    flush ? 'p-0' : cn(CARD_CONTENT_INSET_CLASS, 'py-4 first:pt-4'),
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
