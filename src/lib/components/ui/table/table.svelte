<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableElement>> = $props();
</script>

<div data-slot="table-container" class="relative w-full overflow-x-auto rounded-(--radius-large)">
  <table
    bind:this={ref}
    data-slot="table"
    class={cn('type-caption w-full caption-bottom border-collapse', className)}
    {...restProps}
  >
    {@render children?.()}
  </table>
</div>
