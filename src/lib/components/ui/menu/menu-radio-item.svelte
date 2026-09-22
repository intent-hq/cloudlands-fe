<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';

  let {
    ref = $bindable(null),
    class: className,
    closeOnSelect = false,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.RadioItemProps> & {
    children?: Snippet;
  } = $props();
</script>

{#snippet radioContent({ checked }: { checked: boolean })}
  {@render children?.()}
  <Indicator state={checked ? 'checked' : 'empty'} />
{/snippet}

<MenuPrimitive.RadioItem
  bind:ref
  children={radioContent}
  data-slot="menu-radio-item"
  data-menu-item
  {closeOnSelect}
  class={cn(menuItem(), className)}
  {...restProps}
/>
