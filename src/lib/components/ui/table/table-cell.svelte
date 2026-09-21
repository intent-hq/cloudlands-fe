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

<td
  bind:this={ref}
  data-slot="table-cell"
  class={cn('h-8 px-2 py-1.5 align-middle tabular-nums', className)}
  {...restProps}
>
  {@render children?.()}
</td>
