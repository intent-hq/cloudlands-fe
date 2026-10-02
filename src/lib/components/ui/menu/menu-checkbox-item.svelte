<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';
  import { useMenuIconColumn } from './menu-layout-context.svelte';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    closeOnSelect = false,
    class: className,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.CheckboxItemProps> & {
    children?: Snippet;
    leading?: Snippet;
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!leading);
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
  {#if leading || reserveIcon()}
    <span
      data-slot="menu-item-leading"
      class="flex h-lh w-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {@render leading?.()}
    </span>
  {/if}
  {@render children?.()}
  <Indicator state={indeterminate ? 'mixed' : checked ? 'checked' : 'empty'} />
</MenuPrimitive.CheckboxItem>
