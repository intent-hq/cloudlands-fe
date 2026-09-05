<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';
  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableCellElement>> = $props();
</script>

<th
  bind:this={ref}
  data-slot="table-head"
  class={cn('h-8 px-2 text-left align-middle font-medium text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</th>
