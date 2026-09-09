<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';

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
  <span data-slot="menu-sub-chevron" class={OPTION_LIST_END_SLOT_CLASS} aria-hidden="true">›</span>
</MenuPrimitive.SubTrigger>
