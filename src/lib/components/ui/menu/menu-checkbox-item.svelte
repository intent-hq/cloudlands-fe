<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

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
  class={cn(menuItem({ inset: true }), className)}
  {...restProps}
>
  <span
    class="absolute left-2 flex size-4 items-center justify-center text-primary-ink"
    aria-hidden="true"
  >
    {indeterminate ? '−' : checked ? '✓' : ''}
  </span>
  {@render children?.()}
</MenuPrimitive.CheckboxItem>
