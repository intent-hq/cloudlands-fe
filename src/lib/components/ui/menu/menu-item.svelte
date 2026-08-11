<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    destructive = false,
    ...restProps
  }: MenuPrimitive.ItemProps & { destructive?: boolean } = $props();
</script>

<MenuPrimitive.Item
  bind:ref
  data-slot="menu-item"
  data-destructive={destructive ? '' : undefined}
  class={cn(
    'type-body relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 outline-none',
    'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    'data-[destructive]:text-destructive data-[destructive]:focus:bg-destructive/10',
    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
    className,
  )}
  {...restProps}
/>
