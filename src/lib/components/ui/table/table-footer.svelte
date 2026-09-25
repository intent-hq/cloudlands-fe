<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';
  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableSectionElement>> = $props();
</script>

<tfoot
  bind:this={ref}
  data-slot="table-footer"
  class={cn('border-t bg-hover font-medium', className)}
  {...restProps}
>
  {@render children?.()}
</tfoot>
