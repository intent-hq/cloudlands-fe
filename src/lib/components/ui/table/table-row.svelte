<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';
  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
  bind:this={ref}
  data-slot="table-row"
  class={cn(
    'h-8 border-b border-border transition-colors duration-(--motion-fast) hover:bg-hover data-[state=selected]:bg-selected focus-within:bg-hover motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</tr>
