<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

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
  {#if leading}
    <span data-slot="menu-item-leading" class="flex size-4 shrink-0 items-center justify-center">
      {@render leading()}
    </span>
  {/if}
  {@render children?.()}
</MenuPrimitive.Item>
