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
    class: className,
    closeOnSelect = false,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.RadioItemProps> & {
    children?: Snippet;
    leading?: Snippet;
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!leading);
</script>

{#snippet radioContent({ checked }: { checked: boolean })}
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
