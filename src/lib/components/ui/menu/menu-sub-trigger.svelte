<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: MenuPrimitive.SubTriggerProps = $props();
</script>

<MenuPrimitive.SubTrigger
  bind:ref
  data-slot="menu-sub-trigger"
  data-menu-item
  class={cn(menuItem(), className)}
  {...restProps}
>
  {@render children?.()}
  <span class="ml-auto" aria-hidden="true">›</span>
</MenuPrimitive.SubTrigger>
