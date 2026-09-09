<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.RadioItemProps> & {
    children?: Snippet;
  } = $props();
</script>

{#snippet radioContent({ checked }: { checked: boolean })}
  {@render children?.()}
  <span
    data-slot="menu-item-indicator"
    class={cn(OPTION_LIST_END_SLOT_CLASS, 'text-primary-ink')}
    aria-hidden="true"
  >
    {checked ? '●' : ''}
  </span>
{/snippet}

<MenuPrimitive.RadioItem
  bind:ref
  children={radioContent}
  data-slot="menu-radio-item"
  data-menu-item
  class={cn(menuItem(), className)}
  {...restProps}
/>
