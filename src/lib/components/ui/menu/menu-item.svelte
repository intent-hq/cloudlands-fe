<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

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
  data-menu-item
  data-destructive={destructive ? '' : undefined}
  class={cn(menuItem(), 'data-[destructive]:text-foreground', className)}
  {...restProps}
/>
