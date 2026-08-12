<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    inert = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="card"
  data-inert={inert || undefined}
  {inert}
  style:background-image={inert ? 'var(--surface-hatch)' : undefined}
  class={cn(
    'flex min-w-0 flex-col overflow-hidden rounded-(--radius-medium) border border-border bg-card text-card-foreground shadow-(--elevation-raised)',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
