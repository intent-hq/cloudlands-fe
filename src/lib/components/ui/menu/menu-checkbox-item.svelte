<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    closeOnSelect = false,
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.CheckboxItemProps> & {
    children?: Snippet;
  } = $props();
</script>

<MenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  bind:indeterminate
  data-slot="menu-checkbox-item"
  data-menu-item
  {closeOnSelect}
  class={cn(menuItem(), className)}
  {...restProps}
>
  {@render children?.()}
  <Indicator state={indeterminate ? 'mixed' : checked ? 'checked' : 'empty'} />
</MenuPrimitive.CheckboxItem>
