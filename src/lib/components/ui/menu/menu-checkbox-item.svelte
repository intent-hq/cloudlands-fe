<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
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
  class={cn(menuItem(), className)}
  {...restProps}
>
  {@render children?.()}
  <span
    data-slot="menu-item-indicator"
    class={cn(OPTION_LIST_END_SLOT_CLASS, 'text-primary-ink')}
    aria-hidden="true"
  >
    {indeterminate ? '−' : checked ? '✓' : ''}
  </span>
</MenuPrimitive.CheckboxItem>
