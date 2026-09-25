<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import { useMenuIconColumn } from './menu-layout-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    destructive = false,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.ItemProps> & {
    destructive?: boolean;
    leading?: Snippet;
    children?: Snippet;
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!leading);
</script>

<MenuPrimitive.Item
  bind:ref
  data-slot="menu-item"
  data-menu-item
  data-destructive={destructive ? '' : undefined}
  class={cn(
    menuItem(),
    'data-[destructive]:text-danger data-[destructive]:focus:text-danger',
    className,
  )}
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
</MenuPrimitive.Item>
